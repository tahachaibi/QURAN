import { useCallback, useEffect, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system';
import { initWhisper } from 'whisper.rn/index';
import type { WhisperContext } from 'whisper.rn/index';
import { RealtimeTranscriber } from 'whisper.rn/realtime-transcription/index';
import type { RealtimeTranscribeEvent } from 'whisper.rn/realtime-transcription/index';
import { AudioPcmStreamAdapter } from 'whisper.rn/realtime-transcription/adapters/AudioPcmStreamAdapter';
import {
  alignTranscript,
  tokenize,
  wordsSimilar,
} from '../utils/recitationMatcher';

/**
 * "Precise" engine, ON-DEVICE: the Tarteel Quran-tuned Whisper model runs on
 * the phone via whisper.cpp with one CONTINUOUS audio stream — no chunk
 * files, no word-slicing at boundaries, no server round-trips, fully
 * offline once the model is cached.
 *
 * The model (~85MB ggml) is downloaded once from the dev server
 * (EXPO_PUBLIC_ASR_URL/model) into the app's documents directory.
 *
 * Mirrors useRecitationSession's return shape.
 */

const MODEL_FILE = 'ggml-quran.bin';

// Module-level so the loaded model survives screen remounts (loading takes
// a few seconds; the weights are ~150MB in RAM).
let ctxPromise: Promise<WhisperContext> | null = null;

async function ensureModel(
  serverUrl: string,
  onProgress: (pct: number) => void
): Promise<string> {
  const dest = `${FileSystem.documentDirectory}${MODEL_FILE}`;
  const info = await FileSystem.getInfoAsync(dest);
  if (info.exists && (info.size ?? 0) > 10_000_000) return dest;
  if (!serverUrl) {
    throw new Error(
      'Model not downloaded yet — start scripts/dev.sh once and retry'
    );
  }
  const dl = FileSystem.createDownloadResumable(
    `${serverUrl}/model`,
    dest,
    {},
    (p) => {
      if (p.totalBytesExpectedToWrite > 0) {
        onProgress(
          Math.round((p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100)
        );
      }
    }
  );
  const res = await dl.downloadAsync();
  if (!res || res.status !== 200) {
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
    throw new Error('Model download failed — is the dev server running?');
  }
  return dest;
}

function getWhisperContext(
  serverUrl: string,
  onProgress: (pct: number) => void
): Promise<WhisperContext> {
  if (!ctxPromise) {
    ctxPromise = (async () => {
      const path = await ensureModel(serverUrl, onProgress);
      // whisper.cpp expects a plain filesystem path, not a file:// URI.
      return initWhisper({ filePath: path.replace(/^file:\/\//, '') });
    })().catch((e) => {
      ctxPromise = null; // allow retry
      throw e;
    });
  }
  return ctxPromise;
}

export interface LocalWhisperOptions {
  /** Used only to download the model the first time. */
  serverUrl: string;
  onNoMatch?: (transcript: string) => void;
}

export function useLocalWhisperSession(
  expectedNorm: string[],
  { serverUrl, onNoMatch }: LocalWhisperOptions
) {
  const [cursor, setCursor] = useState(0);
  const [livePos, setLivePos] = useState(0);
  const [missed, setMissed] = useState<Map<number, string | null>>(new Map());
  const [peeked, setPeeked] = useState<Set<number>>(new Set());
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHeard, setLastHeard] = useState<string | null>(null);

  const expectedRef = useRef(expectedNorm);
  expectedRef.current = expectedNorm;
  const serverUrlRef = useRef(serverUrl);
  serverUrlRef.current = serverUrl;
  const onNoMatchRef = useRef(onNoMatch);
  onNoMatchRef.current = onNoMatch;

  const activeRef = useRef(false);
  const cursorRef = useRef(0);
  // Cursor value when this listening session started — the whole continuous
  // session aligns from here (idempotent as the transcript grows).
  const sessionBaseRef = useRef(0);
  const baseMissedRef = useRef<Map<number, string | null>>(new Map());
  const everMatchedRef = useRef(false);
  const noMatchFiredAtRef = useRef(0);
  const sliceTextsRef = useRef<Map<number, string>>(new Map());
  const transcriberRef = useRef<RealtimeTranscriber | null>(null);

  const applyFullText = useCallback(() => {
    if (!activeRef.current) return;
    const fullText = [...sliceTextsRef.current.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, t]) => t)
      .join(' ')
      .trim();
    if (!fullText) return;

    const base = sessionBaseRef.current;
    const { cursor: c, pos, missed: m } = alignTranscript(
      expectedRef.current,
      base,
      fullText,
      everMatchedRef.current ? 3 : 8
    );

    const advance = c - base;
    const isRealProgress = advance >= (everMatchedRef.current ? 1 : 3);

    if (!isRealProgress) {
      // Feed the verse search with the freshest words only.
      if (onNoMatchRef.current) {
        const words = tokenize(fullText);
        const trimmed = words.slice(-12);
        const needed = everMatchedRef.current ? 5 : 3;
        if (
          trimmed.length >= needed &&
          words.length >= noMatchFiredAtRef.current + 2
        ) {
          noMatchFiredAtRef.current = words.length;
          onNoMatchRef.current(trimmed.join(' '));
        }
      }
      return;
    }
    everMatchedRef.current = true;

    const next = Math.max(c, cursorRef.current);

    // Heal recent misses whose word appears anywhere in the session text.
    let missBase = baseMissedRef.current;
    if (missBase.size > 0) {
      const heardTokens = tokenize(fullText);
      const healedMap = new Map(missBase);
      let healed = false;
      for (const idx of healedMap.keys()) {
        if (idx < next - 15) continue;
        if (heardTokens.some((h) => wordsSimilar(expectedRef.current[idx], h))) {
          healedMap.delete(idx);
          healed = true;
        }
      }
      if (healed) {
        baseMissedRef.current = healedMap;
        missBase = healedMap;
      }
    }

    const merged = new Map(missBase);
    for (const mw of m) merged.set(mw.index, mw.heard);
    cursorRef.current = next;
    setCursor(next);
    setLivePos(pos);
    setMissed((prev) => {
      if (prev.size === merged.size) {
        let same = true;
        for (const [k, v] of merged) {
          if (!prev.has(k) || prev.get(k) !== v) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return merged;
    });
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setLastHeard('… loading model');
    let ctx: WhisperContext;
    try {
      ctx = await getWhisperContext(serverUrlRef.current, (pct) =>
        setLastHeard(`⬇️ downloading model ${pct}%`)
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Model unavailable');
      setLastHeard(null);
      return;
    }

    activeRef.current = true;
    setActive(true);
    sessionBaseRef.current = cursorRef.current;
    everMatchedRef.current = false;
    noMatchFiredAtRef.current = 0;
    sliceTextsRef.current = new Map();
    setLastHeard('🎧 listening…');

    try {
      const audioStream = new AudioPcmStreamAdapter();
      const transcriber = new RealtimeTranscriber(
        { whisperContext: ctx, audioStream },
        {
          audioSliceSec: 25,
          audioMinSec: 0.8,
          audioStreamConfig: { sampleRate: 16000, channels: 1 },
          // Alignment handles continuity across slices; prompting previous
          // slices makes Whisper echo them, corrupting the verse search.
          promptPreviousSlices: false,
          transcribeOptions: { language: 'ar', temperature: 0 },
        },
        {
          onTranscribe: (evt: RealtimeTranscribeEvent) => {
            const text = evt.data?.result ?? '';
            sliceTextsRef.current.set(evt.sliceIndex, text);
            if (text.trim()) setLastHeard(text.trim());
            applyFullText();
          },
          onError: (err: string) => {
            if (activeRef.current) setError(String(err));
          },
        }
      );
      transcriberRef.current = transcriber;
      await transcriber.start();
    } catch (e) {
      activeRef.current = false;
      setActive(false);
      setError(e instanceof Error ? e.message : 'Could not start microphone');
    }
  }, [applyFullText]);

  const stop = useCallback(async () => {
    activeRef.current = false;
    setActive(false);
    // The session's confirmed misses become permanent on stop.
    const fullText = [...sliceTextsRef.current.values()].join(' ');
    if (fullText.trim() && everMatchedRef.current) {
      const { missed: m } = alignTranscript(
        expectedRef.current,
        sessionBaseRef.current,
        fullText,
        3
      );
      const merged = new Map(baseMissedRef.current);
      for (const mw of m) merged.set(mw.index, mw.heard);
      baseMissedRef.current = merged;
    }
    const t = transcriberRef.current;
    transcriberRef.current = null;
    try {
      await t?.stop();
      await t?.release();
    } catch {
      // already stopped
    }
  }, []);

  const reset = useCallback(async () => {
    await stop();
    cursorRef.current = 0;
    sessionBaseRef.current = 0;
    baseMissedRef.current = new Map();
    sliceTextsRef.current = new Map();
    everMatchedRef.current = false;
    noMatchFiredAtRef.current = 0;
    setCursor(0);
    setLivePos(0);
    setMissed(new Map());
    setPeeked(new Set());
    setError(null);
    setLastHeard(null);
  }, [stop]);

  const peekWord = useCallback(() => {
    const c = cursorRef.current;
    if (c >= expectedRef.current.length) return;
    setPeeked((p) => new Set(p).add(c));
    cursorRef.current = c + 1;
    setCursor(c + 1);
    setLivePos(c + 1);
  }, []);

  const dismissMiss = useCallback((index: number) => {
    const m = new Map(baseMissedRef.current);
    m.delete(index);
    baseMissedRef.current = m;
    setMissed((prev) => {
      const p = new Map(prev);
      p.delete(index);
      return p;
    });
    setPeeked((prev) => {
      if (!prev.has(index)) return prev;
      const p = new Set(prev);
      p.delete(index);
      return p;
    });
  }, []);

  const seekTo = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(index, expectedRef.current.length));
    cursorRef.current = clamped;
    sessionBaseRef.current = clamped;
    sliceTextsRef.current = new Map();
    everMatchedRef.current = true;
    noMatchFiredAtRef.current = 0;
    setCursor(clamped);
    setLivePos(clamped);
  }, []);

  /** On-device sessions can't adopt a live Android recognizer. */
  const adopt = useCallback(() => false, []);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      const t = transcriberRef.current;
      transcriberRef.current = null;
      t?.stop()
        .then(() => t.release())
        .catch(() => {});
    };
  }, []);

  return {
    cursor,
    livePos,
    missed,
    peeked,
    active,
    error,
    lastHeard,
    start,
    stop,
    reset,
    peekWord,
    dismissMiss,
    seekTo,
    adopt,
  };
}
