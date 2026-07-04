import { MAX_TRANSCRIBE_AUDIO_BYTES, MAX_TRANSCRIBE_REQUEST_BYTES } from "../../../lib/transcription/limits.ts";
import { transcribeAudioFile } from "../../../lib/transcription/transcribe.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getErrorStatus(error: unknown): number {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : 500;
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRequestTooLarge(req: Request): boolean {
  const contentLength = req.headers.get("content-length");
  if (!contentLength) return false;

  const bytes = Number(contentLength);
  return Number.isFinite(bytes) && bytes > MAX_TRANSCRIBE_REQUEST_BYTES;
}

function tooLargeResponse() {
  return Response.json({ error: "audio upload is too large" }, { status: 413 });
}

export async function POST(req: Request) {
  try {
    if (isRequestTooLarge(req)) return tooLargeResponse();

    const form = await req.formData();
    const audio = form.get("audio");

    if (!(audio instanceof File) || audio.size === 0) {
      return Response.json({ error: "audio file is required" }, { status: 400 });
    }
    if (audio.size > MAX_TRANSCRIBE_AUDIO_BYTES) return tooLargeResponse();

    const text = await transcribeAudioFile(audio);
    return Response.json({ text });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: getErrorStatus(error) });
  }
}
