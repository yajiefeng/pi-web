import { AuthStorage } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData();
  const audio = form.get("audio");

  if (!(audio instanceof File) || audio.size === 0) {
    return Response.json({ error: "audio file is required" }, { status: 400 });
  }

  const apiKey = await AuthStorage.create().getApiKey("openai");
  if (!apiKey) {
    return Response.json({ error: "OpenAI API key is not configured" }, { status: 400 });
  }

  const openAIForm = new FormData();
  openAIForm.set("file", audio, audio.name || "audio.webm");
  openAIForm.set("model", "gpt-4o-mini-transcribe");

  const openAIResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: openAIForm,
  });

  if (!openAIResponse.ok) {
    return Response.json({ error: "OpenAI transcription failed" }, { status: 502 });
  }

  const result = await openAIResponse.json() as { text?: unknown };
  const text = typeof result.text === "string" ? result.text.trim() : "";

  if (!text) {
    return Response.json({ error: "Transcription returned no text" }, { status: 422 });
  }

  return Response.json({ text });
}
