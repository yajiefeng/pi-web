import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import WebSocket from "ws";
import type { RawData } from "ws";

const execFileAsync = promisify(execFile);

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_SEGMENT_DURATION_MS = 200;
const DEFAULT_TIMEOUT_MS = 45_000;

const MESSAGE_TYPE_CLIENT_FULL_REQUEST = 0b0001;
const MESSAGE_TYPE_CLIENT_AUDIO_ONLY_REQUEST = 0b0010;
const MESSAGE_TYPE_SERVER_FULL_RESPONSE = 0b1001;
const MESSAGE_TYPE_SERVER_ERROR_RESPONSE = 0b1111;

const FLAG_POS_SEQUENCE = 0b0001;
const FLAG_NEG_WITH_SEQUENCE = 0b0011;

const SERIALIZATION_JSON = 0b0001;
const COMPRESSION_GZIP = 0b0001;

export const VOLCENGINE_AGENT_PLAN_DEFAULT_WS_URL =
  "wss://openspeech.bytedance.com/api/v3/plan/sauc/bigmodel_nostream";
export const VOLCENGINE_AGENT_PLAN_DEFAULT_RESOURCE_ID =
  "volc.seedasr.sauc.duration";

export type VolcengineAgentPlanProvider = {
  apiKey: string;
  endpoint: string;
  resourceId: string;
};

export type AsrResponse = {
  code: number;
  event: number;
  isLastPackage: boolean;
  messageType: number;
  payloadSequence: number;
  payloadSize: number;
  payloadMsg: unknown;
};

type WavInfo = {
  channelCount: number;
  bytesPerSample: number;
  sampleRate: number;
  dataSize: number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function getFileExtension(audio: File): string {
  const fromName = extname(audio.name || "");
  if (fromName) return fromName;
  if (audio.type === "audio/webm") return ".webm";
  if (audio.type === "audio/wav" || audio.type === "audio/wave") return ".wav";
  if (audio.type === "audio/mp4") return ".m4a";
  return ".audio";
}

function buildHeader(messageType: number, flags: number): Buffer {
  return Buffer.from([
    (0b0001 << 4) | 1,
    ((messageType & 0x0f) << 4) | (flags & 0x0f),
    (SERIALIZATION_JSON << 4) | COMPRESSION_GZIP,
    0,
  ]);
}

function int32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value);
  return buffer;
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

export function buildFullClientRequest(seq: number): Buffer {
  const payload = Buffer.from(JSON.stringify({
    user: { uid: "pi-web" },
    audio: {
      format: "wav",
      codec: "raw",
      rate: DEFAULT_SAMPLE_RATE,
      bits: 16,
      channel: 1,
    },
    request: {
      model_name: "bigmodel",
      enable_itn: true,
      enable_punc: true,
      enable_ddc: true,
      show_utterances: true,
      enable_nonstream: false,
    },
  }));
  const compressed = gzipSync(payload);

  return Buffer.concat([
    buildHeader(MESSAGE_TYPE_CLIENT_FULL_REQUEST, FLAG_POS_SEQUENCE),
    int32(seq),
    uint32(compressed.length),
    compressed,
  ]);
}

export function buildAudioOnlyRequest(
  seq: number,
  segment: Buffer,
  isLast: boolean,
): Buffer {
  const compressed = gzipSync(segment);
  const flags = isLast ? FLAG_NEG_WITH_SEQUENCE : FLAG_POS_SEQUENCE;
  const payloadSeq = isLast ? -seq : seq;

  return Buffer.concat([
    buildHeader(MESSAGE_TYPE_CLIENT_AUDIO_ONLY_REQUEST, flags),
    int32(payloadSeq),
    uint32(compressed.length),
    compressed,
  ]);
}

function assertReadablePayload(payload: Buffer, bytes: number): void {
  if (payload.length < bytes) {
    throw new Error("Malformed ASR response");
  }
}

