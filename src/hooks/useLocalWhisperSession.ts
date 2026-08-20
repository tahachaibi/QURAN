import { useCallback, useEffect, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system';
// Direct file-path imports: Expo SDK 52's Metro does not read the package
// "exports" map, and the map has no bare "." entry — real paths work in both
// Metro and TypeScript (typed via src/types/whisper-rn.d.ts).
import { initWhisper } from 'whisper.rn/lib/module/index';
import type { WhisperContext } from 'whisper.rn/lib/module/index';
import { AudioPcmStreamAdapter } from 'whisper.rn/lib/module/realtime-transcription/adapters/AudioPcmStreamAdapter';
import {
  alignTranscript,
  tokenize,
  wordsSimilar,
} from '../utils/recitationMatcher';

/**
 * "Precise" engine, ON-DEVICE: the Tarteel Quran-tuned Whisper model runs on
 * the phone via whisper.cpp over one CONTINUOUS PCM stream.
 *
 * The transcription loop is deliberately NOT whisper.rn's RealtimeTranscriber:
 * that class queues a re-transcription of the whole growing slice every 200ms
 * while each pass takes seconds on a phone CPU, so the queue backlog explodes
 * and updates stop arriving. Here a single pump transcribes the FRESHEST
 * audio snapshot, waits for it to finish, then immediately transcribes
 * whatever is fresh now — zero backlog by construction. Slices are cut at
 * breath pauses (tail silence), so no word is split at a boundary.
 *
 * The model (~80MB ggml) is downloaded once from the dev server
 * (EXPO_PUBLIC_ASR_URL/model) into the app's documents directory.
 *
 * Mirrors useRecitationSession's return shape.
 */

const MODEL_FILE = 'ggml-quran.bin';

// 16kHz mono s16le.
const BYTES_PER_SEC = 32000;
// Don't bother transcribing less than this much audio.
const MIN_FIRST_BYTES = Math.round(0.7 * BYTES_PER_SEC);
// A new pass needs at least this much fresh audio since the last one.
const MIN_NEW_BYTES = Math.round(0.3 * BYTES_PER_SEC);
// From here on, cut the slice at the next breath pause…
const SOFT_SLICE_BYTES = 10 * BYTES_PER_SEC;
// …and here cut unconditionally (keeping 1s overlap so no word is lost).
const HARD_SLICE_BYTES = 16 * BYTES_PER_SEC;
const HARD_OVERLAP_BYTES = 1 * BYTES_PER_SEC;
// "Breath pause": RMS of the trailing window below this (int16 scale).
const SILENCE_TAIL_BYTES = Math.round(0.35 * BYTES_PER_SEC);
const SILENCE_RMS = 350;

// whisper.rn's native layer rejects promises with a plain {message, code}
// object, not an Error — extract the human-readable part from anything.
function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

// ggml whisper models start with int32 0x67676d6c ("ggml") — little-endian
// on disk that's the ASCII bytes "lmgg", which is "bG1nZw==" in base64.
const GGML_MAGIC_B64 = 'bG1nZw==';

async function isGgmlFile(path: string): Promise<boolean> {
  try {
    const head = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: 4,
    });
    return head === GGML_MAGIC_B64;
  } catch {
    return false;
  }
}

async function ensureModel(
  serverUrl: string,
  onProgress: (pct: number) => void
): Promise<string> {
  const dest = `${FileSystem.documentDirectory}${MODEL_FILE}`;
  const info = await FileSystem.getInfoAsync(dest);
  if (
    info.exists &&
    (info.size ?? 0) > 10_000_000 &&
    (await isGgmlFile(dest))
  ) {
    return dest;
  }
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
    if (res && res.status === 404) {
      throw new Error(
        'Model not on server yet — run: bash server/convert-ggml.sh, then restart scripts/dev.sh'
      );
    }
    throw new Error(
      `Model download failed (HTTP ${res?.status ?? '?'}) — is scripts/dev.sh running?`
    );
  }
  // A tunnel/proxy error page or an error-JSON can still arrive as HTTP 200 —
  // never hand a wrong or truncated file to whisper.cpp.
  const dled = await FileSystem.getInfoAsync(dest);
  const size = dled.exists ? dled.size ?? 0 : 0;
  if (size < 10_000_000 || !(await isGgmlFile(dest))) {
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
    throw new Error(
      `Server sent something that isn't the model (${Math.round(size / 1024)}KB, not ggml) — restart scripts/dev.sh and retry`
    );
  }
  // Catch tunnel truncation: the server tells us the exact expected size.
  try {
    const h = await fetch(`${serverUrl}/health`);
    const health = (await h.json()) as { ggml_size?: number };
    if (health.ggml_size && health.ggml_size !== size) {
      await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
      throw new Error(
        `Download truncated (${size} of ${health.ggml_size} bytes) — tap the mic to retry`
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Download truncated')) {
      throw e;
    }
    // Health check unreachable — the size+magic checks above still passed.
  }
  return dest;
}

