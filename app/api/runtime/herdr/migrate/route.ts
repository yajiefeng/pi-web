import { allowFileRoot } from "@/lib/file-access";
import { migrateHerdrTuiSessionToBridgeResponse } from "@/lib/runtime-status/herdr-migration";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return migrateHerdrTuiSessionToBridgeResponse(req, { allowRoot: allowFileRoot });
}