export function parseAsrResponse(message: Buffer): AsrResponse {
  if (message.length < 4) {
    throw new Error("Malformed ASR response");
  }

  const headerSize = (message[0] & 0x0f) * 4;
  const messageType = message[1] >> 4;
  const flags = message[1] & 0x0f;
  const serialization = message[2] >> 4;
  const compression = message[2] & 0x0f;
  let payload = message.subarray(headerSize);

  const response: AsrResponse = {
    code: 0,
    event: 0,
    isLastPackage: false,
    messageType,
    payloadSequence: 0,
    payloadSize: 0,
    payloadMsg: undefined,
  };

  if (flags & 0x01) {
    assertReadablePayload(payload, 4);
    response.payloadSequence = payload.readInt32BE(0);
    payload = payload.subarray(4);
  }
  if (flags & 0x02) response.isLastPackage = true;
  if (flags & 0x04) {
    assertReadablePayload(payload, 4);
    response.event = payload.readInt32BE(0);
    payload = payload.subarray(4);
  }

  if (messageType === MESSAGE_TYPE_SERVER_FULL_RESPONSE) {
    assertReadablePayload(payload, 4);
    response.payloadSize = payload.readUInt32BE(0);
    payload = payload.subarray(4);
  } else if (messageType === MESSAGE_TYPE_SERVER_ERROR_RESPONSE) {
    assertReadablePayload(payload, 8);
    response.code = payload.readInt32BE(0);
    response.payloadSize = payload.readUInt32BE(4);
    payload = payload.subarray(8);
  }

  if (response.payloadSize > 0) {
    payload = payload.subarray(0, response.payloadSize);
  }
  if (payload.length === 0) return response;

  const body = compression === COMPRESSION_GZIP ? gunzipSync(payload) : payload;
  if (serialization === SERIALIZATION_JSON) {
    response.payloadMsg = JSON.parse(body.toString("utf8"));
  } else {
    response.payloadMsg = body.toString("utf8");
  }

  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textFromUtterances(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => isRecord(item) && typeof item.text === "string" ? item.text : "")
    .join("")
    .trim();
}

export function extractAsrText(payload: unknown): string {
  if (!isRecord(payload)) return "";
  if (typeof payload.text === "string") return payload.text.trim();

  const result = payload.result;
  if (isRecord(result)) {
    if (typeof result.text === "string") return result.text.trim();

    const utteranceText = textFromUtterances(result.utterances);
    if (utteranceText) return utteranceText;
  }

  return textFromUtterances(payload.utterances);
}

function readWavInfo(data: Buffer): WavInfo {
  if (data.length < 44 || data.subarray(0, 4).toString("ascii") !== "RIFF"
    || data.subarray(8, 12).toString("ascii") !== "WAVE") {
    throw new Error("Converted audio is not a valid WAV file");
  }

  let position = 12;
  let channelCount = 0;
  let bytesPerSample = 0;
  let sampleRate = 0;
  let dataSize = 0;

  while (position + 8 <= data.length) {
    const chunkId = data.subarray(position, position + 4).toString("ascii");
    const chunkSize = data.readUInt32LE(position + 4);
    const chunkStart = position + 8;

    if (chunkId === "fmt ") {
      channelCount = data.readUInt16LE(chunkStart + 2);
      sampleRate = data.readUInt32LE(chunkStart + 4);
      bytesPerSample = data.readUInt16LE(chunkStart + 14) / 8;
    } else if (chunkId === "data") {
      dataSize = chunkSize;
      break;
    }

    position = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (!channelCount || !bytesPerSample || !sampleRate || !dataSize) {
    throw new Error("Converted WAV file is missing audio metadata");
  }

  return { channelCount, bytesPerSample, sampleRate, dataSize };
}

function getSegmentSize(wav: Buffer, segmentDurationMs: number): number {
  const info = readWavInfo(wav);
  const bytesPerSecond = info.channelCount * info.bytesPerSample * info.sampleRate;
  return Math.max(1, Math.floor(bytesPerSecond * segmentDurationMs / 1000));
}

function splitSegments(data: Buffer, segmentSize: number): Buffer[] {
  const segments: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += segmentSize) {
    segments.push(data.subarray(offset, Math.min(offset + segmentSize, data.length)));
  }
  return segments;
}

