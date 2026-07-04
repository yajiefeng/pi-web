import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { POST } = await import("../app/api/transcribe/route.ts");
const {
  MAX_TRANSCRIBE_AUDIO_BYTES,
  MAX_TRANSCRIBE_REQUEST_BYTES,
} = await import("../lib/transcription/limits.ts");

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
  "VOLCENGINE_ARK_API_KEY",
  "ARK_BASE_URL",
  "VOLCENGINE_ARK_BASE_URL",
  "ARK_ASR_MODEL",
  "VOLCENGINE_ARK_ASR_MODEL",
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
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });

    assert.equal(String(url), "https://ark.cn-beijing.volces.com/api/v3/audio/transcriptions");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer test-ark-key");
    assert.ok(init.body instanceof FormData);
    assert.ok(init.body.get("file") instanceof File);
    assert.equal(init.body.get("model"), "doubao-seed-asr-2.0");

    return new Response(JSON.stringify({ text: "hello from doubao" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const response = await POST(formRequest(audioForm()));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { text: "hello from doubao" });
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
}, {}, { ARK_API_KEY: "test-ark-key" });

await withTempAgentDir(async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://ark.cn-beijing.volces.com/api/v3/audio/transcriptions");
    assert.equal(init.headers.Authorization, "Bearer test-ark-auth-key");
    assert.equal(init.body.get("model"), "doubao-seed-asr-2.0");

    return new Response(JSON.stringify({ text: "hello from stored doubao key" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const response = await POST(formRequest(audioForm()));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { text: "hello from stored doubao key" });
  } finally {
    globalThis.fetch = originalFetch;
  }
}, { "volcengine-ark": { type: "api_key", key: "test-ark-auth-key" } });

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
