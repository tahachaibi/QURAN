import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StreakData, AppSettings } from '../types';

const KEYS = {
  STREAK: 'streak_data',
  SETTINGS: 'app_settings',
} as const;

const DEFAULT_STREAK: StreakData = {
  currentStreak: 0,
  longestStreak: 0,
  lastReviewDate: null,
  reviewedDates: [],
};

const DEFAULT_SETTINGS: AppSettings = {
  prayerMethod: 2,
  reciter: 'ar.alafasy',
  location: null,
};

export async function getStreakData(): Promise<StreakData> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.STREAK);
    return raw ? (JSON.parse(raw) as StreakData) : DEFAULT_STREAK;
  } catch {
    return DEFAULT_STREAK;
  }
}

export async function saveStreakData(data: StreakData): Promise<void> {
  await AsyncStorage.setItem(KEYS.STREAK, JSON.stringify(data));
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.SETTINGS);
    return raw
      ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) }
      : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(
  settings: Partial<AppSettings>
): Promise<void> {
  const current = await getSettings();
  await AsyncStorage.setItem(
    KEYS.SETTINGS,
    JSON.stringify({ ...current, ...settings })
  );
}
