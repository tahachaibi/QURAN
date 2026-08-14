import type { PrayerTimesResponse, MonthlyPrayerDay } from '../types';

const BASE_URL = 'https://api.aladhan.com/v1';

export async function getPrayerTimes(
  latitude: number,
  longitude: number,
  method = 2
): Promise<PrayerTimesResponse> {
  const timestamp = Math.floor(Date.now() / 1000);
  const url =
    `${BASE_URL}/timings/${timestamp}` +
    `?latitude=${latitude}&longitude=${longitude}&method=${method}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch prayer times: ${res.status}`);
  const json = await res.json();
  return json.data as PrayerTimesResponse;
}

export async function getMonthlyPrayerTimes(
  latitude: number,
  longitude: number,
  year: number,
  month: number,
  method = 2
): Promise<MonthlyPrayerDay[]> {
  const url =
    `${BASE_URL}/calendar/${year}/${month}` +
    `?latitude=${latitude}&longitude=${longitude}&method=${method}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch monthly prayer times: ${res.status}`);
  const json = await res.json();
  return json.data as MonthlyPrayerDay[];
}
