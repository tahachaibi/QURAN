import { useCallback, useEffect, useRef, useState } from 'react';
import Voice from '@react-native-voice/voice';
import {
  alignCandidates,
  tokenize,
  wordsSimilar,
} from '../utils/recitationMatcher';

// ── Cross-screen microphone handoff ─────────────────────────────────────────
// A cross-surah verse jump replaces the screen. Destroying and restarting the
// recognizer across that transition loses ~1-2s of speech — the reciter's
// words in that window vanish and the new session can't catch up. Instead the
// outgoing screen marks a handoff: its cleanup leaves the engine running, and
// the incoming screen adopts the live utterance mid-stream.
let pendingHandoff = false;
let handoffSafety: ReturnType<typeof setTimeout> | null = null;

export function prepareVoiceHandoff() {
  pendingHandoff = true;
  if (handoffSafety) clearTimeout(handoffSafety);
  // If no screen adopts within 5s (navigation failed), stop the engine so
  // the microphone doesn't stay hot forever.
  handoffSafety = setTimeout(() => {
    if (pendingHandoff) {
      pendingHandoff = false;
      Voice.destroy().catch(() => {});
    }
  }, 5000);
}

// Recognizer tuning for continuous recitation: stream partial results with
// several alternatives, and stretch the silence windows so a breath pause
// does NOT end the utterance — utterance restarts are the biggest source of
// reveal latency (each one costs ~0.5-1s of deaf time).
const START_OPTS = {
  EXTRA_PARTIAL_RESULTS: true,
  EXTRA_MAX_RESULTS: 5,
  EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 6000,
  EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 6000,
  EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 30000,
};

/**
 * Continuous recitation-follow session.
 *
 * Android's SpeechRecognizer stops after a pause, so we auto-restart it while
 * the session is active. Partial results re-transcribe the whole utterance as
 * it grows, so alignment always re-runs from the cursor position committed at
 * the start of the current utterance (`baseCursor`), keeping it idempotent.
 * Final results carry up to 5 alternatives — all are aligned and the best
 * outcome wins, which materially reduces false misses on Quranic Arabic.
 */
export interface RecitationSessionOptions {
  /**
   * Called with the final transcript when the reciter has been speaking but
   * nothing matched from the session anchor — e.g. they are reciting a
   * different verse entirely. Lets the screen run a global verse search.
   */
  onNoMatch?: (transcript: string) => void;
}

