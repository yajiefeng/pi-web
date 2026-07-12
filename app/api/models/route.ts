import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { createAgentSessionServices, getAgentDir, type SettingsManager } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import { findBridgeRegistryForSession, sendBridgeCommand } from "../../../lib/bridge/rpc-bridge-client.ts";

export const dynamic = "force-dynamic";

const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelEntries(
  a: { id: string; name: string; provider: string },
  b: { id: string; name: string; provider: string }
): number {
  return modelNameCollator.compare(a.name || a.id, b.name || b.id)
    || modelNameCollator.compare(a.provider, b.provider)
    || modelNameCollator.compare(a.id, b.id);
}

async function getSessionRuntimeModels(sessionId: string): Promise<Model<Api>[] | null> {
  const bridge = await findBridgeRegistryForSession({ sessionId });
  if (bridge) {
    if (!bridge.capabilities.includes("get_available_models")) {
      throw new Error("The session runtime cannot report its available models");
    }
    const response = await sendBridgeCommand(bridge, {
      id: randomUUID(),
      expectedSessionId: sessionId,
      command: { type: "get_available_models" },
    });
    if (!response.accepted) {
      throw new Error(response.errorMessage ?? "The session runtime rejected the model list request");
    }
    const data = response.data as { models?: Model<Api>[] } | undefined;
    if (!Array.isArray(data?.models)) throw new Error("The session runtime returned an invalid model list");
    return data.models;
  }

  const { getRpcSession } = await import("../../../lib/rpc-manager.ts");
  const rpc = getRpcSession(sessionId);
  if (!rpc?.isAlive()) return null;
  const data = await rpc.send({ type: "get_available_models" }) as { models?: Model<Api>[] };
  if (!Array.isArray(data.models)) throw new Error("The session runtime returned an invalid model list");
  return data.models;
}

export async function GET(req: Request) {
  const nameMap = new Map<string, string>();
  let modelList: { id: string; name: string; provider: string }[] = [];
  let defaultModel: { provider: string; modelId: string } | null = null;
  const thinkingLevels: Record<string, string[]> = {};
  const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};
  const url = new URL(req.url);
  const cwd = url.searchParams.get("cwd") || process.cwd();
  const sessionId = url.searchParams.get("sessionId");

  let cwdStat;
  try {
    cwdStat = await stat(cwd);
  } catch {
    return Response.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
  }
  if (!cwdStat.isDirectory()) {
    return Response.json({ error: `Not a directory: ${cwd}` }, { status: 400 });
  }

  let runtimeModels: Model<Api>[] | null = null;
  if (sessionId) {
    try {
      runtimeModels = await getSessionRuntimeModels(sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ error: `Failed to load session runtime models: ${message}` }, { status: 502 });
    }
  }

  try {
    const agentDir = getAgentDir();
    const services = await createAgentSessionServices({ cwd, agentDir });
    const registry = services.modelRegistry;
    const available = runtimeModels ?? registry.getAvailable();
    modelList = available.map((m: { id: string; name: string; provider: string }) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
    })).sort(compareModelEntries);
    for (const m of available) {
      const key = `${m.provider}:${m.id}`;
      nameMap.set(key, m.name);
      thinkingLevels[key] = getSupportedThinkingLevels(m);
      if (m.thinkingLevelMap) thinkingLevelMaps[key] = m.thinkingLevelMap;
    }

    const settings: SettingsManager = services.settingsManager;
    const provider = settings.getDefaultProvider();
    const modelId = settings.getDefaultModel();
    if (provider && modelId && available.some((m) => m.provider === provider && m.id === modelId)) {
      defaultModel = { provider, modelId };
    }
  } catch { /* return empty */ }

  return Response.json({ models: Object.fromEntries(nameMap), modelList, defaultModel, thinkingLevels, thinkingLevelMaps });
}