async function convertToWav(audio: File): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-asr-"));
  const inputName = `${basename(audio.name || "audio", extname(audio.name || ""))}${getFileExtension(audio)}`;
  const inputPath = join(dir, inputName);
  const outputPath = join(dir, "audio.wav");

  try {
    await writeFile(inputPath, Buffer.from(await audio.arrayBuffer()));
    await execFileAsync("ffmpeg", [
      "-v", "quiet",
      "-y",
      "-i", inputPath,
      "-acodec", "pcm_s16le",
      "-ac", "1",
      "-ar", String(DEFAULT_SAMPLE_RATE),
      "-f", "wav",
      outputPath,
    ], { timeout: 30_000, maxBuffer: 1024 * 1024 });

    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function makeProviderError(response: AsrResponse): Error {
  const payload = response.payloadMsg;
  const message = isRecord(payload)
    ? JSON.stringify(payload)
    : typeof payload === "string"
      ? payload
      : `ASR error code ${response.code}`;
  return new Error(message);
}

export async function transcribeWithVolcengineAgentPlan(
  audio: File,
  provider: VolcengineAgentPlanProvider,
): Promise<string> {
  const wav = await convertToWav(audio);
  const segmentDurationMs = envNumber("VOLCENGINE_ASR_SEGMENT_DURATION_MS", DEFAULT_SEGMENT_DURATION_MS);
  const segmentDelayMs = envNumber("VOLCENGINE_ASR_SEGMENT_DELAY_MS", 0);
  const timeoutMs = envNumber("VOLCENGINE_ASR_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const segmentSize = getSegmentSize(wav, segmentDurationMs);
  const segments = splitSegments(wav, segmentSize);

  return await new Promise((resolve, reject) => {
    let settled = false;
    let seq = 1;
    let bestText = "";
    let senderStarted = false;

    const connectId = randomUUID();
    const websocket = new WebSocket(provider.endpoint, {
      headers: {
        "X-Api-Key": provider.apiKey,
        "X-Api-Resource-Id": provider.resourceId,
        "X-Api-Request-Id": connectId,
        "X-Api-Connect-Id": connectId,
        "X-Api-Sequence": "-1",
      },
    });

    const cleanup = () => {
      clearTimeout(timer);
      websocket.removeAllListeners();
      if (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING) {
        websocket.close();
      }
    };

    const finish = (error?: Error, text?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(text?.trim() || "");
    };

    const timer = setTimeout(() => {
      finish(new Error("Volcengine Agent Plan ASR timed out"));
    }, timeoutMs);

    const sendSegments = async () => {
      try {
        for (let index = 0; index < segments.length; index += 1) {
          if (settled || websocket.readyState !== WebSocket.OPEN) return;
          const isLast = index === segments.length - 1;
          websocket.send(buildAudioOnlyRequest(seq, segments[index], isLast));
          if (!isLast) seq += 1;
          if (segmentDelayMs > 0) await delay(segmentDelayMs);
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };

    websocket.on("open", () => {
      websocket.send(buildFullClientRequest(seq));
      seq += 1;
    });

    websocket.on("message", (data) => {
      let response: AsrResponse;
      try {
        response = parseAsrResponse(rawDataToBuffer(data));
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      if (response.code !== 0 || response.messageType === MESSAGE_TYPE_SERVER_ERROR_RESPONSE) {
        finish(makeProviderError(response));
        return;
      }

      const text = extractAsrText(response.payloadMsg);
      if (text) bestText = text;

      if (!senderStarted) {
        senderStarted = true;
        void sendSegments();
        return;
      }

      if (response.isLastPackage) {
        finish(undefined, bestText);
      }
    });

    websocket.on("unexpected-response", (_request, response) => {
      finish(new Error(`Volcengine Agent Plan ASR rejected WebSocket upgrade with HTTP ${response.statusCode}`));
    });
    websocket.on("error", (error) => finish(error));
    websocket.on("close", () => {
      if (!settled) finish(new Error("Volcengine Agent Plan ASR WebSocket closed before final result"));
    });
  });
}
