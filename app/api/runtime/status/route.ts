import { getRuntimeStatusSnapshot } from "@/lib/runtime-status/provider";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getRuntimeStatusSnapshot());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
