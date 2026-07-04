import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import {
  transcribeWithVolcengineAgentPlan,
  VOLCENGINE_AGENT_PLAN_DEFAULT_RESOURCE_ID,
  VOLCENGINE_AGENT_PLAN_DEFAULT_WS_URL,
} from "./volcengine-agent-plan.ts";

type AuthStorageInstance = ReturnType<typeof AuthStorage.create>;
type ModelRegistryInstance = ReturnType<typeof ModelRegistry.create>;

type VolcengineAgentPlanProvider = {
  id: "volcengine-ark";
  kind: "volcengine-agent-plan";
  displayName: string;
  endpoint: string;
  resourceId: string;
  apiKey: string;
};

type OpenAITranscriptionProvider = {
  id: "openai";
  kind: "openai";
  displayName: string;
  endpoint: string;
  model: string;
  apiKey: string;
};

type TranscriptionProvider = VolcengineAgentPlanProvider | OpenAITranscriptionProvider;

type ResolveTranscriptionProviderOptions = {
  authStorage?: AuthStorageInstance;
  modelRegistry?: ModelRegistryInstance;
  env?: NodeJS.ProcessEnv;
};

const VOLCENGINE_AGENT_PLAN_PROVIDER_IDS = [
  "volcengine-ark",
  "volcengine-agent-plan",
  "ark",
  "doubao",
] as const;
const OPENAI_TRANSCRIPTION_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getEnvValue(env: NodeJS.ProcessEnv, names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function getVolcengineAgentPlanEndpoint(env: NodeJS.ProcessEnv): string {
  return trimTrailingSlash(
    getEnvValue(env, ["VOLCENGINE_ASR_WS_URL", "VOLCENGINE_AGENT_PLAN_ASR_WS_URL"])
      ?? VOLCENGINE_AGENT_PLAN_DEFAULT_WS_URL,
  );
}

function getVolcengineAgentPlanResourceId(env: NodeJS.ProcessEnv): string {
  return getEnvValue(env, ["VOLCENGINE_ASR_RESOURCE_ID", "VOLCENGINE_AGENT_PLAN_ASR_RESOURCE_ID"])
    ?? VOLCENGINE_AGENT_PLAN_DEFAULT_RESOURCE_ID;
}

async function getProviderApiKey(
  providerIds: readonly string[],
  modelRegistry: ModelRegistryInstance,
): Promise<string | undefined> {
  for (const providerId of providerIds) {
    const apiKey = await modelRegistry.getApiKeyForProvider(providerId);
    if (apiKey?.trim()) return apiKey.trim();
  }
  return undefined;
}

export async function resolveTranscriptionProvider(
  options: ResolveTranscriptionProviderOptions = {},
): Promise<TranscriptionProvider | null> {
  const env = options.env ?? process.env;
  const authStorage = options.authStorage ?? AuthStorage.create();
  const modelRegistry = options.modelRegistry ?? ModelRegistry.create(authStorage);

  const volcengineAgentPlanApiKey = getEnvValue(env, [
    "VOLCENGINE_AGENT_PLAN_API_KEY",
    "VOLCENGINE_ASR_API_KEY",
    "VOLCENGINE_ARK_API_KEY",
    "ARK_API_KEY",
  ]) ?? await getProviderApiKey(VOLCENGINE_AGENT_PLAN_PROVIDER_IDS, modelRegistry);

  if (volcengineAgentPlanApiKey) {
    return {
      id: "volcengine-ark",
      kind: "volcengine-agent-plan",
      displayName: "Volcengine Agent Plan Doubao ASR",
      endpoint: getVolcengineAgentPlanEndpoint(env),
      resourceId: getVolcengineAgentPlanResourceId(env),
      apiKey: volcengineAgentPlanApiKey,
    };
  }

  const openAIApiKey = await modelRegistry.getApiKeyForProvider("openai");
  if (openAIApiKey?.trim()) {
    return {
      id: "openai",
      kind: "openai",
      displayName: "OpenAI transcription",
      endpoint: OPENAI_TRANSCRIPTION_ENDPOINT,
      model: OPENAI_TRANSCRIPTION_MODEL,
      apiKey: openAIApiKey.trim(),
    };
  }

  return null;
}

export async function transcribeAudioFile(audio: File): Promise<string> {
  const provider = await resolveTranscriptionProvider();
  if (!provider) {
    throw Object.assign(
      new Error("No transcription API key configured. Configure Volcengine Agent Plan/Doubao or OpenAI for voice input."),
      { status: 400 },
    );
  }

  if (provider.kind === "volcengine-agent-plan") {
    try {
      const text = await transcribeWithVolcengineAgentPlan(audio, provider);
      if (!text) {
        throw Object.assign(new Error("Transcription returned no text"), { status: 422 });
      }
      return text;
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: unknown }).status)
        : 502;
      if (status === 422) throw error;

      const details = error instanceof Error && error.message ? `: ${error.message}` : "";
      throw Object.assign(
        new Error(`${provider.displayName} transcription failed${details}`),
        { status: 502 },
      );
    }
  }

  const providerForm = new FormData();
  providerForm.set("file", audio, audio.name || "audio.webm");
  providerForm.set("model", provider.model);

  const providerResponse = await fetch(provider.endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.apiKey}` },
    body: providerForm,
  });

  if (!providerResponse.ok) {
    throw Object.assign(
      new Error(`${provider.displayName} transcription failed`),
      { status: 502 },
    );
  }

  const result = await providerResponse.json() as { text?: unknown };
  const text = typeof result.text === "string" ? result.text.trim() : "";

  if (!text) {
    throw Object.assign(new Error("Transcription returned no text"), { status: 422 });
  }

  return text;
}
