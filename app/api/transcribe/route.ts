import { transcribeAudioFile } from "../../../lib/transcription/transcribe.ts";

export const dynamic = "force-dynamic";

function getErrorStatus(error: unknown): number {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : 500;
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const audio = form.get("audio");

    if (!(audio instanceof File) || audio.size === 0) {
      return Response.json({ error: "audio file is required" }, { status: 400 });
    }

    const text = await transcribeAudioFile(audio);
    return Response.json({ text });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: getErrorStatus(error) });
  }
}
