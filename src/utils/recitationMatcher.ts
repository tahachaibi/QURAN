/**
 * Alignment engine for recitation follow-along.
 *
 * The recognizer produces noisy Arabic transcripts. Because we know the exact
 * text the user is supposed to recite, we don't transcribe — we ALIGN: each
 * transcript word is matched against a small look-ahead window of expected
 * words, advancing a cursor. This makes even a generic recognizer usable for
 * follow-along, since confirming "is the next word X?" is far easier than
 * open transcription.
 */

// Tashkeel + Quranic annotation marks (waqf signs, small high letters, etc.)
const STRIP_MARKS =
  /[ؐ-ًؚ-ٰٟۖ-ۭـࣰ-ࣿ]/g;

/** Normalize an Arabic word so recognizer output matches Uthmani script. */
export function normalizeWord(word: string): string {
  return word
    .replace(STRIP_MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ء/g, '')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^ء-ي]/g, '')
    .trim();
}

export function tokenize(text: string): string[] {
  return text.split(/\s+/).map(normalizeWord).filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Fuzzy match tuned for short Arabic words. */
export function wordsSimilar(expected: string, heard: string): boolean {
  if (!expected || !heard) return false;
  if (expected === heard) return true;
  const maxLen = Math.max(expected.length, heard.length);
  // Very short words (من، في، ما) — too easy to false-match fuzzily
  if (Math.min(expected.length, heard.length) <= 2) {
    return expected === heard;
  }
  const dist = levenshtein(expected, heard);
  // Tight thresholds: many Quranic word pairs are near-minimal pairs
  // (e.g. الرحمن/الرحيم differ by 2 edits — must NOT cross-match).
  if (maxLen <= 6) return dist <= 1;
  if (maxLen <= 9) return dist <= 2;
  return dist / maxLen <= 0.28;
}

export interface MissedWord {
  /** Expected-word index that was skipped over (likely misread/missed). */
  index: number;
  /** Best-effort guess of what the reciter actually said (normalized), if any. */
  heard: string | null;
}

export interface AlignResult {
  /** Index of the next expected word (all words before it are consumed). */
  cursor: number;
  missed: MissedWord[];
}

/**
 * Align a (partial or final) transcript against expected words, starting at
 * `startCursor`. Idempotent — safe to re-run as the partial transcript grows,
 * always recomputing from the same start.
 *
 * `lookAhead` lets the cursor jump past words the recognizer swallowed.
 */
export function alignTranscript(
  expectedNorm: string[],
  startCursor: number,
  transcript: string,
  lookAhead = 3
): AlignResult {
  const heard = tokenize(transcript);
  let cursor = startCursor;
  const missed: MissedWord[] = [];
  // Heard words that matched nothing yet — candidates for "what the reciter
  // actually said" when we later discover skipped expected words.
  const unmatched: string[] = [];

  // Words that normalize to nothing (isolated symbols) can never be spoken —
  // consume them automatically so they don't block the cursor.
  const skipEmpties = () => {
    while (cursor < expectedNorm.length && expectedNorm[cursor] === '') cursor++;
  };
  skipEmpties();

  for (const h of heard) {
    if (cursor >= expectedNorm.length) break;
    const windowEnd = Math.min(cursor + lookAhead, expectedNorm.length);
    let matched = false;
    for (let j = cursor; j < windowEnd; j++) {
      if (expectedNorm[j] === '') continue;
      if (wordsSimilar(expectedNorm[j], h)) {
        // Attribute buffered unmatched heard words to the skipped expected
        // words, in order — best-effort "you said X instead of Y".
        let u = 0;
        for (let k = cursor; k < j; k++) {
          if (expectedNorm[k] !== '') {
            missed.push({ index: k, heard: unmatched[u++] ?? null });
          }
        }
        unmatched.length = 0;
        cursor = j + 1;
        skipEmpties();
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Self-healing: the recognizer sometimes emits a word LATE, after we
      // already marked it missed. If this heard word matches a recent miss,
      // retract that mistake.
      const healIdx = missed.findIndex((m) =>
        wordsSimilar(expectedNorm[m.index], h)
      );
      if (healIdx >= 0) {
        missed.splice(healIdx, 1);
      } else {
        unmatched.push(h);
      }
    }
  }

  return { cursor, missed };
}

/**
 * Align every recognizer alternative and keep the best outcome: furthest
 * cursor, then fewest mistakes. The top alternative is often wrong for
 * Quranic Arabic while a lower-ranked one is right.
 */
export function alignCandidates(
  expectedNorm: string[],
  startCursor: number,
  candidates: string[],
  lookAhead = 3
): AlignResult {
  let best: AlignResult = { cursor: startCursor, missed: [] };
  let first = true;
  for (const c of candidates) {
    if (!c) continue;
    const r = alignTranscript(expectedNorm, startCursor, c, lookAhead);
    if (
      first ||
      r.cursor > best.cursor ||
      (r.cursor === best.cursor && r.missed.length < best.missed.length)
    ) {
      best = r;
      first = false;
    }
  }
  return best;
}
