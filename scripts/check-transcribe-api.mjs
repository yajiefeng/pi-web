import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const { POST } = await import("../app/api/transcribe/route.ts");
const {
  MAX_TRANSCRIBE_AUDIO_BYTES,
  MAX_TRANSCRIBE_REQUEST_BYTES,
} = await import("../lib/transcription/limits.ts");
const { resolveTranscriptionProvider } = await import("../lib/transcription/transcribe.ts");
const {
  buildAudioOnlyRequest,
  buildFullClientRequest,
  extractAsrText,
  parseAsrResponse,
  VOLCENGINE_AGENT_PLAN_DEFAULT_RESOURCE_ID,
  VOLCENGINE_AGENT_PLAN_DEFAULT_WS_URL,
} = await import("../lib/transcription/volcengine-agent-plan.ts");

const volcengineSource = readFileSync("lib/transcription/volcengine-agent-plan.ts", "utf8");
assert.match(volcengineSource, /WS_NO_BUFFER_UTIL/, "Volcengine ASR should disable ws native bufferutil in production Next runtime");
assert.match(volcengineSource, /await import\("ws"\)/, "Volcengine ASR should load ws after disabling native bufferutil");
assert.doesNotMatch(volcengineSource, /import WebSocket from "ws"/, "Volcengine ASR should not statically import ws before WS_NO_BUFFER_UTIL is set");

function formRequest(form) {
  return new Request("http://localhost/api/transcribe", {
    method: "POST",
    body: form,
  });
}

function audioForm() {
  const form = new FormData();
  form.set("audio", new File(["not really audio"], "voice.webm", { type: "audio/webm" }));
  return form;
}

const TRANSCRIPTION_ENV_KEYS = [
  "ARK_API_KEY",
  "VOLCENGINE_AGENT_PLAN_API_KEY",
  "VOLCENGINE_AGENT_PLAN_ASR_RESOURCE_ID",
  "VOLCENGINE_AGENT_PLAN_ASR_WS_URL",
  "VOLCENGINE_ASR_API_KEY",
  "VOLCENGINE_ASR_RESOURCE_ID",
  "VOLCENGINE_ASR_WS_URL",
  "VOLCENGINE_ARK_API_KEY",
  "OPENAI_API_KEY",
];

async function withTempAgentDir(callback, authData = {}, envOverrides = {}) {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousEnv = Object.fromEntries(TRANSCRIPTION_ENV_KEYS.map((key) => [key, process.env[key]]));
  const dir = mkdtempSync(join(tmpdir(), "pi-web-transcribe-test-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  for (const key of TRANSCRIPTION_ENV_KEYS) delete process.env[key];
  Object.assign(process.env, envOverrides);
  writeFileSync(join(dir, "auth.json"), JSON.stringify(authData, null, 2), "utf8");

  try {
    return await callback(dir);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    for (const key of TRANSCRIPTION_ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const response = await POST(formRequest(new FormData()));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /audio/i);
}

{
  const response = await POST(new Request("http://localhost/api/transcribe", {
    method: "POST",
    body: new FormData(),
    headers: { "content-length": String(MAX_TRANSCRIBE_REQUEST_BYTES + 1) },
  }));
  const body = await response.json();

  assert.equal(response.status, 413);
  assert.match(body.error, /too large/i);
}

{
  const form = new FormData();
  form.set("audio", new File([new Uint8Array(MAX_TRANSCRIBE_AUDIO_BYTES + 1)], "too-large.wav", { type: "audio/wav" }));
  const response = await POST(formRequest(form));
  const body = await response.json();

  assert.equal(response.status, 413);
  assert.match(body.error, /too large/i);
}

await withTempAgentDir(async () => {
  const response = await POST(formRequest(audioForm()));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /transcription api key/i);
});

await withTempAgentDir(async () => {
  const provider = await resolveTranscriptionProvider();

  assert.equal(provider.kind, "volcengine-agent-plan");
  assert.equal(provider.endpoint, VOLCENGINE_AGENT_PLAN_DEFAULT_WS_URL);
  assert.equal(provider.resourceId, VOLCENGINE_AGENT_PLAN_DEFAULT_RESOURCE_ID);
  assert.equal(provider.apiKey, "test-agent-plan-key");
}, {}, { VOLCENGINE_AGENT_PLAN_API_KEY: "test-agent-plan-key" });

await withTempAgentDir(async () => {
  const provider = await resolveTranscriptionProvider();

  assert.equal(provider.kind, "volcengine-agent-plan");
  assert.equal(provider.endpoint, "wss://example.test/asr");
  assert.equal(provider.resourceId, "volc.seedasr.sauc.concurrent");
  assert.equal(provider.apiKey, "test-agent-plan-auth-key");
}, { "volcengine-ark": { type: "api_key", key: "test-agent-plan-auth-key" } }, {
  VOLCENGINE_ASR_RESOURCE_ID: "volc.seedasr.sauc.concurrent",
  VOLCENGINE_ASR_WS_URL: "wss://example.test/asr",
});

{
  const full = buildFullClientRequest(1);
  assert.equal(full[0], 0x11);
  assert.equal(full[1], 0x11);
  assert.equal(full[2], 0x11);
  assert.equal(full.readInt32BE(4), 1);

  const lastAudio = buildAudioOnlyRequest(3, Buffer.from("abc"), true);
  assert.equal(lastAudio[0], 0x11);
  assert.equal(lastAudio[1], 0x23);
  assert.equal(lastAudio[2], 0x11);
  assert.equal(lastAudio.readInt32BE(4), -3);
}

{
  const payload = gzipSync(Buffer.from(JSON.stringify({ result: { text: " hello from doubao " } })));
  const responseBytes = Buffer.concat([
    Buffer.from([0x11, 0x93, 0x11, 0x00]),
    Buffer.from([0x00, 0x00, 0x00, 0x02]),
    Buffer.from([0x00, 0x00, 0x00, payload.length]),
    payload,
  ]);
  const response = parseAsrResponse(responseBytes);

  assert.equal(response.messageType, 0x09);
  assert.equal(response.isLastPackage, true);
  assert.equal(extractAsrText(response.payloadMsg), "hello from doubao");
}

await withTempAgentDir(async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });

    assert.equal(String(url), "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer test-openai-key");
    assert.ok(init.body instanceof FormData);
    assert.ok(init.body.get("file") instanceof File);
    assert.equal(init.body.get("model"), "gpt-4o-mini-transcribe");

    return new Response(JSON.stringify({ text: "hello from voice" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const response = await POST(formRequest(audioForm()));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { text: "hello from voice" });
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
}, { openai: { type: "api_key", key: "test-openai-key" } });

await withTempAgentDir(async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ text: "   " }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  try {
    const response = await POST(formRequest(audioForm()));
    const body = await response.json();

    assert.equal(response.status, 422);
    assert.match(body.error, /no text/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
}, { openai: { type: "api_key", key: "test-openai-key" } });

await withTempAgentDir(async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "provider unavailable" } }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });

  try {
    const response = await POST(formRequest(audioForm()));
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.match(body.error, /transcription failed/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
}, { openai: { type: "api_key", key: "test-openai-key" } });

console.log("transcribe api checks passed");
