import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { POST } = await import("../app/api/transcribe/route.ts");

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

async function withTempAgentDir(callback, authData = {}) {
  const previous = process.env.PI_CODING_AGENT_DIR;
  const dir = mkdtempSync(join(tmpdir(), "pi-web-transcribe-test-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  writeFileSync(join(dir, "auth.json"), JSON.stringify(authData, null, 2), "utf8");

  try {
    return await callback(dir);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const response = await POST(formRequest(new FormData()));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /audio/i);
}

await withTempAgentDir(async () => {
  const response = await POST(formRequest(audioForm()));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /openai api key/i);
});

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

console.log("transcribe api checks passed");
