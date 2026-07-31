import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePrayerTimes } from '../../src/hooks/usePrayerTimes';
import { Colors } from '../../src/constants/theme';
import type { PrayerTimings } from '../../src/types';

const PRAYER_ARABIC: Record<string, string> = {
  Fajr: 'الفجر',
  Sunrise: 'الشروق',
  Dhuhr: 'الظهر',
  Asr: 'العصر',
  Maghrib: 'المغرب',
  Isha: 'العشاء',
};

const PRAYER_KEYS: (keyof PrayerTimings)[] = [
  'Fajr',
  'Sunrise',
  'Dhuhr',
  'Asr',
  'Maghrib',
  'Isha',
];

function getNextPrayer(timings: PrayerTimings): keyof PrayerTimings | null {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  for (const key of PRAYER_KEYS) {
    if (key === 'Sunrise') continue;
    const [h, m] = timings[key].split(':').map(Number);
    if (h * 60 + m > nowMins) return key;
  }
  return 'Fajr';
}

export default function PrayerTimesScreen() {
  const { timings, hijriDate, loading, error, refresh } = usePrayerTimes();

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Getting prayer times…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={refresh}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const nextPrayer = timings ? getNextPrayer(timings) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>Prayer Times</Text>
          {hijriDate && <Text style={styles.hijri}>{hijriDate}</Text>}
        </View>

        {timings &&
          PRAYER_KEYS.map((key) => {
            const isNext = nextPrayer === key;
            return (
              <View
                key={key}
                style={[styles.row, isNext && styles.rowNext]}
              >
                <View>
                  <Text style={styles.arabic}>{PRAYER_ARABIC[key]}</Text>
                  <Text style={styles.english}>{key}</Text>
                </View>
                <View style={styles.timeWrap}>
                  {isNext && <Text style={styles.nextLabel}>Next</Text>}
                  <Text style={[styles.time, isNext && styles.timeNext]}>
                    {timings[key]}
                  </Text>
                </View>
              </View>
            );
          })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  scroll: { padding: 16 },
  header: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: '700', color: Colors.textPrimary },
  hijri: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  loadingText: { marginTop: 12, color: Colors.textSecondary },
  errorText: { color: Colors.error, textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryBtnText: { color: '#fff', fontWeight: '600' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowNext: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '12',
  },
  arabic: { fontSize: 18, fontWeight: '600', color: Colors.textPrimary },
  english: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  timeWrap: { alignItems: 'flex-end' },
  nextLabel: { fontSize: 10, color: Colors.primary, fontWeight: '700', marginBottom: 2 },
  time: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  timeNext: { color: Colors.primary },
});