// Module-level so the loaded model survives screen remounts (loading takes
// a few seconds; the weights are ~150MB in RAM).
let ctxPromise: Promise<WhisperContext> | null = null;

function getWhisperContext(
  serverUrl: string,
  onProgress: (pct: number) => void
): Promise<WhisperContext> {
  if (!ctxPromise) {
    ctxPromise = (async () => {
      const path = await ensureModel(serverUrl, onProgress);
      try {
        // whisper.cpp expects a plain filesystem path, not a file:// URI.
        // useGpu off: Android GPU delegates fail to init on many devices,
        // and the base model is fast enough on CPU.
        return await initWhisper({
          filePath: path.replace(/^file:\/\//, ''),
          useGpu: false,
        });
      } catch (e) {
        // Corrupt cache — drop it so the next attempt re-downloads.
        await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
        throw new Error(
          `Model failed to load (${errText(e)}) — tap the mic to re-download`
        );
      }
    })().catch((e) => {
      ctxPromise = null; // allow retry
      throw e;
    });
  }
  return ctxPromise;
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function tailIsSilent(buf: Uint8Array): boolean {
  const tail = Math.min(SILENCE_TAIL_BYTES, buf.length) & ~1;
  if (tail < 3200) return false;
  const start = buf.length - tail;
  let sumSq = 0;
  const n = tail / 2;
  for (let i = 0; i < n; i++) {
    const lo = buf[start + i * 2];
    const hi = buf[start + i * 2 + 1];
    let s = (hi << 8) | lo;
    if (s >= 0x8000) s -= 0x10000;
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / n) < SILENCE_RMS;
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
  // Incremented on every start/stop — a start superseded mid-download must
  // not resurrect the session.
  const startSeqRef = useRef(0);
  // Incremented on seekTo — an in-flight pass from before the jump must not
  // write its stale text into the fresh session.
  const epochRef = useRef(0);

  // ── Streaming state ──
  const ctxRef = useRef<WhisperContext | null>(null);
  const adapterRef = useRef<AudioPcmStreamAdapter | null>(null);
  const chunksRef = useRef<Uint8Array[]>([]);
  const bytesRef = useRef(0);
  const lastPassBytesRef = useRef(0);
  const busyRef = useRef(false);
  const sliceIdxRef = useRef(0);
  const taskRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const pumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // One transcription at a time, always over the freshest audio. Re-arms
  // itself after every pass; cheap no-op when there's nothing new.
  const pump = useCallback(async () => {
    if (!activeRef.current || busyRef.current) return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    const total = bytesRef.current;
    const minBytes = sliceTextsRef.current.get(sliceIdxRef.current)
      ? MIN_NEW_BYTES
      : MIN_FIRST_BYTES;
    if (total < minBytes) return;
    if (total - lastPassBytesRef.current < MIN_NEW_BYTES) return;

    busyRef.current = true;
    const seq = startSeqRef.current;
    const epoch = epochRef.current;
    const slice = sliceIdxRef.current;
    const buf = concatChunks(chunksRef.current, total);
    try {
      const durSec = buf.length / BYTES_PER_SEC;
      // audio_ctx trick: only encode as many frames as the audio needs
      // (50/s) — cuts the fixed 30s-window encode cost massively.
      const audioCtx = Math.min(1500, Math.ceil(durSec * 50) + 64);
      const task = ctx.transcribeData(buf.buffer as ArrayBuffer, {
        language: 'ar',
        temperature: 0,
        maxThreads: 4,
        audioCtx,
      } as Parameters<WhisperContext['transcribeData']>[1]);
      taskRef.current = task;
      const res = await task.promise;
      taskRef.current = null;
      if (
        seq !== startSeqRef.current ||
        epoch !== epochRef.current ||
        !activeRef.current
      ) {
        return;
      }
      lastPassBytesRef.current = total;
      const text = (res?.result ?? '').replace(/\[[^\]]*\]/g, ' ').trim();
      sliceTextsRef.current.set(slice, text);
      if (text) setLastHeard(text);
      applyFullText();

      // Slice rollover — at a breath pause once long enough, or forcibly
      // (with 1s overlap) if the reciter never pauses.
      if (
        bytesRef.current >= HARD_SLICE_BYTES ||
        (bytesRef.current >= SOFT_SLICE_BYTES && tailIsSilent(buf))
      ) {
        const whole = concatChunks(chunksRef.current, bytesRef.current);
        const keep =
          bytesRef.current >= HARD_SLICE_BYTES
            ? whole.slice(whole.length - HARD_OVERLAP_BYTES)
            : null;
        sliceIdxRef.current = slice + 1;
        chunksRef.current = keep ? [keep] : [];
        bytesRef.current = keep ? keep.length : 0;
        lastPassBytesRef.current = 0;
      }
    } catch (e) {
      taskRef.current = null;
      if (seq === startSeqRef.current && activeRef.current) {
        setError(errText(e));
      }
    } finally {
      busyRef.current = false;
      if (activeRef.current) {
        if (pumpTimerRef.current) clearTimeout(pumpTimerRef.current);
        pumpTimerRef.current = setTimeout(() => void pump(), 150);
      }
    }
  }, [applyFullText]);
  const pumpRef = useRef(pump);
  pumpRef.current = pump;

  const stopStream = useCallback(async () => {
    if (pumpTimerRef.current) {
      clearTimeout(pumpTimerRef.current);
      pumpTimerRef.current = null;
    }
    const task = taskRef.current;
    taskRef.current = null;
    await task?.stop().catch(() => {});
    const adapter = adapterRef.current;
    adapterRef.current = null;
    if (adapter) {
      await adapter.stop().catch(() => {});
      await adapter.release().catch(() => {});
    }
  }, []);

  const start = useCallback(async () => {
    const seq = ++startSeqRef.current;
    setError(null);
    // Activate the UI IMMEDIATELY — the first run downloads ~80MB and loads
    // the model, which takes a while; the reciter must see progress, and the
    // stop button must be able to cancel.
    activeRef.current = true;
    setActive(true);
    setLastHeard('… preparing model');
    let ctx: WhisperContext;
    try {
      ctx = await getWhisperContext(serverUrlRef.current, (pct) =>
        setLastHeard(`⬇️ downloading model ${pct}% (one-time)`)
      );
    } catch (e) {
      if (seq === startSeqRef.current) {
        activeRef.current = false;
        setActive(false);
        setError(errText(e));
        setLastHeard(null);
      }
      return;
    }
    // Stopped or restarted while the model was loading.
    if (seq !== startSeqRef.current || !activeRef.current) return;
    ctxRef.current = ctx;

    sessionBaseRef.current = cursorRef.current;
    everMatchedRef.current = false;
    noMatchFiredAtRef.current = 0;
    sliceTextsRef.current = new Map();
    sliceIdxRef.current = 0;
    chunksRef.current = [];
    bytesRef.current = 0;
    lastPassBytesRef.current = 0;
    busyRef.current = false;
    setLastHeard('🎧 listening…');

    try {
      const adapter = new AudioPcmStreamAdapter();
      adapter.onData((sd: { data: Uint8Array }) => {
        if (!activeRef.current || seq !== startSeqRef.current) return;
        chunksRef.current.push(sd.data);
        bytesRef.current += sd.data.length;
        void pumpRef.current();
      });
      adapter.onError((err: string) => {
        if (activeRef.current) setError(String(err));
      });
      await adapter.initialize({
        sampleRate: 16000,
        channels: 1,
        bitsPerSample: 16,
        audioSource: 6, // VOICE_RECOGNITION
        bufferSize: 16 * 1024,
      });
      await adapter.start();
      adapterRef.current = adapter;
    } catch (e) {
      activeRef.current = false;
      setActive(false);
      setError(`Could not start microphone (${errText(e)})`);
    }
  }, []);

  const stop = useCallback(async () => {
    startSeqRef.current++;
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
    await stopStream();
  }, [stopStream]);

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
    // Fresh alignment epoch: drop buffered audio and any in-flight pass —
    // the words recited BEFORE the jump must not re-align from the new base.
    epochRef.current++;
    sliceTextsRef.current = new Map();
    sliceIdxRef.current++;
    chunksRef.current = [];
    bytesRef.current = 0;
    lastPassBytesRef.current = 0;
    const task = taskRef.current;
    taskRef.current = null;
    task?.stop().catch(() => {});
    // Wide re-lock window (8 words) until real progress: the reciter kept
    // going while the jump happened and is likely a few words past the
    // anchor by the time fresh audio arrives.
    everMatchedRef.current = false;
    noMatchFiredAtRef.current = 0;
    setCursor(clamped);
    setLivePos(clamped);
  }, []);

  /** On-device sessions can't adopt a live Android recognizer. */
  const adopt = useCallback(() => false, []);

  useEffect(() => {
    return () => {
      startSeqRef.current++;
      activeRef.current = false;
      void stopStream();
    };
  }, [stopStream]);

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
