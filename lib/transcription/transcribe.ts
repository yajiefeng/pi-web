import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

type AuthStorageInstance = ReturnType<typeof AuthStorage.create>;
type ModelRegistryInstance = ReturnType<typeof ModelRegistry.create>;

type TranscriptionProvider = {
  id: "volcengine-ark" | "openai";
  displayName: string;
  endpoint: string;
  model: string;
  apiKey: string;
};

type ResolveTranscriptionProviderOptions = {
  authStorage?: AuthStorageInstance;
  modelRegistry?: ModelRegistryInstance;
  env?: NodeJS.ProcessEnv;
};

const ARK_PROVIDER_IDS = ["volcengine-ark", "ark", "doubao"] as const;
const ARK_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const ARK_DEFAULT_MODEL = "doubao-seed-asr-2.0";
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

function getArkBaseUrl(env: NodeJS.ProcessEnv): string {
  return trimTrailingSlash(
    getEnvValue(env, ["VOLCENGINE_ARK_BASE_URL", "ARK_BASE_URL"])
      ?? ARK_DEFAULT_BASE_URL,
  );
}

function getArkModel(env: NodeJS.ProcessEnv): string {
  return getEnvValue(env, ["VOLCENGINE_ARK_ASR_MODEL", "ARK_ASR_MODEL"])
    ?? ARK_DEFAULT_MODEL;
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

  const arkApiKey = getEnvValue(env, ["VOLCENGINE_ARK_API_KEY", "ARK_API_KEY"])
    ?? await getProviderApiKey(ARK_PROVIDER_IDS, modelRegistry);

  if (arkApiKey) {
    return {
      id: "volcengine-ark",
      displayName: "Volcengine Ark Doubao ASR",
      endpoint: `${getArkBaseUrl(env)}/audio/transcriptions`,
      model: getArkModel(env),
      apiKey: arkApiKey,
    };
  }

  const openAIApiKey = await modelRegistry.getApiKeyForProvider("openai");
  if (openAIApiKey?.trim()) {
    return {
      id: "openai",
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
      new Error("No transcription API key configured. Configure Volcengine Ark/Doubao or OpenAI for voice input."),
      { status: 400 },
    );
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
