export type VoiceInputErrorCode =
  | "permission-denied"
  | "unsupported-browser"
  | "missing-openai-key"
  | "empty-audio"
  | "transcription-failed";

export type VoiceInputPhase = "idle" | "recording" | "transcribing";

export type VoiceInputStatus = {
  label: string;
  detail: string;
  ariaLabel: string;
};

const LEADING_PUNCTUATION = /^[,.;:!?，。！？、；：]/;

const ERROR_MESSAGES: Record<VoiceInputErrorCode, string> = {
  "permission-denied": "Microphone permission was denied. Allow microphone access and try again.",
  "unsupported-browser": "Voice input is not supported in this browser.",
  "missing-openai-key": "OpenAI API key is not configured. Add an OpenAI API key in model settings and try again.",
  "empty-audio": "No speech was detected. Try recording again.",
  "transcription-failed": "Voice transcription failed. Try again.",
};

export function appendVoiceTranscript(draft: string, transcript: string): string {
  const next = transcript.trim();
  if (!next) return draft;
  if (!draft.trim()) return next;
  if (/\s$/.test(draft)) return `${draft}${next}`;
  if (LEADING_PUNCTUATION.test(next)) return `${draft}${next}`;
  return `${draft} ${next}`;
}

export function formatRecordingDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function getVoiceInputStatus({
  phase,
  elapsedSeconds,
}: {
  phase: VoiceInputPhase;
  elapsedSeconds: number;
}): VoiceInputStatus | null {
  if (phase === "idle") return null;

  if (phase === "transcribing") {
    return {
      label: "Transcribing",
      detail: "Please wait…",
      ariaLabel: "Transcribing voice input.",
    };
  }

  const duration = formatRecordingDuration(elapsedSeconds);
  return {
    label: "Recording",
    detail: duration,
    ariaLabel: `Recording voice for ${duration}. Tap stop when done.`,
  };
}

function isVoiceInputErrorCode(value: unknown): value is VoiceInputErrorCode {
  return typeof value === "string" && value in ERROR_MESSAGES;
}

function getErrorField(error: unknown, field: "code" | "name" | "message"): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  return (error as Record<string, unknown>)[field];
}

export function normalizeVoiceInputError(error: unknown): string {
  const code = getErrorField(error, "code");
  if (isVoiceInputErrorCode(code)) return ERROR_MESSAGES[code];

  const name = getErrorField(error, "name");
  const message = error instanceof Error ? error.message : String(getErrorField(error, "message") ?? error ?? "");
  const normalized = `${typeof name === "string" ? name : ""} ${message}`.toLowerCase();

  if (normalized.includes("notallowed") || normalized.includes("permission")) {
    return ERROR_MESSAGES["permission-denied"];
  }
  if (normalized.includes("unsupported") || normalized.includes("mediarecorder") || normalized.includes("getusermedia")) {
    return ERROR_MESSAGES["unsupported-browser"];
  }
  if (normalized.includes("openai api key") || normalized.includes("api key") || normalized.includes("not configured")) {
    return ERROR_MESSAGES["missing-openai-key"];
  }
  if (normalized.includes("no speech") || normalized.includes("empty") || normalized.includes("no text")) {
    return ERROR_MESSAGES["empty-audio"];
  }

  return ERROR_MESSAGES["transcription-failed"];
}
