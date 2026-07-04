type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

type MediaRecorderLike = {
  start: () => void;
  stop: () => void;
  addEventListener: MediaRecorder["addEventListener"];
};

type MediaRecorderConstructor = new (stream: MediaStream) => MediaRecorderLike;

type VoiceInputRuntime = {
  navigator?: {
    mediaDevices?: {
      getUserMedia?: GetUserMedia;
    };
  };
  MediaRecorder?: MediaRecorderConstructor;
  fetch?: typeof fetch;
};

export type VoiceRecording = {
  stopAndTranscribe: () => Promise<string>;
  cancel: () => void;
};

export function supportsVoiceInput(runtime: VoiceInputRuntime = globalThis): boolean {
  return typeof runtime.navigator?.mediaDevices?.getUserMedia === "function"
    && typeof runtime.MediaRecorder === "function";
}

function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

async function transcribeRecording(blob: Blob, fetchImpl: typeof fetch): Promise<string> {
  if (blob.size === 0) {
    throw Object.assign(new Error("No speech was detected"), { code: "empty-audio" });
  }

  const form = new FormData();
  form.set("audio", blob, "voice.webm");

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

export async function startVoiceRecording(runtime: VoiceInputRuntime = globalThis): Promise<VoiceRecording> {
  if (!supportsVoiceInput(runtime)) {
    throw Object.assign(new Error("Voice input is not supported in this browser"), { code: "unsupported-browser" });
  }

  const getUserMedia = runtime.navigator?.mediaDevices?.getUserMedia;
  const MediaRecorderCtor = runtime.MediaRecorder;
  if (!getUserMedia || !MediaRecorderCtor) {
    throw Object.assign(new Error("Voice input is not supported in this browser"), { code: "unsupported-browser" });
  }

  const stream = await getUserMedia({ audio: true });
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
        return await transcribeRecording(blob, runtime.fetch ?? fetch);
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
