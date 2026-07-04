type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

type PermissionQuery = (descriptor: PermissionDescriptor) => Promise<PermissionStatus>;

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

type PermissionPolicyLike = {
  allowsFeature?: (feature: string) => boolean;
};

type VoiceInputDocumentLike = {
  permissionsPolicy?: PermissionPolicyLike;
  featurePolicy?: PermissionPolicyLike;
};

type VoiceInputRuntime = {
  navigator?: {
    mediaDevices?: {
      getUserMedia?: GetUserMedia;
    };
    permissions?: {
      query?: PermissionQuery;
    };
  };
  MediaRecorder?: MediaRecorderConstructor;
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
  fetch?: typeof fetch;
  document?: VoiceInputDocumentLike;
  isSecureContext?: boolean;
  self?: unknown;
  top?: unknown;
};

export type VoiceRecording = {
  stopAndTranscribe: () => Promise<string>;
  cancel: () => void;
};

export type MicrophonePermissionState = PermissionState | "unknown";
export type VoiceInputPolicyState = "allowed" | "blocked" | "unknown";

export type VoiceInputDiagnostics = {
  permissionState: MicrophonePermissionState;
  microphonePolicy: VoiceInputPolicyState;
  isSecureContext: boolean | "unknown";
  isTopLevel: boolean | "unknown";
  hasGetUserMedia: boolean;
  hasMediaRecorder: boolean;
  hasWebAudioRecorder: boolean;
  errorName?: string;
  errorMessage?: string;
};

export async function getMicrophonePermissionState(
  runtime: VoiceInputRuntime = globalThis as unknown as VoiceInputRuntime,
): Promise<MicrophonePermissionState> {
  const permissions = runtime.navigator?.permissions;
  if (typeof permissions?.query !== "function") return "unknown";

  try {
    const status = await permissions.query({ name: "microphone" as PermissionName });
    if (status.state === "granted" || status.state === "denied" || status.state === "prompt") {
      return status.state;
    }
  } catch {
    // Some browsers do not support querying microphone permission state.
  }

  return "unknown";
}

export function getMicrophonePolicyState(
  runtime: VoiceInputRuntime = globalThis as unknown as VoiceInputRuntime,
): VoiceInputPolicyState {
  const policy = runtime.document?.permissionsPolicy ?? runtime.document?.featurePolicy;
  if (typeof policy?.allowsFeature !== "function") return "unknown";

  try {
    return policy.allowsFeature("microphone") ? "allowed" : "blocked";
  } catch {
    return "unknown";
  }
}

function getTopLevelState(runtime: VoiceInputRuntime): boolean | "unknown" {
  if (!("self" in runtime) || !("top" in runtime)) return "unknown";

  try {
    return runtime.self === runtime.top;
  } catch {
    return false;
  }
}

function getErrorName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("name" in error)) return undefined;
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" && name ? name : undefined;
}

function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error !== "object" || error === null || !("message" in error)) return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message ? message : undefined;
}

export async function getVoiceInputDiagnostics(
  error?: unknown,
  runtime: VoiceInputRuntime = globalThis as unknown as VoiceInputRuntime,
): Promise<VoiceInputDiagnostics> {
  return {
    permissionState: await getMicrophonePermissionState(runtime),
    microphonePolicy: getMicrophonePolicyState(runtime),
    isSecureContext: typeof runtime.isSecureContext === "boolean" ? runtime.isSecureContext : "unknown",
    isTopLevel: getTopLevelState(runtime),
    hasGetUserMedia: typeof runtime.navigator?.mediaDevices?.getUserMedia === "function",
    hasMediaRecorder: typeof runtime.MediaRecorder === "function",
    hasWebAudioRecorder: typeof runtime.AudioContext === "function" || typeof runtime.webkitAudioContext === "function",
    errorName: getErrorName(error),
    errorMessage: getErrorMessage(error),
  };
}

export function supportsVoiceInput(runtime: VoiceInputRuntime = globalThis as unknown as VoiceInputRuntime): boolean {
  const hasGetUserMedia = typeof runtime.navigator?.mediaDevices?.getUserMedia === "function";
  const hasMediaRecorder = typeof runtime.MediaRecorder === "function";
  const hasWebAudioRecorder = typeof runtime.AudioContext === "function" || typeof runtime.webkitAudioContext === "function";
  return hasGetUserMedia && (hasMediaRecorder || hasWebAudioRecorder);
}

function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

function isPermissionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = "name" in error ? String((error as { name?: unknown }).name ?? "") : "";
  const message = error instanceof Error ? error.message : String((error as { message?: unknown }).message ?? "");
  return /notallowed|permission/i.test(`${name} ${message}`);
}

function voiceRecordingStartError(error: unknown, permissionState: MicrophonePermissionState): Error {
  const message = error instanceof Error ? error.message : "Microphone access failed";
  const wrapped = new Error(message);
  wrapped.name = error instanceof Error ? error.name : "Error";
  return Object.assign(wrapped, {
    cause: error,
    permissionState,
    ...(permissionState === "denied" || isPermissionError(error) ? { code: "permission-denied" } : {}),
  });
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

  const mediaDevices = runtime.navigator?.mediaDevices;
  if (typeof mediaDevices?.getUserMedia !== "function") {
    throw Object.assign(new Error("Voice input is not supported in this browser"), { code: "unsupported-browser" });
  }

  let stream: MediaStream;
  try {
    stream = await mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    const permissionState = await getMicrophonePermissionState(runtime);
    throw voiceRecordingStartError(error, permissionState);
  }
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
