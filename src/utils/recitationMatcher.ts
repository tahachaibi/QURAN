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

export interface AlignResult {
  /** Index of the next expected word (all words before it are consumed). */
  cursor: number;
  /** Expected-word indices that were skipped over (likely misread/missed). */
  missed: number[];
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
  const missed: number[] = [];

  // Words that normalize to nothing (isolated symbols) can never be spoken —
  // consume them automatically so they don't block the cursor.
  const skipEmpties = () => {
    while (cursor < expectedNorm.length && expectedNorm[cursor] === '') cursor++;
  };
  skipEmpties();

  for (const h of heard) {
    if (cursor >= expectedNorm.length) break;
    const windowEnd = Math.min(cursor + lookAhead, expectedNorm.length);
    for (let j = cursor; j < windowEnd; j++) {
      if (expectedNorm[j] === '') continue;
      if (wordsSimilar(expectedNorm[j], h)) {
        for (let k = cursor; k < j; k++) {
          if (expectedNorm[k] !== '') missed.push(k);
        }
        cursor = j + 1;
        skipEmpties();
        break;
      }
    }
    // No match in window: treat as recognizer noise/insertion and ignore.
  }

  return { cursor, missed };
}
