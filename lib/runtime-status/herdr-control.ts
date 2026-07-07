import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { execPath } from "node:process";
import { promisify } from "node:util";
import { parseHerdrAgentList, type HerdrCommandRunner } from "./herdr-adapter.ts";

const execFileAsync = promisify(execFile);
const HERDR_BIN = process.env.HERDR_BIN || "herdr";
const DEFAULT_TIMEOUT_MS = 5000;

type RandomString = () => string;

export interface StartHerdrAgentInput {
  cwd: string;
  random?: RandomString;
  bridgeCommand?: string[];
}

export interface HerdrAgentCreationResult {
  ok: true;
  agentId: string;
  agentLabel: string;
  pending: true;
  cwd: string;
}

export class HerdrControlError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HerdrControlError";
    this.status = status;
  }
}

export function generatePiWebHerdrAgentName(cwd: string, options: { random?: RandomString } = {}): string {
  const rawProjectName = basename(cwd) || "project";
  const projectName = sanitizeAgentNamePart(rawProjectName) || "project";
  const suffix = sanitizeAgentNamePart((options.random ?? randomSuffix)()) || randomSuffix();
  return `pi-web-${projectName}-${suffix}`;
}

export function resolvePiWebRpcBridgeCommand(): string[] {
  const configured = process.env.PI_WEB_RPC_BRIDGE_BIN?.trim();
  if (configured) return [configured];

  const localBridge = join(process.cwd(), "bin", "pi-web-rpc-bridge.js");
  if (existsSync(localBridge)) return [execPath, localBridge];

  return ["pi-web-rpc-bridge"];
}

export async function startHerdrAgent(
  input: StartHerdrAgentInput,
  options: { run?: HerdrCommandRunner; timeoutMs?: number } = {},
): Promise<HerdrAgentCreationResult> {
  const run = options.run ?? runHerdr;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const agentLabel = generatePiWebHerdrAgentName(input.cwd, { random: input.random });
  const bridgeCommand = input.bridgeCommand ?? resolvePiWebRpcBridgeCommand();
  const args = ["agent", "start", agentLabel, "--cwd", input.cwd, "--", ...bridgeCommand, "--", "pi", "--mode", "rpc"];

  let startOutput: { stdout: string; stderr: string };
  try {
    startOutput = await run(args, { timeoutMs });
  } catch (error) {
    throw mapHerdrControlError(error, "Failed to start Herdr agent");
  }

  const startedAgent = findCreatedAgent(startOutput.stdout, agentLabel, { allowSingleFallback: true });
  if (startedAgent) {
    return {
      ok: true,
      agentId: startedAgent.id,
      agentLabel: startedAgent.label || agentLabel,
      pending: true,
      cwd: input.cwd,
    };
  }

  try {
    const listOutput = await run(["agent", "list"], { timeoutMs });
    const listedAgent = findCreatedAgent(listOutput.stdout, agentLabel, { allowSingleFallback: false });
    if (listedAgent) {
      return {
        ok: true,
        agentId: listedAgent.id,
        agentLabel: listedAgent.label || agentLabel,
        pending: true,
        cwd: input.cwd,
      };
    }
  } catch (error) {
    throw mapHerdrControlError(error, "Started Herdr agent, but could not resolve its id");
  }

  throw new HerdrControlError(502, "Started Herdr agent, but could not resolve its id");
}

async function runHerdr(args: string[], options: { timeoutMs: number }): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(HERDR_BIN, args, {
    timeout: options.timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

function findCreatedAgent(
  stdout: string,
  agentLabel: string,
  options: { allowSingleFallback: boolean },
): { id: string; label: string } | null {
  const agents = parseHerdrAgentList(stdout);
  const agent = agents.find((item) => item.label === agentLabel || item.id === agentLabel)
    ?? (options.allowSingleFallback && agents.length === 1 ? agents[0] : undefined);
  if (!agent?.id) return null;
  return { id: agent.id, label: agent.label || agentLabel };
}

function sanitizeAgentNamePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function randomSuffix(): string {
  return randomBytes(2).toString("hex");
}

function mapHerdrControlError(error: unknown, prefix: string): HerdrControlError {
  const message = errorMessage(error);
  const status = /connection refused|not_running|code:\s*61|os \{ code: 61|enoent/i.test(message) ? 503 : 502;
  return new HerdrControlError(status, `${prefix}: ${message}`);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const details = [error.message];
    const maybe = error as Error & { stderr?: string; stdout?: string; signal?: string };
    if (maybe.stderr) details.push(maybe.stderr);
    if (maybe.stdout) details.push(maybe.stdout);
    if (maybe.signal === "SIGTERM") details.push("timeout");
    return details.filter(Boolean).join("\n");
  }
  return String(error);
}
