import { statSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export function normalizeCwd(cwd: string): string {
  if (cwd === "~") return homedir();
  if (cwd.startsWith("~/")) return resolve(homedir(), cwd.slice(2));
  return isAbsolute(cwd) ? cwd : resolve(cwd);
}

export function validateCwdDirectory(cwd: string): { ok: true; cwd: string } | { ok: false; error: string } {
  const trimmed = cwd.trim();
  if (!trimmed) return { ok: false, error: "Path is required" };

  const normalizedCwd = normalizeCwd(trimmed);
  let stat: Stats;
  try {
    stat = statSync(normalizedCwd);
  } catch {
    return { ok: false, error: `Directory does not exist: ${trimmed}` };
  }

  if (!stat.isDirectory()) {
    return { ok: false, error: `Path is not a directory: ${trimmed}` };
  }

  return { ok: true, cwd: normalizedCwd };
}
