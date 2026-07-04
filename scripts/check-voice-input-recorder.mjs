import assert from "node:assert/strict";

const {
  startVoiceRecording,
  supportsVoiceInput,
} = await import("../components/voice-input-recorder.ts");

assert.equal(supportsVoiceInput({}), false);
assert.equal(supportsVoiceInput({
  navigator: { mediaDevices: { getUserMedia: async () => ({}) } },
  MediaRecorder: class {},
}), true);

{
  let stoppedTracks = 0;
  const stream = { getTracks: () => [{ stop: () => { stoppedTracks += 1; } }] };
  const calls = [];

  class FakeMediaRecorder {
    static latest;

    constructor(inputStream) {
      assert.equal(inputStream, stream);
      this.listeners = new Map();
      FakeMediaRecorder.latest = this;
    }

    addEventListener(event, handler) {
      this.listeners.set(event, handler);
    }

    start() {
      this.started = true;
    }

    stop() {
      this.listeners.get("dataavailable")?.({ data: new Blob(["voice bytes"], { type: "audio/webm" }) });
      this.listeners.get("stop")?.();
    }
  }

  const runtime = {
    navigator: { mediaDevices: { getUserMedia: async (constraints) => {
      assert.deepEqual(constraints, { audio: true });
      return stream;
    } } },
    MediaRecorder: FakeMediaRecorder,
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      assert.equal(url, "/api/transcribe");
      assert.equal(init.method, "POST");
      assert.ok(init.body instanceof FormData);
      assert.ok(init.body.get("audio") instanceof Blob);
      return new Response(JSON.stringify({ text: "hello from recording" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };

  const recording = await startVoiceRecording(runtime);
  assert.equal(FakeMediaRecorder.latest.started, true);

  const text = await recording.stopAndTranscribe();

  assert.equal(text, "hello from recording");
  assert.equal(calls.length, 1);
  assert.equal(stoppedTracks, 1);
}

console.log("voice input recorder checks passed");
