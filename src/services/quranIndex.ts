import { wordsSimilar } from '../utils/recitationMatcher';
import bundledIndex from '../assets/quran-index.json';

/**
 * Normalized full-Quran index for voice verse search ("take me to the verse
 * I'm reciting"). Bundled with the app (see scripts/generateQuranIndex.ts),
 * so search needs no network and can never fail to load.
 */

/** [surahNumber, ayahNumberInSurah, normalizedText] */
export type IndexEntry = [number, number, string];

const entries = bundledIndex as IndexEntry[];

export async function loadQuranIndex(): Promise<IndexEntry[]> {
  return entries;
}

export interface VerseMatch {
  surah: number;
  ayah: number;
  /** Word offset of the matched phrase inside the ayah. */
  wordOffset: number;
}

const BISMILLAH = ['بسم', 'الله', 'الرحمن', 'الرحيم'];

/**
 * If the heard words open with Bismillah, return them without it — the
 * distinctive part of a recitation is what FOLLOWS the basmala, since nearly
 * every surah opens with it. Returns null when there is no Bismillah prefix
 * or nothing usable would remain.
 */
export function stripLeadingBismillah(heardNorm: string[]): string[] | null {
  if (heardNorm.length < BISMILLAH.length + 3) return null;
  for (let i = 0; i < BISMILLAH.length; i++) {
    if (!wordsSimilar(BISMILLAH[i], heardNorm[i])) return null;
  }
  return heardNorm.slice(BISMILLAH.length);
}

// Space-padded ayah texts for the fast exact-substring pass.
let paddedCache: string[] | null = null;
function getPadded(): string[] {
  if (!paddedCache) paddedCache = entries.map((e) => ` ${e[2]} `);
  return paddedCache;
}

/**
 * Find the verse containing a recited phrase. A fast exact-substring pass
 * runs first (most recitations normalize identically); a word-level fuzzy
 * pass (same tolerance as live follow-along) covers recognizer slips like
 * تبارك vs the Uthmani-normalized تبرك. Tries the longest phrase first,
 * backing off to 3 words; also tries skipping the first heard word, which
 * is often recognizer noise. Matches in `preferSurah` win over matches
 * elsewhere.
 */
export function findVerseByPhrase(
  allEntries: IndexEntry[],
  heardNorm: string[],
  preferSurah?: number
): VerseMatch | null {
  const padded = getPadded();

  for (let skip = 0; skip <= 1; skip++) {
    const words = heardNorm.slice(skip);
    for (let len = Math.min(6, words.length); len >= 3; len--) {
      const phrase = words.slice(0, len);

      // Fast pass: exact substring after normalization.
      const needle = ` ${phrase.join(' ')} `;
      let firstMatch: VerseMatch | null = null;
      for (let e = 0; e < allEntries.length; e++) {
        const idx = padded[e].indexOf(needle);
        if (idx < 0) continue;
        const [surah, ayah] = allEntries[e];
        const before = padded[e].slice(0, idx).trim();
        const match: VerseMatch = {
          surah,
          ayah,
          wordOffset: before ? before.split(' ').length : 0,
        };
        if (preferSurah !== undefined && surah === preferSurah) return match;
        if (!firstMatch) firstMatch = match;
      }
      if (firstMatch) return firstMatch;

      // Fuzzy pass: word-level tolerance for recognizer slips.
      for (const [surah, ayah, norm] of allEntries) {
        const toks = norm.split(' ');
        for (let i = 0; i + len <= toks.length; i++) {
          let ok = true;
          for (let k = 0; k < len; k++) {
            if (!wordsSimilar(toks[i + k], phrase[k])) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          const match: VerseMatch = { surah, ayah, wordOffset: i };
          if (preferSurah !== undefined && surah === preferSurah) return match;
          if (!firstMatch) firstMatch = match;
          break;
        }
      }
      if (firstMatch) return firstMatch;
    }
  }
  return null;
}
