import type { Surah, SurahDetail, Ayah } from '../types';
import quranData from '../assets/quran-data.json';

/**
 * Quran text + metadata served from the bundled dataset (see
 * scripts/generateQuranData.ts) — surahs open instantly and fully offline.
 * Only recitation AUDIO still streams from the network.
 */

const AUDIO_BASE = 'https://cdn.islamic.network/quran/audio/128';

export const DEFAULT_RECITER = 'ar.alafasy';

type AyahRow = [number, number, number, number, string];
type SurahRow = [number, string, string, string, string, AyahRow[]];

const data = quranData as unknown as SurahRow[];

function toSurah(row: SurahRow): Surah {
  return {
    number: row[0],
    name: row[1],
    englishName: row[2],
    englishNameTranslation: row[3],
    numberOfAyahs: row[5].length,
    revelationType: row[4] as Surah['revelationType'],
  };
}

function toAyah(row: AyahRow): Ayah {
  return {
    numberInSurah: row[0],
    number: row[1],
    page: row[2],
    juz: row[3],
    text: row[4],
    manzil: 0,
    ruku: 0,
    hizbQuarter: 0,
    sajda: false,
  };
}

export async function getSurahs(): Promise<Surah[]> {
  return data.map(toSurah);
}

export async function getSurah(number: number): Promise<SurahDetail> {
  const row = data.find((r) => r[0] === number);
  if (!row) throw new Error(`Surah ${number} not found`);
  return {
    ...toSurah(row),
    ayahs: row[5].map(toAyah),
    edition: {
      identifier: 'bundled-uthmani',
      language: 'ar',
      name: 'Uthmani (bundled)',
      englishName: 'Uthmani',
      format: 'text',
      type: 'quran',
      direction: 'rtl',
    },
  };
}

export function getAudioUrl(
  globalAyahNumber: number,
  reciter = DEFAULT_RECITER
): string {
  return `${AUDIO_BASE}/${reciter}/${globalAyahNumber}.mp3`;
}
