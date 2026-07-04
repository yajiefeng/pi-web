import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

// Providers that use OAuth — handled separately via /api/auth/providers
const OAUTH_PROVIDER_IDS = new Set(["anthropic", "github-copilot", "openai-codex"]);

const EXTRA_API_KEY_PROVIDERS = [
  {
    id: "volcengine-ark",
    displayName: "Volcengine Ark / Doubao ASR",
    modelCount: 0,
    description: "Used by voice input transcription with doubao-seed-asr-2.0.",
    placeholder: "Ark API Key",
  },
] as const;

export async function GET() {
  const authStorage = AuthStorage.create();
  const registry = ModelRegistry.create(authStorage);
  const all = registry.getAll();

  // Deduplicate by provider, skip OAuth-only providers and custom providers (source=models_json_key)
  const seen = new Set<string>();
  const result: {
    id: string;
    displayName: string;
    configured: boolean;
    source?: string;
    modelCount: number;
  }[] = [];

  for (const m of all) {
    if (seen.has(m.provider)) continue;
    seen.add(m.provider);
    if (OAUTH_PROVIDER_IDS.has(m.provider)) continue;
    const status = registry.getProviderAuthStatus(m.provider);
    // Skip providers whose key comes from models.json (those are custom providers)
    if (status.source === "models_json_key") continue;
    const displayName = registry.getProviderDisplayName(m.provider);
    const modelCount = all.filter((x) => x.provider === m.provider).length;
    result.push({
      id: m.provider,
      displayName,
      configured: status.configured,
      source: status.source,
      modelCount,
    });
  }

  for (const provider of EXTRA_API_KEY_PROVIDERS) {
    if (seen.has(provider.id)) continue;
    const status = authStorage.getAuthStatus(provider.id);
    result.push({
      ...provider,
      configured: status.configured,
      source: status.source,
    });
  }

  return Response.json({ providers: result });
}
