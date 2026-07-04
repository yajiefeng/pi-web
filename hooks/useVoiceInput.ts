"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getVoiceInputStatus,
  normalizeVoiceInputError,
  shouldAutoStopRecording,
  type VoiceInputStatus,
} from "@/components/voice-input-helpers";
import {
  getVoiceInputDiagnostics,
  startVoiceRecording,
  supportsVoiceInput,
  type MicrophonePermissionState,
  type VoiceInputDiagnostics,
  type VoiceRecording,
} from "@/components/voice-input-recorder";

type UseVoiceInputOptions = {
  onTranscript: (transcript: string) => void;
  onBeforeStart?: () => void;
};

type UseVoiceInputResult = {
  supported: boolean;
  busy: boolean;
  recording: boolean;
  transcribing: boolean;
  error: string | null;
  diagnosticsText: string | null;
  status: VoiceInputStatus | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  toggle: () => void;
};

function formatVoiceInputDiagnostics(diagnostics: VoiceInputDiagnostics | null): string | null {
  if (!diagnostics) return null;

  const parts = [
    `permission=${diagnostics.permissionState}`,
    `secure=${diagnostics.isSecureContext}`,
    `policy=${diagnostics.microphonePolicy}`,
    `topLevel=${diagnostics.isTopLevel}`,
  ];
  if (diagnostics.errorName) parts.push(`error=${diagnostics.errorName}`);
  return parts.join(", ");
}

export function useVoiceInput({ onTranscript, onBeforeStart }: UseVoiceInputOptions): UseVoiceInputResult {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [microphonePermissionState, setMicrophonePermissionState] = useState<MicrophonePermissionState>("unknown");
  const [voiceInputDiagnostics, setVoiceInputDiagnostics] = useState<VoiceInputDiagnostics | null>(null);
  const [recordingStartedAtMs, setRecordingStartedAtMs] = useState<number | null>(null);
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  const voiceRecordingRef = useRef<VoiceRecording | null>(null);

  const busy = recording || transcribing;
  const status = getVoiceInputStatus({
    phase: recording ? "recording" : transcribing ? "transcribing" : "idle",
    elapsedSeconds: recordingElapsedSeconds,
  });
  const diagnosticsText = formatVoiceInputDiagnostics(voiceInputDiagnostics)
    ?? (microphonePermissionState !== "unknown" ? `permission=${microphonePermissionState}` : null);

  useEffect(() => {
    const isSupported = supportsVoiceInput();
    setSupported(isSupported);
    if (isSupported) {
      void getVoiceInputDiagnostics().then((diagnostics) => {
        setMicrophonePermissionState(diagnostics.permissionState);
        setVoiceInputDiagnostics(diagnostics);
      });
    }
  }, []);

  useEffect(() => {
    if (recordingStartedAtMs === null) return;

    const updateElapsed = () => {
      setRecordingElapsedSeconds(Math.max(0, Math.floor((Date.now() - recordingStartedAtMs) / 1000)));
    };

    updateElapsed();
    const interval = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(interval);
  }, [recordingStartedAtMs]);

  useEffect(() => {
    return () => {
      voiceRecordingRef.current?.cancel();
    };
  }, []);

  const stop = useCallback(async () => {
    const activeRecording = voiceRecordingRef.current;
    if (!activeRecording || transcribing) return;

    voiceRecordingRef.current = null;
    setRecording(false);
    setRecordingStartedAtMs(null);
    setTranscribing(true);
    setError(null);

    try {
      const transcript = await activeRecording.stopAndTranscribe();
      onTranscript(transcript);
    } catch (caughtError) {
      setError(normalizeVoiceInputError(caughtError));
    } finally {
      setTranscribing(false);
      setRecordingElapsedSeconds(0);
    }
  }, [onTranscript, transcribing]);

  const start = useCallback(async () => {
    if (transcribing || voiceRecordingRef.current) return;

    setError(null);
    onBeforeStart?.();

    try {
      const nextRecording = await startVoiceRecording();
      voiceRecordingRef.current = nextRecording;
      setMicrophonePermissionState("granted");
      setVoiceInputDiagnostics(null);
      setRecordingElapsedSeconds(0);
      setRecordingStartedAtMs(Date.now());
      setRecording(true);
    } catch (caughtError) {
      void getVoiceInputDiagnostics(caughtError).then((diagnostics) => {
        setMicrophonePermissionState(diagnostics.permissionState);
        setVoiceInputDiagnostics(diagnostics);
      });
      setError(normalizeVoiceInputError(caughtError));
    }
  }, [onBeforeStart, transcribing]);

  const toggle = useCallback(() => {
    if (voiceRecordingRef.current) {
      void stop();
      return;
    }
    void start();
  }, [start, stop]);

  useEffect(() => {
    if (!recording || transcribing) return;
    if (!shouldAutoStopRecording(recordingElapsedSeconds)) return;
    void stop();
  }, [recording, recordingElapsedSeconds, stop, transcribing]);

  return {
    supported,
    busy,
    recording,
    transcribing,
    error,
    diagnosticsText,
    status,
    start,
    stop,
    toggle,
  };
}
