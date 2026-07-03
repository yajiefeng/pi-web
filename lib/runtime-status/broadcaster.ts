import { subscribeRunningSessions } from "../rpc-manager";
import { getRuntimeStatusSnapshot } from "./provider";
import type { RuntimeStatusSnapshot } from "./types";

const HERDR_POLL_MS = 2500;

declare global {
  var __piRuntimeStatusListeners: Set<(snapshot: RuntimeStatusSnapshot) => void> | undefined;
  var __piRuntimeStatusPoller: ReturnType<typeof setInterval> | undefined;
  var __piRuntimeStatusRpcUnsubscribe: (() => void) | undefined;
  var __piRuntimeStatusLastSnapshot: string | undefined;
  var __piRuntimeStatusPublishing: boolean | undefined;
}

function getListeners(): Set<(snapshot: RuntimeStatusSnapshot) => void> {
  if (!globalThis.__piRuntimeStatusListeners) globalThis.__piRuntimeStatusListeners = new Set();
  return globalThis.__piRuntimeStatusListeners;
}

export function subscribeRuntimeStatus(listener: (snapshot: RuntimeStatusSnapshot) => void): () => void {
  const listeners = getListeners();
  listeners.add(listener);
  ensureRuntimeStatusWatchers();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopRuntimeStatusWatchers();
  };
}

export function notifyRuntimeStatusChange(): void {
  void publishRuntimeStatusSnapshot();
}

function ensureRuntimeStatusWatchers(): void {
  if (!globalThis.__piRuntimeStatusRpcUnsubscribe) {
    globalThis.__piRuntimeStatusRpcUnsubscribe = subscribeRunningSessions(() => notifyRuntimeStatusChange());
  }
  if (!globalThis.__piRuntimeStatusPoller) {
    globalThis.__piRuntimeStatusPoller = setInterval(() => notifyRuntimeStatusChange(), HERDR_POLL_MS);
  }
}

function stopRuntimeStatusWatchers(): void {
  if (globalThis.__piRuntimeStatusPoller) {
    clearInterval(globalThis.__piRuntimeStatusPoller);
    globalThis.__piRuntimeStatusPoller = undefined;
  }
  globalThis.__piRuntimeStatusRpcUnsubscribe?.();
  globalThis.__piRuntimeStatusRpcUnsubscribe = undefined;
  globalThis.__piRuntimeStatusLastSnapshot = undefined;
  globalThis.__piRuntimeStatusPublishing = false;
}

async function publishRuntimeStatusSnapshot(): Promise<void> {
  if (globalThis.__piRuntimeStatusPublishing) return;
  const listeners = getListeners();
  if (listeners.size === 0) return;

  globalThis.__piRuntimeStatusPublishing = true;
  try {
    const snapshot = await getRuntimeStatusSnapshot();
    const encoded = JSON.stringify(snapshot);
    if (encoded === globalThis.__piRuntimeStatusLastSnapshot) return;
    globalThis.__piRuntimeStatusLastSnapshot = encoded;
    for (const listener of listeners) {
      try { listener(snapshot); } catch { /* ignore listener errors */ }
    }
  } finally {
    globalThis.__piRuntimeStatusPublishing = false;
  }
}
