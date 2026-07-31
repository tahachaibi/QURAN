import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStreak } from '../../src/hooks/useStreak';
import { Colors } from '../../src/constants/theme';

function getLast30Days(): string[] {
  const days: string[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}

export default function TrackerScreen() {
  const { streak, loading, todayReviewed, markTodayReviewed } = useStreak();
  const last30 = useMemo(() => getLast30Days(), []);

  if (loading || !streak) {
    return <View style={styles.container} />;
  }

  const reviewedSet = new Set(streak.reviewedDates);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Daily Tracker</Text>

        <View style={styles.statsRow}>
          {([
            { value: streak.currentStreak, label: 'Current Streak', emoji: '🔥' },
            { value: streak.longestStreak, label: 'Longest Streak', emoji: '🏆' },
            { value: streak.reviewedDates.length, label: 'Total Days', emoji: '📖' },
          ] as const).map(({ value, label, emoji }) => (
            <View key={label} style={styles.statCard}>
              <Text style={styles.statNum}>{value}</Text>
              <Text style={styles.statLabel}>{label}</Text>
              <Text style={styles.statEmoji}>{emoji}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.reviewBtn, todayReviewed && styles.reviewBtnDone]}
          onPress={markTodayReviewed}
          disabled={todayReviewed}
        >
          <Text style={styles.reviewBtnText}>
            {todayReviewed ? '✓ Reviewed Today' : 'Mark Today as Reviewed'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Last 30 Days</Text>
        <View style={styles.dotGrid}>
          {last30.map((date) => (
            <View
              key={date}
              style={[styles.dot, reviewedSet.has(date) && styles.dotFilled]}
            />
          ))}
        </View>
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.dot, styles.dotFilled]} />
            <Text style={styles.legendText}>Reviewed</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={styles.dot} />
            <Text style={styles.legendText}>Missed</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16 },
  title: { fontSize: 28, fontWeight: '700', color: Colors.textPrimary, marginBottom: 20 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statNum: { fontSize: 28, fontWeight: '800', color: Colors.primary },
  statLabel: { fontSize: 10, color: Colors.textSecondary, textAlign: 'center', marginTop: 4 },
  statEmoji: { fontSize: 20, marginTop: 4 },
  reviewBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 28,
  },
  reviewBtnDone: { backgroundColor: Colors.primaryLight, opacity: 0.85 },
  reviewBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: Colors.textPrimary, marginBottom: 12 },
  dotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dot: { width: 28, height: 28, borderRadius: 6, backgroundColor: Colors.border },
  dotFilled: { backgroundColor: Colors.primary },
  legend: { flexDirection: 'row', gap: 16, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { fontSize: 12, color: Colors.textSecondary },
});
