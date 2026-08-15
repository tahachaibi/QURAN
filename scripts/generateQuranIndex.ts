/**
 * Generates src/assets/quran-index.json — the bundled normalized Quran index
 * used by voice verse search, so it needs no network at runtime.
 *
 * Source: quran-json (Tanzil Uthmani). The basmala is prepended to ayah 1 of
 * every surah except Al-Fatiha (where it IS ayah 1) and At-Tawbah (which has
 * none), matching how alquran.cloud's quran-uthmani edition — used by the
 * app's display layer — embeds it, so word offsets line up.
 *
 * Run: npx tsx scripts/generateQuranIndex.ts
 */
import fs from 'fs';
import path from 'path';
import { tokenize } from '../src/utils/recitationMatcher';

const quran = require('quran-json/dist/quran.json') as {
  id: number;
  verses: { id: number; text: string }[];
}[];

const BASMALA_NORM = tokenize('بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ');

type IndexEntry = [number, number, string];
const entries: IndexEntry[] = [];

for (const surah of quran) {
  for (const verse of surah.verses) {
    let words = tokenize(verse.text);
    if (verse.id === 1 && surah.id !== 1 && surah.id !== 9) {
      words = [...BASMALA_NORM, ...words];
    }
    entries.push([surah.id, verse.id, words.join(' ')]);
  }
}

const outPath = path.join(__dirname, '..', 'src', 'assets', 'quran-index.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(entries));

const sizeKb = Math.round(fs.statSync(outPath).size / 1024);
console.log(`Wrote ${entries.length} ayahs to ${outPath} (${sizeKb} KB)`);
