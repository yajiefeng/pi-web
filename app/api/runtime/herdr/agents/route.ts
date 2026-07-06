import { allowFileRoot } from "@/lib/file-access";
import { createHerdrAgentResponse } from "@/lib/runtime-status/herdr-agent-create";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return createHerdrAgentResponse(req, { allowRoot: allowFileRoot });
}
