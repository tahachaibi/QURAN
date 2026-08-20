import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import {
  alignTranscript,
  tokenize,
  wordsSimilar,
} from '../utils/recitationMatcher';

/**
 * "Precise" recitation engine: records short audio chunks with expo-av and
 * sends them to the Quran-tuned Whisper server (see server/). Far more
 * accurate on tajwid-style recitation than Android's generic recognizer, at
 * the cost of ~2-4s of highlight lag (Whisper is not a streaming model).
 *
 * Mirrors useRecitationSession's return shape so the recite screen can treat
 * both engines interchangeably.
 */

// Whisper garbles very short clips — 4s chunks carry enough context for
// clean transcripts while keeping the follow lag tolerable.
const CHUNK_MS = 4000;

const RECORDING_OPTS: Audio.RecordingOptions = {
  isMeteringEnabled: false,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 64000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {},
};

export interface WhisperSessionOptions {
  serverUrl: string;
  onNoMatch?: (transcript: string) => void;
  /** Next expected display words from a cursor — biases Whisper decoding. */
  getHint?: (cursor: number) => string;
}

export function useWhisperSession(
  expectedNorm: string[],
  { serverUrl, onNoMatch, getHint }: WhisperSessionOptions
) {
  const [cursor, setCursor] = useState(0);
  const [livePos, setLivePos] = useState(0);
  const [missed, setMissed] = useState<Map<number, string | null>>(new Map());
  const [peeked, setPeeked] = useState<Set<number>>(new Set());
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Latest server transcript (or status) — surfaced for visibility. */
  const [lastHeard, setLastHeard] = useState<string | null>(null);

  const expectedRef = useRef(expectedNorm);
  expectedRef.current = expectedNorm;
  const serverUrlRef = useRef(serverUrl);
  serverUrlRef.current = serverUrl;
  const onNoMatchRef = useRef(onNoMatch);
  onNoMatchRef.current = onNoMatch;
  const getHintRef = useRef(getHint);
  getHintRef.current = getHint;

  const activeRef = useRef(false);
  const cursorRef = useRef(0);
  const missedRef = useRef<Map<number, string | null>>(new Map());
  const everMatchedRef = useRef(false);
  const noMatchBufferRef = useRef<string[]>([]);
  const recRef = useRef<Audio.Recording | null>(null);
  // Serializes transcript application so chunks apply in recording order.
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);

  const applyChunk = useCallback((text: string) => {
    if (!activeRef.current || !text.trim()) return;
    const base = cursorRef.current;
    const { cursor: c, pos, missed: m } = alignTranscript(
      expectedRef.current,
      base,
      text,
      everMatchedRef.current ? 3 : 8
    );
    const next = Math.max(c, cursorRef.current);

    // Cross-chunk healing: a word flagged missed earlier that shows up in
    // this chunk was split across a boundary, not misread.
    if (missedRef.current.size > 0) {
      const heardTokens = tokenize(text);
      const healedMap = new Map(missedRef.current);
      let healed = false;
      for (const idx of healedMap.keys()) {
        if (idx < next - 15) continue;
        if (heardTokens.some((h) => wordsSimilar(expectedRef.current[idx], h))) {
          healedMap.delete(idx);
          healed = true;
        }
      }
      if (healed) missedRef.current = healedMap;
    }

    const merged = new Map(missedRef.current);
    for (const mw of m) merged.set(mw.index, mw.heard);
    missedRef.current = merged;
    cursorRef.current = next;
    setCursor(next);
    setLivePos(pos);
    setMissed(merged);

    if (next > base + 1) {
      everMatchedRef.current = true;
      noMatchBufferRef.current = [];
    } else if (onNoMatchRef.current) {
      // No progress — accumulate for the verse search.
      noMatchBufferRef.current.push(text);
      const joined = noMatchBufferRef.current.join(' ');
      const words = joined.trim().split(/\s+/).length;
      const needed = everMatchedRef.current ? 5 : 3;
      if (words >= needed) {
        onNoMatchRef.current(joined);
      }
    }
  }, []);

  const transcribeChunk = useCallback(async (uri: string) => {
    const form = new FormData();
    form.append('file', {
      uri,
      name: 'chunk.m4a',
      type: 'audio/mp4',
    } as unknown as Blob);
    // Only bias decoding with the expected text once the session has locked
    // onto the reciter. Before that, Whisper tends to ECHO the prompt — so a
    // reciter of a DIFFERENT surah would get transcripts of this surah's
    // words, silently blocking the verse search.
    if (everMatchedRef.current) {
      const hint = getHintRef.current?.(cursorRef.current) ?? '';
      if (hint) form.append('hint', hint);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch(`${serverUrlRef.current}/transcribe`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`ASR server ${res.status}`);
      const json = await res.json();
      return String(json.text ?? '');
    } finally {
      clearTimeout(timer);
    }
  }, []);

  const recordLoop = useCallback(async () => {
    while (activeRef.current) {
      let rec: Audio.Recording | null = null;
      try {
        rec = new Audio.Recording();
        await rec.prepareToRecordAsync(RECORDING_OPTS);
        await rec.startAsync();
        recRef.current = rec;
      } catch {
        setError('Could not start microphone');
        activeRef.current = false;
        setActive(false);
        return;
      }
      // Sleep in small steps so stop() reacts quickly.
      for (let waited = 0; waited < CHUNK_MS && activeRef.current; waited += 200) {
        await new Promise((r) => setTimeout(r, 200));
      }
      try {
        await rec.stopAndUnloadAsync();
      } catch {
        continue;
      }
      const uri = rec.getURI();
      recRef.current = null;
      if (uri && activeRef.current) {
        if (pendingRef.current >= 3) {
          // Server can't keep up — drop this chunk rather than falling
          // minutes behind. Healing absorbs an occasional lost chunk.
          setLastHeard('⏳ server busy — skipped a chunk');
          continue;
        }
        pendingRef.current += 1;
        // Transcribe in the background (ordered) while the next chunk records.
        chainRef.current = chainRef.current
          .then(() => transcribeChunk(uri))
          .then((text) => {
            setLastHeard(text.trim() ? text.trim() : '🔇 (silence)');
            applyChunk(text);
          })
          .catch((e: unknown) => {
            if (activeRef.current) {
              const msg = e instanceof Error ? e.message : 'unreachable';
              setLastHeard(null);
              setError(`ASR server: ${msg}`);
            }
          })
          .then(() => {
            pendingRef.current -= 1;
          });
      }
    }
  }, [applyChunk, transcribeChunk]);

  const start = useCallback(async () => {
    setError(null);
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) {
      setError('Microphone permission denied');
      return;
    }
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });
    activeRef.current = true;
    setActive(true);
    everMatchedRef.current = false;
    noMatchBufferRef.current = [];
    setLastHeard('… connecting to ASR server');
    // Warm the tunnel + model so the first real chunk is fast.
    fetch(`${serverUrlRef.current}/health`)
      .then(() => setLastHeard('🎯 listening…'))
      .catch(() => setError('ASR server unreachable — is scripts/dev.sh running?'));
    recordLoop();
  }, [recordLoop]);

  const stop = useCallback(async () => {
    activeRef.current = false;
    setActive(false);
    try {
      await recRef.current?.stopAndUnloadAsync();
    } catch {
      // already stopped
    }
    recRef.current = null;
  }, []);

  const reset = useCallback(async () => {
    await stop();
    cursorRef.current = 0;
    missedRef.current = new Map();
    setCursor(0);
    setLivePos(0);
    setMissed(new Map());
    setPeeked(new Set());
    setError(null);
    everMatchedRef.current = false;
    noMatchBufferRef.current = [];
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
    const m = new Map(missedRef.current);
    m.delete(index);
    missedRef.current = m;
    setMissed(m);
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
    everMatchedRef.current = true;
    noMatchBufferRef.current = [];
    setCursor(clamped);
    setLivePos(clamped);
  }, []);

  /** Whisper sessions can't adopt a live Android recognizer. */
  const adopt = useCallback(() => false, []);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      recRef.current?.stopAndUnloadAsync().catch(() => {});
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
