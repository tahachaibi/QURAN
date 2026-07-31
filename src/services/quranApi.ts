import type { Surah, SurahDetail } from '../types';

const BASE_URL = 'https://api.alquran.cloud/v1';
const AUDIO_BASE = 'https://cdn.islamic.network/quran/audio/128';

export const DEFAULT_RECITER = 'ar.alafasy';

export async function getSurahs(): Promise<Surah[]> {
  const res = await fetch(`${BASE_URL}/surah`);
  if (!res.ok) throw new Error(`Failed to fetch surahs: ${res.status}`);
  const json = await res.json();
  return json.data as Surah[];
}

export async function getSurah(
  number: number,
  edition = 'quran-uthmani'
): Promise<SurahDetail> {
  const res = await fetch(`${BASE_URL}/surah/${number}/${edition}`);
  if (!res.ok) throw new Error(`Failed to fetch surah ${number}: ${res.status}`);
  const json = await res.json();
  return json.data as SurahDetail;
}

export function getAudioUrl(
  globalAyahNumber: number,
  reciter = DEFAULT_RECITER
): string {
  return `${AUDIO_BASE}/${reciter}/${globalAyahNumber}.mp3`;
}
