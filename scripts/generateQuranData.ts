/**
 * Generates src/assets/quran-data.json — the bundled full Quran (display
 * text + metadata) so surahs open instantly with no network.
 *
 * Sources: quran-json (Tanzil Uthmani text, names, translations) and
 * quran-meta (Madani mushaf page + juz numbers, validated against the
 * printed mushaf). The basmala is prepended to ayah 1 of every surah except
 * Al-Fatiha and At-Tawbah, matching alquran.cloud's quran-uthmani edition
 * that the app previously displayed — keeping voice-search word offsets
 * aligned.
 *
 * Run: npx tsx scripts/generateQuranData.ts
 *
 * Compact schema (arrays to keep the bundle small):
 *   [surahNumber, arabicName, englishName, translation, revelationType,
 *    [[numberInSurah, globalNumber, page, juz, text], ...]]
 */
import fs from 'fs';
import path from 'path';

const { createHafs } = require('quran-meta');
const quran = require('quran-json/dist/quran.json') as {
  id: number;
  name: string;
  transliteration: string;
  translation: string;
  type: string;
  verses: { id: number; text: string }[];
}[];

const hafs = createHafs();
const BASMALA = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';

type AyahRow = [number, number, number, number, string];
type SurahRow = [number, string, string, string, string, AyahRow[]];

const out: SurahRow[] = [];
let globalNumber = 0;

for (const surah of quran) {
  const ayahs: AyahRow[] = [];
  for (const verse of surah.verses) {
    globalNumber++;
    let text = verse.text;
    if (verse.id === 1 && surah.id !== 1 && surah.id !== 9) {
      text = `${BASMALA} ${text}`;
    }
    ayahs.push([
      verse.id,
      globalNumber,
      hafs.findPage(surah.id, verse.id),
      hafs.findJuz(surah.id, verse.id),
      text,
    ]);
  }
  out.push([
    surah.id,
    surah.name,
    surah.transliteration,
    surah.translation,
    surah.type === 'meccan' ? 'Meccan' : 'Medinan',
    ayahs,
  ]);
}

if (globalNumber !== 6236) {
  throw new Error(`Expected 6236 ayahs, got ${globalNumber}`);
}

const outPath = path.join(__dirname, '..', 'src', 'assets', 'quran-data.json');
fs.writeFileSync(outPath, JSON.stringify(out));
const sizeKb = Math.round(fs.statSync(outPath).size / 1024);
console.log(`Wrote ${out.length} surahs / ${globalNumber} ayahs (${sizeKb} KB)`);
