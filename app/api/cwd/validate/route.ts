import { NextResponse } from "next/server";
import { validateCwdDirectory } from "@/lib/cwd-validation";
import { allowFileRoot } from "@/lib/file-access";

// POST /api/cwd/validate  body: { cwd: string }
// Validates a candidate workspace before the UI selects it.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";

    if (!cwd) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    const validation = validateCwdDirectory(cwd);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    allowFileRoot(validation.cwd);
    return NextResponse.json({ success: true, cwd: validation.cwd });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
