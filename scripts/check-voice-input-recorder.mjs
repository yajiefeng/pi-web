import assert from "node:assert/strict";

const {
  encodeWav,
  getMicrophonePermissionState,
  getMicrophonePolicyState,
  getVoiceInputDiagnostics,
  startVoiceRecording,
  supportsVoiceInput,
} = await import("../components/voice-input-recorder.ts");

assert.equal(supportsVoiceInput({}), false);
assert.equal(supportsVoiceInput({
  navigator: { mediaDevices: { getUserMedia: async () => ({}) } },
  MediaRecorder: class {},
}), true);
assert.equal(supportsVoiceInput({
  navigator: { mediaDevices: { getUserMedia: async () => ({}) } },
  AudioContext: class {},
}), true);
assert.equal(await getMicrophonePermissionState({}), "unknown");
{
  const permissions = {
    async query(descriptor) {
      assert.equal(this, permissions, "permissions.query must be called with navigator.permissions as this");
      assert.deepEqual(descriptor, { name: "microphone" });
      return { state: "prompt" };
    },
  };
  assert.equal(await getMicrophonePermissionState({ navigator: { permissions } }), "prompt");
}
assert.equal(getMicrophonePolicyState({}), "unknown");
assert.equal(getMicrophonePolicyState({ document: { permissionsPolicy: { allowsFeature: () => true } } }), "allowed");
assert.equal(getMicrophonePolicyState({ document: { permissionsPolicy: { allowsFeature: () => false } } }), "blocked");
{
  const diagnostics = await getVoiceInputDiagnostics(new Error("Permission denied"), {
    navigator: {
      mediaDevices: { getUserMedia: async () => ({}) },
      permissions: { async query() { return { state: "denied" }; } },
    },
    document: { permissionsPolicy: { allowsFeature: () => true } },
    isSecureContext: true,
    self: "same-window",
    top: "same-window",
    MediaRecorder: class {},
  });
  assert.deepEqual(diagnostics, {
    permissionState: "denied",
    microphonePolicy: "allowed",
    isSecureContext: true,
    isTopLevel: true,
    hasGetUserMedia: true,
    hasMediaRecorder: true,
    hasWebAudioRecorder: false,
    errorName: "Error",
    errorMessage: "Permission denied",
  });
}
{
  const permissions = { async query() { return { state: "denied" }; } };
  const mediaDevices = {
    async getUserMedia() {
      const error = new Error("Permission denied");
      error.name = "NotAllowedError";
      throw error;
    },
  };

  await assert.rejects(
    () => startVoiceRecording({ navigator: { mediaDevices, permissions }, MediaRecorder: class {} }),
    (error) => {
      assert.equal(error.name, "NotAllowedError");
      assert.equal(error.code, "permission-denied");
      assert.equal(error.permissionState, "denied");
      return true;
    },
  );
}
{
  const wav = await encodeWav([Float32Array.from([0, 1, -1])], 16_000).arrayBuffer();
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(wav.slice(8, 12)), "WAVE");
}

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

  const mediaDevices = {
    async getUserMedia(constraints) {
      assert.equal(this, mediaDevices, "getUserMedia must be called with navigator.mediaDevices as this");
      assert.deepEqual(constraints, { audio: true });
      return stream;
    },
  };

  const runtime = {
    navigator: { mediaDevices },
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

{
  let stoppedTracks = 0;
  const stream = { getTracks: () => [{ stop: () => { stoppedTracks += 1; } }] };
  const calls = [];

  class BrokenMediaRecorder {
    constructor() {
      throw new Error("MediaRecorder constructor is unsupported");
    }
  }

  class FakeAudioContext {
    static latest;

    constructor() {
      this.sampleRate = 16_000;
      this.destination = {};
      FakeAudioContext.latest = this;
    }

    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }

    createScriptProcessor() {
      this.processor = { onaudioprocess: null, connect() {}, disconnect() {} };
      return this.processor;
    }

    createGain() {
      return { gain: { value: 1 }, connect() {}, disconnect() {} };
    }

    async close() {
      this.closed = true;
    }
  }

  const recording = await startVoiceRecording({
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    MediaRecorder: BrokenMediaRecorder,
    AudioContext: FakeAudioContext,
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      const audio = init.body.get("audio");
      assert.equal(url, "/api/transcribe");
      assert.equal(init.method, "POST");
      assert.ok(audio instanceof Blob);
      assert.equal(audio.name, "voice.wav");
      assert.equal(audio.type, "audio/wav");
      return new Response(JSON.stringify({ text: "hello from wav fallback" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  FakeAudioContext.latest.processor.onaudioprocess({
    inputBuffer: { getChannelData: () => Float32Array.from([0, 0.25, -0.25]) },
  });

  const text = await recording.stopAndTranscribe();

  assert.equal(text, "hello from wav fallback");
  assert.equal(calls.length, 1);
  assert.equal(stoppedTracks, 1);
  assert.equal(FakeAudioContext.latest.closed, true);
}

{
  let fetchCalled = false;
  const stream = { getTracks: () => [{ stop: () => {} }] };

  class EmptyMediaRecorder {
    constructor() {
      this.listeners = new Map();
    }

    addEventListener(event, handler) {
      this.listeners.set(event, handler);
    }

    start() {}

    stop() {
      this.listeners.get("stop")?.();
    }
  }

  const recording = await startVoiceRecording({
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    MediaRecorder: EmptyMediaRecorder,
    fetch: async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ text: "should not happen" }), { status: 200 });
    },
  });

  await assert.rejects(() => recording.stopAndTranscribe(), /no speech/i);
  assert.equal(fetchCalled, false);
}

console.log("voice input recorder checks passed");
