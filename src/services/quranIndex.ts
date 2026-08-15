import AsyncStorage from '@react-native-async-storage/async-storage';
import { tokenize, wordsSimilar } from '../utils/recitationMatcher';

/**
 * Normalized full-Quran index for voice verse search ("take me to the verse
 * I'm reciting"). Downloaded once from alquran.cloud, normalized the same way
 * recognizer output is, and cached locally (~800KB).
 */

const STORAGE_KEY = 'quran-norm-index-v1';

/** [surahNumber, ayahNumberInSurah, normalizedText] */
export type IndexEntry = [number, number, string];

let memoryCache: IndexEntry[] | null = null;

export async function loadQuranIndex(): Promise<IndexEntry[]> {
  if (memoryCache) return memoryCache;

  const stored = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
  if (stored) {
    memoryCache = JSON.parse(stored) as IndexEntry[];
    return memoryCache;
  }

  const res = await fetch('https://api.alquran.cloud/v1/quran/quran-uthmani');
  if (!res.ok) throw new Error(`Failed to download Quran text: ${res.status}`);
  const json = await res.json();

  const entries: IndexEntry[] = [];
  for (const surah of json.data.surahs) {
    for (const ayah of surah.ayahs) {
      entries.push([
        surah.number,
        ayah.numberInSurah,
        tokenize(ayah.text).join(' '),
      ]);
    }
  }

  memoryCache = entries;
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => {});
  return entries;
}

export interface VerseMatch {
  surah: number;
  ayah: number;
  /** Word offset of the matched phrase inside the ayah. */
  wordOffset: number;
}

// Space-padded ayah texts for the fast exact-substring pass.
let paddedCache: string[] | null = null;
let paddedCacheSource: IndexEntry[] | null = null;
function getPadded(entries: IndexEntry[]): string[] {
  if (!paddedCache || paddedCacheSource !== entries) {
    paddedCache = entries.map((e) => ` ${e[2]} `);
    paddedCacheSource = entries;
  }
  return paddedCache;
}

/**
 * Find the verse containing a recited phrase. Word-level fuzzy matching (the
 * same tolerance as live follow-along) so recognizer output like تبارك still
 * matches the Uthmani-normalized تبرك. Tries the longest phrase first (more
 * specific), backing off to 3 words; also tries skipping the first heard
 * word, which is often recognizer noise. Matches in `preferSurah` win over
 * matches elsewhere.
 */
export function findVerseByPhrase(
  entries: IndexEntry[],
  heardNorm: string[],
  preferSurah?: number
): VerseMatch | null {
  const padded = getPadded(entries);

  for (let skip = 0; skip <= 1; skip++) {
    const words = heardNorm.slice(skip);
    for (let len = Math.min(6, words.length); len >= 3; len--) {
      const phrase = words.slice(0, len);

      // Fast pass: exact substring after normalization (covers most cases,
      // ~milliseconds). Only fall back to the fuzzy word scan if it fails.
      const needle = ` ${phrase.join(' ')} `;
      let firstMatch: VerseMatch | null = null;
      for (let e = 0; e < entries.length; e++) {
        const idx = padded[e].indexOf(needle);
        if (idx < 0) continue;
        const [surah, ayah] = entries[e];
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
      for (const [surah, ayah, norm] of entries) {
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
