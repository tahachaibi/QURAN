import { useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import { getPrayerTimes } from '../services/prayerApi';
import { getSettings, saveSettings } from '../storage/local';
import type { PrayerTimings } from '../types';

export function usePrayerTimes() {
  const [timings, setTimings] = useState<PrayerTimings | null>(null);
  const [hijriDate, setHijriDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission required for prayer times.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = loc.coords;
      const settings = await getSettings();
      const data = await getPrayerTimes(latitude, longitude, settings.prayerMethod);
      setTimings(data.timings);
      const h = data.date.hijri;
      setHijriDate(`${h.day} ${h.month.en} ${h.year} AH`);
      await saveSettings({ location: { latitude, longitude } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load prayer times');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { timings, hijriDate, loading, error, refresh: load };
}
