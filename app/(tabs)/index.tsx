import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePrayerTimes } from '../../src/hooks/usePrayerTimes';
import { getMonthlyPrayerTimes } from '../../src/services/prayerApi';
import { getSettings } from '../../src/storage/local';
import { Colors } from '../../src/constants/theme';
import type { PrayerTimings, MonthlyPrayerDay } from '../../src/types';

type TabView = 'today' | 'month';

const PRAYER_ARABIC: Record<string, string> = {
  Fajr: 'الفجر',
  Sunrise: 'الشروق',
  Dhuhr: 'الظهر',
  Asr: 'العصر',
  Maghrib: 'المغرب',
  Isha: 'العشاء',
};

const PRAYER_KEYS: (keyof PrayerTimings)[] = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
const MONTH_PRAYERS: (keyof PrayerTimings)[] = ['Fajr', 'Dhuhr', 'Maghrib', 'Isha'];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getNextPrayer(timings: PrayerTimings): keyof PrayerTimings | null {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  for (const key of PRAYER_KEYS) {
    if (key === 'Sunrise') continue;
    const [h, m] = cleanTime(timings[key]).split(':').map(Number);
    if (h * 60 + m > nowMins) return key;
  }
  return 'Fajr';
}

function cleanTime(t: string): string {
  return t.split(' ')[0];
}

export default function PrayerTimesScreen() {
  const { timings, hijriDate, loading, error, refresh } = usePrayerTimes();
  const [view, setView] = useState<TabView>('today');
  const [monthlyData, setMonthlyData] = useState<MonthlyPrayerDay[] | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyError, setMonthlyError] = useState<string | null>(null);

  const loadMonthly = useCallback(async () => {
    setMonthlyLoading(true);
    setMonthlyError(null);
    try {
      const settings = await getSettings();
      if (!settings.location) {
        setMonthlyError('View the Today tab first to detect your location, then come back.');
        return;
      }
      const { latitude, longitude } = settings.location;
      const now = new Date();
      const data = await getMonthlyPrayerTimes(
        latitude,
        longitude,
        now.getFullYear(),
        now.getMonth() + 1,
        settings.prayerMethod
      );
      setMonthlyData(data);
    } catch (e) {
      setMonthlyError(e instanceof Error ? e.message : 'Failed to load monthly prayer times');
    } finally {
      setMonthlyLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === 'month' && !monthlyData && !monthlyLoading) {
      loadMonthly();
    }
  }, [view, monthlyData, monthlyLoading, loadMonthly]);

  const todayDay = new Date().getDate();
  const nowMonth = new Date().getMonth();
  const nowYear = new Date().getFullYear();

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
      {/* View toggle */}
      <View style={styles.viewToggle}>
        {(['today', 'month'] as TabView[]).map((v) => (
          <TouchableOpacity
            key={v}
            style={[styles.viewTab, view === v && styles.viewTabActive]}
            onPress={() => setView(v)}
          >
            <Text style={[styles.viewTabText, view === v && styles.viewTabTextActive]}>
              {v === 'today' ? 'Today' : 'This Month'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {view === 'today' ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.header}>
            <Text style={styles.title}>Prayer Times</Text>
            {hijriDate && <Text style={styles.hijri}>{hijriDate}</Text>}
          </View>

          {timings &&
            PRAYER_KEYS.map((key) => {
              const isNext = nextPrayer === key;
              return (
                <View key={key} style={[styles.row, isNext && styles.rowNext]}>
                  <View>
                    <Text style={styles.arabic}>{PRAYER_ARABIC[key]}</Text>
                    <Text style={styles.english}>{key}</Text>
                  </View>
                  <View style={styles.timeWrap}>
                    {isNext && <Text style={styles.nextLabel}>Next</Text>}
                    <Text style={[styles.time, isNext && styles.timeNext]}>
                      {cleanTime(timings[key])}
                    </Text>
                  </View>
                </View>
              );
            })}
        </ScrollView>
      ) : (
        /* Month view */
        monthlyLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading {MONTH_NAMES[nowMonth]} times…</Text>
          </View>
        ) : monthlyError ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{monthlyError}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={loadMonthly}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : monthlyData ? (
          <FlatList
            data={monthlyData}
            keyExtractor={(_, i) => String(i)}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.monthList}
            ListHeaderComponent={
              <View style={styles.monthHeader}>
                <Text style={styles.monthHeaderTitle}>
                  {MONTH_NAMES[nowMonth]} {nowYear}
                </Text>
                <View style={styles.monthColHeaders}>
                  <Text style={[styles.monthColLabel, { width: 52 }]}>Day</Text>
                  {MONTH_PRAYERS.map((p) => (
                    <Text key={p} style={styles.monthColLabel}>{p}</Text>
                  ))}
                </View>
              </View>
            }
            renderItem={({ item }) => {
              const dayNum = Number(item.date.gregorian.day);
              const isToday = dayNum === todayDay;
              const weekday = item.date.gregorian.weekday.en.slice(0, 3);
              return (
                <View style={[styles.monthRow, isToday && styles.monthRowToday]}>
                  <View style={styles.monthDayCell}>
                    <Text style={[styles.monthDayNum, isToday && styles.monthDayNumToday]}>
                      {String(dayNum).padStart(2, '0')}
                    </Text>
                    <Text style={[styles.monthDayName, isToday && styles.monthDayNameToday]}>
                      {weekday}
                    </Text>
                  </View>
                  {MONTH_PRAYERS.map((p) => (
                    <Text key={p} style={[styles.monthTime, isToday && styles.monthTimeToday]}>
                      {cleanTime(item.timings[p])}
                    </Text>
                  ))}
                </View>
              );
            }}
          />
        ) : null
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },

  // View toggle
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  viewTab: {
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginRight: 8,
  },
  viewTabActive: { borderBottomColor: Colors.primary },
  viewTabText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  viewTabTextActive: { color: Colors.primary },

  // Today view
  scroll: { padding: 16 },
  header: { marginBottom: 20 },
  title: { fontSize: 28, fontWeight: '700', color: Colors.textPrimary },
  hijri: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  loadingText: { marginTop: 12, color: Colors.textSecondary },
  errorText: { color: Colors.error, textAlign: 'center', marginBottom: 16 },
  retryBtn: { backgroundColor: Colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
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
  rowNext: { borderColor: Colors.primary, backgroundColor: Colors.primary + '12' },
  arabic: { fontSize: 18, fontWeight: '600', color: Colors.textPrimary },
  english: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  timeWrap: { alignItems: 'flex-end' },
  nextLabel: { fontSize: 10, color: Colors.primary, fontWeight: '700', marginBottom: 2 },
  time: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  timeNext: { color: Colors.primary },

  // Month view
  monthList: { paddingBottom: 40 },
  monthHeader: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: 4,
  },
  monthHeaderTitle: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary, marginBottom: 12 },
  monthColHeaders: { flexDirection: 'row', alignItems: 'center' },
  monthColLabel: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  monthRowToday: { backgroundColor: Colors.primary + '10' },
  monthDayCell: { width: 52, alignItems: 'center' },
  monthDayNum: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  monthDayNumToday: { color: Colors.primary },
  monthDayName: { fontSize: 10, color: Colors.textSecondary, marginTop: 1 },
  monthDayNameToday: { color: Colors.primary },
  monthTime: { flex: 1, fontSize: 12, fontWeight: '500', color: Colors.textPrimary, textAlign: 'center' },
  monthTimeToday: { color: Colors.primary, fontWeight: '700' },
});