export function useRecitationSession(
  expectedNorm: string[],
  options: RecitationSessionOptions = {}
) {
  const [cursor, setCursor] = useState(0);
  /** Live position — can sit behind `cursor` during a breath-restart replay. */
  const [livePos, setLivePos] = useState(0);
  /** Missed expected-word index → best-effort normalized "what was heard". */
  const [missed, setMissed] = useState<Map<number, string | null>>(new Map());
  const [peeked, setPeeked] = useState<Set<number>>(new Set());
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expectedRef = useRef(expectedNorm);
  expectedRef.current = expectedNorm;
  const onNoMatchRef = useRef(options.onNoMatch);
  onNoMatchRef.current = options.onNoMatch;
  const activeRef = useRef(false);
  const baseCursorRef = useRef(0);
  const cursorRef = useRef(0);
  const baseMissedRef = useRef<Map<number, string | null>>(new Map());
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The cursor value when listening began — used to detect "reciting
  // something else entirely" (no progress despite hearing full phrases).
  const sessionAnchorRef = useRef(0);
  const everMatchedRef = useRef(false);
  // Word count of the last transcript onNoMatch fired for (avoids refiring
  // on every partial while the search is inconclusive).
  const noMatchFiredAtRef = useRef(0);
  // Timestamp of the last recognizer event — the adoption watchdog uses it.
  const lastEventAtRef = useRef(0);

  const applyCandidates = useCallback(
    (values: string[], isFinal: boolean) => {
      if (!activeRef.current || values.length === 0) return;
      lastEventAtRef.current = Date.now();
      // Until the session locks on (first real progress), search a wider
      // window — the reciter may start mid-verse or continue past a jump.
      const { cursor: c, pos, missed: m } = alignCandidates(
        expectedRef.current,
        baseCursorRef.current,
        values,
        everMatchedRef.current ? 3 : 8
      );
      // A peek may have pushed the cursor past what this utterance derives —
      // progress never moves backwards. The live position, however, may.
      const next = Math.max(c, cursorRef.current);
      cursorRef.current = next;
      setCursor(next);
      setLivePos(pos);

      // Cross-utterance healing: a recently-flagged miss whose word shows up
      // in THIS utterance was recognized late, not misread — retract it.
      if (baseMissedRef.current.size > 0) {
        const heardTokens = tokenize(values[0] ?? '');
        let healed = false;
        const healedBase = new Map(baseMissedRef.current);
        for (const idx of healedBase.keys()) {
          if (idx < next - 15) continue;
          const w = expectedRef.current[idx];
          if (heardTokens.some((h) => wordsSimilar(w, h))) {
            healedBase.delete(idx);
            healed = true;
          }
        }
        if (healed) baseMissedRef.current = healedBase;
      }

      const merged = new Map(baseMissedRef.current);
      for (const mw of m) merged.set(mw.index, mw.heard);
      // Preserve object identity when nothing changed — page components
      // memo-compare by reference, and a fresh Map every partial would
      // force a full re-render of every mushaf page on each word.
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
      if (next > sessionAnchorRef.current + 1) everMatchedRef.current = true;

      // Verse-search trigger: many heard words produced no cursor progress
      // in this utterance — the reciter is saying a different verse. Uses a
      // SURPLUS rule (heard minus progressed) rather than "no progress at
      // all": a recitation that opens with Bismillah matches the current
      // surah's own Bismillah first, which must not disarm the search.
      // Fires early from partials; refires only when 2+ more words arrived.
      if (onNoMatchRef.current) {
        const wordCount = (values[0] ?? '').trim().split(/\s+/).length;
        const progress = Math.max(0, next - baseCursorRef.current);
        const surplus = wordCount - progress;
        // Fresh sessions fire at 3 unmatched words (the search itself holds
        // back on ambiguous short phrases); locked-on sessions need 5.
        const needed = everMatchedRef.current ? 5 : 3;
        if (
          surplus >= needed &&
          wordCount >= noMatchFiredAtRef.current + 2
        ) {
          noMatchFiredAtRef.current = wordCount;
          onNoMatchRef.current(values[0]);
        }
      }

      if (isFinal) {
        baseCursorRef.current = next;
        baseMissedRef.current = merged;
        noMatchFiredAtRef.current = 0;
      }
    },
    []
  );

  // Voice's event handlers are GLOBAL singletons — when one screen replaces
  // another (cross-surah verse search), the old screen's async cleanup can
  // wipe the listeners the new screen just registered. Every (re)start
  // re-asserts ownership of the listeners so the active session always wins.
  const restartRef = useRef<() => void>(() => {});
  const attachListeners = useCallback(() => {
    Voice.onSpeechPartialResults = (e: any) => {
      applyCandidates(e.value ?? [], false);
    };
    Voice.onSpeechResults = (e: any) => {
      applyCandidates(e.value ?? [], true);
      restartRef.current();
    };
    Voice.onSpeechEnd = () => {
      restartRef.current();
    };
    Voice.onSpeechError = (e: any) => {
      const code = String(e.error?.code ?? '').split('/')[0];
      // Transient recognizer hiccups — normal during pauses in recitation.
      // 5 = client, 6 = speech timeout, 7 = no match, 8 = recognizer busy,
      // 11 = didn't understand. All recoverable: restart silently.
      const transient = ['5', '6', '7', '8', '11'];
      if (transient.includes(code)) {
        restartRef.current();
      } else if (activeRef.current) {
        setError(e.error?.message ?? 'Recognition failed');
        restartRef.current();
      }
    };
  }, [applyCandidates]);

  const restart = useCallback(() => {
    if (!activeRef.current) return;
    if (restartTimer.current) clearTimeout(restartTimer.current);
    restartTimer.current = setTimeout(async () => {
      if (!activeRef.current) return;
      attachListeners();
      try {
        await Voice.start('ar-SA', START_OPTS);
      } catch {
        // Recognizer busy — try once more shortly.
        restartTimer.current = setTimeout(() => {
          if (activeRef.current) {
            attachListeners();
            Voice.start('ar-SA', START_OPTS).catch(() =>
              setError('Could not restart microphone')
            );
          }
        }, 400);
      }
    }, 80);
  }, [attachListeners]);
  restartRef.current = restart;

  useEffect(() => {
    attachListeners();
    return () => {
      activeRef.current = false;
      if (restartTimer.current) clearTimeout(restartTimer.current);
      // During a cross-surah handoff the engine must keep running — the
      // incoming screen adopts the live utterance.
      if (!pendingHandoff) Voice.destroy().catch(() => {});
    };
  }, [attachListeners]);

  const start = useCallback(async () => {
    setError(null);
    activeRef.current = true;
    setActive(true);
    sessionAnchorRef.current = cursorRef.current;
    everMatchedRef.current = false;
    noMatchFiredAtRef.current = 0;
    attachListeners();
    try {
      await Voice.start('ar-SA', {
        EXTRA_PARTIAL_RESULTS: true,
        EXTRA_MAX_RESULTS: 5,
      });
    } catch {
      // A predecessor screen may still be tearing its recognizer down
      // (cross-surah navigation) — retry once after it settles.
      await new Promise((r) => setTimeout(r, 500));
      if (!activeRef.current) return;
      attachListeners();
      try {
        await Voice.start('ar-SA', START_OPTS);
      } catch {
        activeRef.current = false;
        setActive(false);
        setError('Could not start microphone');
      }
    }
  }, [attachListeners]);

  const stop = useCallback(async () => {
    activeRef.current = false;
    setActive(false);
    if (restartTimer.current) clearTimeout(restartTimer.current);
    try {
      await Voice.stop();
    } catch {
      // already stopped
    }
  }, []);

  const reset = useCallback(async () => {
    await stop();
    baseCursorRef.current = 0;
    cursorRef.current = 0;
    baseMissedRef.current = new Map();
    setCursor(0);
    setLivePos(0);
    setMissed(new Map());
    setPeeked(new Set());
    setError(null);
  }, [stop]);

  /** Manually reveal/advance one word (memorization "peek"). */
  const peekWord = useCallback(() => {
    const c = cursorRef.current;
    if (c >= expectedRef.current.length) return;
    setPeeked((p) => new Set(p).add(c));
    cursorRef.current = c + 1;
    baseCursorRef.current = Math.max(baseCursorRef.current, c + 1);
    setCursor(c + 1);
    setLivePos(c + 1);
  }, []);

  /**
   * Adopt a live recognizer left running by the previous screen (cross-surah
   * jump). Returns false when no handoff is pending. The ongoing utterance's
   * transcript keeps flowing — aligned from wherever the session is anchored
   * — so the reciter's words during the transition are not lost.
   */
  const adopt = useCallback(() => {
    if (!pendingHandoff) return false;
    pendingHandoff = false;
    if (handoffSafety) clearTimeout(handoffSafety);
    activeRef.current = true;
    setActive(true);
    everMatchedRef.current = false;
    noMatchFiredAtRef.current = 0;
    lastEventAtRef.current = Date.now();
    attachListeners();
    // The utterance may have ended during the transition — if no event
    // arrives shortly, kick the recognizer back on.
    setTimeout(() => {
      if (activeRef.current && Date.now() - lastEventAtRef.current > 1400) {
        restartRef.current();
      }
    }, 1500);
    return true;
  }, [attachListeners]);

  /**
   * Jump the session to an arbitrary word index (voice verse search landed
   * somewhere else in the surah). Progress and highlight re-anchor there;
   * listening continues uninterrupted.
   */
  const seekTo = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(index, expectedRef.current.length));
    baseCursorRef.current = clamped;
    cursorRef.current = clamped;
    sessionAnchorRef.current = clamped;
    everMatchedRef.current = true;
    setCursor(clamped);
    setLivePos(clamped);
  }, []);

  /** User says a flagged mistake was actually correct — remove it. */
  const dismissMiss = useCallback((index: number) => {
    const base = new Map(baseMissedRef.current);
    base.delete(index);
    baseMissedRef.current = base;
    setMissed((prev) => {
      const m = new Map(prev);
      m.delete(index);
      return m;
    });
    setPeeked((prev) => {
      if (!prev.has(index)) return prev;
      const p = new Set(prev);
      p.delete(index);
      return p;
    });
  }, []);

  return {
    cursor,
    livePos,
    missed,
    peeked,
    active,
    error,
    start,
    stop,
    reset,
    peekWord,
    dismissMiss,
    seekTo,
    adopt,
  };
}
