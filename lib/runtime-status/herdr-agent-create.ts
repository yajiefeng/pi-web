import { validateCwdDirectory } from "../cwd-validation.ts";
import { HerdrControlError, startHerdrAgent, type HerdrAgentCreationResult, type StartHerdrAgentInput } from "./herdr-control.ts";

type StartHerdrAgent = (input: StartHerdrAgentInput) => Promise<HerdrAgentCreationResult>;

type CreateHerdrAgentOptions = {
  start?: StartHerdrAgent;
  random?: () => string;
  allowRoot?: (cwd: string) => void;
};

export async function createHerdrAgentResponse(
  req: Request,
  options: CreateHerdrAgentOptions = {},
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const cwd = typeof body === "object" && body !== null && "cwd" in body
    ? (body as { cwd?: unknown }).cwd
    : undefined;
  if (typeof cwd !== "string") {
    return Response.json({ ok: false, error: "cwd is required" }, { status: 400 });
  }

  const validation = validateCwdDirectory(cwd);
  if (!validation.ok) {
    return Response.json({ ok: false, error: validation.error }, { status: 400 });
  }

  options.allowRoot?.(validation.cwd);

  try {
    const start = options.start ?? ((input: StartHerdrAgentInput) => startHerdrAgent(input));
    const result = await start({ cwd: validation.cwd, ...(options.random ? { random: options.random } : {}) });
    return Response.json(result);
  } catch (error) {
    if (error instanceof HerdrControlError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
