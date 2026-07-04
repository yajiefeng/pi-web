type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

type MediaRecorderLike = {
  start: () => void;
  stop: () => void;
  addEventListener: MediaRecorder["addEventListener"];
};

type MediaRecorderConstructor = new (stream: MediaStream) => MediaRecorderLike;

type AudioProcessingEventLike = {
  inputBuffer: {
    getChannelData: (channel: number) => Float32Array;
  };
};

type AudioNodeLike = {
  connect: (node: unknown) => void;
  disconnect: () => void;
};

type ScriptProcessorNodeLike = AudioNodeLike & {
  onaudioprocess: ((event: AudioProcessingEventLike) => void) | null;
};

type GainNodeLike = AudioNodeLike & {
  gain: { value: number };
};

type AudioContextLike = {
  sampleRate: number;
  destination: unknown;
  createMediaStreamSource: (stream: MediaStream) => AudioNodeLike;
  createScriptProcessor: (bufferSize: number, inputChannels: number, outputChannels: number) => ScriptProcessorNodeLike;
  createGain?: () => GainNodeLike;
  close?: () => Promise<void>;
};

type AudioContextConstructor = new () => AudioContextLike;

type VoiceInputRuntime = {
  navigator?: {
    mediaDevices?: {
      getUserMedia?: GetUserMedia;
    };
    maxTouchPoints?: number;
    platform?: string;
    userAgent?: string;
  };
  MediaRecorder?: MediaRecorderConstructor;
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
  fetch?: typeof fetch;
};

export type VoiceRecording = {
  stopAndTranscribe: () => Promise<string>;
  cancel: () => void;
};

export function supportsVoiceInput(runtime: VoiceInputRuntime = globalThis as unknown as VoiceInputRuntime): boolean {
  const hasGetUserMedia = typeof runtime.navigator?.mediaDevices?.getUserMedia === "function";
  const hasMediaRecorder = typeof runtime.MediaRecorder === "function";
  const hasWebAudioRecorder = typeof runtime.AudioContext === "function" || typeof runtime.webkitAudioContext === "function";
  return hasGetUserMedia && (hasMediaRecorder || hasWebAudioRecorder);
}

export function prefersNativeAudioCapture(runtime: VoiceInputRuntime = globalThis as unknown as VoiceInputRuntime): boolean {
  const userAgent = runtime.navigator?.userAgent ?? "";
  const platform = runtime.navigator?.platform ?? "";
  const maxTouchPoints = runtime.navigator?.maxTouchPoints ?? 0;

  // iOS browsers all use WebKit under the hood. Chrome on iOS reports CriOS,
  // but inline recording support is still fragile; the native audio capture UI
  // is more reliable for iPhone/iPad.
  return /iPhone|iPad|iPod|CriOS|FxiOS/i.test(userAgent)
    || (platform === "MacIntel" && maxTouchPoints > 1);
}

function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

export async function transcribeVoiceAudio(
  blob: Blob,
  filename = "voice.webm",
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (blob.size === 0) {
    throw Object.assign(new Error("No speech was detected"), { code: "empty-audio" });
  }

  const form = new FormData();
  form.set("audio", blob, filename);

  const response = await fetchImpl("/api/transcribe", {
    method: "POST",
    body: form,
  });

  const body = await response.json() as { text?: unknown; error?: unknown };
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Voice transcription failed");
  }

  if (typeof body.text !== "string" || !body.text.trim()) {
    throw new Error("Transcription returned no text");
  }

  return body.text.trim();
}

function startMediaRecorderRecording(
  stream: MediaStream,
  MediaRecorderCtor: MediaRecorderConstructor,
  fetchImpl: typeof fetch,
): VoiceRecording {
  const recorder = new MediaRecorderCtor(stream);
  const chunks: Blob[] = [];

  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.addEventListener("dataavailable", (event) => {
      const data = event.data;
      if (data.size > 0) chunks.push(data);
    });
    recorder.addEventListener("error", () => {
      reject(new Error("Voice recording failed"));
    });
    recorder.addEventListener("stop", () => {
      resolve(new Blob(chunks, { type: chunks[0]?.type || "audio/webm" }));
    });
  });

  recorder.start();

  return {
    async stopAndTranscribe() {
      recorder.stop();
      try {
        const blob = await stopped;
        return await transcribeVoiceAudio(blob, "voice.webm", fetchImpl);
      } finally {
        stopStream(stream);
      }
    },
    cancel() {
      try {
        recorder.stop();
      } finally {
        stopStream(stream);
      }
    },
  };
}

function mergeFloat32Chunks(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const samples = mergeFloat32Chunks(chunks);
  const bytesPerSample = 2;
  const channelCount = 1;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    const pcm = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, pcm, true);
    offset += bytesPerSample;
  }

  return new Blob([view], { type: "audio/wav" });
}

function startWebAudioRecording(
  stream: MediaStream,
  AudioContextCtor: AudioContextConstructor,
  fetchImpl: typeof fetch,
): VoiceRecording {
  const audioContext = new AudioContextCtor();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const output = audioContext.createGain?.();
  const chunks: Float32Array[] = [];
  let stopped = false;

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
  };

  source.connect(processor);
  if (output) {
    output.gain.value = 0;
    processor.connect(output);
    output.connect(audioContext.destination);
  } else {
    processor.connect(audioContext.destination);
  }

  const cleanup = async () => {
    processor.onaudioprocess = null;
    processor.disconnect();
    output?.disconnect();
    source.disconnect();
    stopStream(stream);
    await audioContext.close?.();
  };

  return {
    async stopAndTranscribe() {
      if (stopped) throw Object.assign(new Error("Voice recording already stopped"), { code: "empty-audio" });
      stopped = true;
      try {
        if (chunks.length === 0) {
          throw Object.assign(new Error("No speech was detected"), { code: "empty-audio" });
        }
        const blob = encodeWav(chunks, audioContext.sampleRate);
        return await transcribeVoiceAudio(blob, "voice.wav", fetchImpl);
      } finally {
        await cleanup();
      }
    },
    cancel() {
      if (stopped) return;
      stopped = true;
      void cleanup();
    },
  };
}

export async function startVoiceRecording(runtime: VoiceInputRuntime = globalThis as unknown as VoiceInputRuntime): Promise<VoiceRecording> {
  if (!supportsVoiceInput(runtime)) {
    throw Object.assign(new Error("Voice input is not supported in this browser"), { code: "unsupported-browser" });
  }

  const getUserMedia = runtime.navigator?.mediaDevices?.getUserMedia;
  if (!getUserMedia) {
    throw Object.assign(new Error("Voice input is not supported in this browser"), { code: "unsupported-browser" });
  }

  const stream = await getUserMedia({ audio: true });
  const fetchImpl = runtime.fetch ?? fetch;
  const AudioContextCtor = runtime.AudioContext ?? runtime.webkitAudioContext;

  if (runtime.MediaRecorder) {
    try {
      return startMediaRecorderRecording(stream, runtime.MediaRecorder, fetchImpl);
    } catch (error) {
      if (!AudioContextCtor) {
        stopStream(stream);
        throw error;
      }
    }
  }

  if (AudioContextCtor) {
    return startWebAudioRecording(stream, AudioContextCtor, fetchImpl);
  }

  stopStream(stream);
  throw Object.assign(new Error("Voice input is not supported in this browser"), { code: "unsupported-browser" });
}
