import { useCallback, useEffect, useRef, useState } from 'react';
import Voice from '@react-native-voice/voice';
import { alignTranscript } from '../utils/recitationMatcher';

/**
 * Continuous recitation-follow session.
 *
 * Android's SpeechRecognizer stops after a pause, so we auto-restart it while
 * the session is active. Partial results re-transcribe the whole utterance as
 * it grows, so alignment always re-runs from the cursor position committed at
 * the start of the current utterance (`baseCursor`), keeping it idempotent.
 */
export function useRecitationSession(expectedNorm: string[]) {
  const [cursor, setCursor] = useState(0);
  const [missed, setMissed] = useState<Set<number>>(new Set());
  const [peeked, setPeeked] = useState<Set<number>>(new Set());
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expectedRef = useRef(expectedNorm);
  expectedRef.current = expectedNorm;
  const activeRef = useRef(false);
  const baseCursorRef = useRef(0);
  const cursorRef = useRef(0);
  const baseMissedRef = useRef<number[]>([]);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyTranscript = useCallback((text: string, isFinal: boolean) => {
    if (!activeRef.current || !text) return;
    const { cursor: c, missed: m } = alignTranscript(
      expectedRef.current,
      baseCursorRef.current,
      text
    );
    // A peek may have pushed the cursor past what this utterance derives —
    // never move backwards.
    const next = Math.max(c, cursorRef.current);
    cursorRef.current = next;
    setCursor(next);
    setMissed(new Set([...baseMissedRef.current, ...m]));
    if (isFinal) {
      baseCursorRef.current = next;
      baseMissedRef.current = [...baseMissedRef.current, ...m];
    }
  }, []);

  const restart = useCallback(() => {
    if (!activeRef.current) return;
    if (restartTimer.current) clearTimeout(restartTimer.current);
    restartTimer.current = setTimeout(async () => {
      if (!activeRef.current) return;
      try {
        await Voice.start('ar-SA', { EXTRA_PARTIAL_RESULTS: true });
      } catch {
        // Recognizer busy — try once more shortly.
        restartTimer.current = setTimeout(() => {
          if (activeRef.current) {
            Voice.start('ar-SA', { EXTRA_PARTIAL_RESULTS: true }).catch(() =>
              setError('Could not restart microphone')
            );
          }
        }, 600);
      }
    }, 250);
  }, []);

  useEffect(() => {
    Voice.onSpeechPartialResults = (e: any) => {
      applyTranscript(e.value?.[0] ?? '', false);
    };
    Voice.onSpeechResults = (e: any) => {
      applyTranscript(e.value?.[0] ?? '', true);
      restart();
    };
    Voice.onSpeechEnd = () => {
      restart();
    };
    Voice.onSpeechError = (e: any) => {
      const code = String(e.error?.code ?? '').split('/')[0];
      // Transient recognizer hiccups — normal during pauses in recitation.
      // 5 = client, 6 = speech timeout, 7 = no match, 8 = recognizer busy,
      // 11 = didn't understand. All recoverable: restart silently.
      const transient = ['5', '6', '7', '8', '11'];
      if (transient.includes(code)) {
        restart();
      } else if (activeRef.current) {
        setError(e.error?.message ?? 'Recognition failed');
        restart();
      }
    };

    return () => {
      activeRef.current = false;
      if (restartTimer.current) clearTimeout(restartTimer.current);
      Voice.destroy().then(() => Voice.removeAllListeners()).catch(() => {});
    };
  }, [applyTranscript, restart]);

  const start = useCallback(async () => {
    setError(null);
    activeRef.current = true;
    setActive(true);
    try {
      await Voice.start('ar-SA', { EXTRA_PARTIAL_RESULTS: true });
    } catch {
      activeRef.current = false;
      setActive(false);
      setError('Could not start microphone');
    }
  }, []);

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
    baseMissedRef.current = [];
    setCursor(0);
    setMissed(new Set());
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
  }, []);

  return { cursor, missed, peeked, active, error, start, stop, reset, peekWord };
}
