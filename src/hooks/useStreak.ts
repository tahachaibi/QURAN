import { useState, useEffect, useCallback } from 'react';
import { getStreakData, saveStreakData } from '../storage/local';
import type { StreakData } from '../types';

function isoDate(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

export function useStreak() {
  const [streak, setStreak] = useState<StreakData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStreakData().then((data) => {
      setStreak(data);
      setLoading(false);
    });
  }, []);

  const todayReviewed = streak
    ? streak.reviewedDates.includes(isoDate())
    : false;

  const markTodayReviewed = useCallback(async () => {
    const data = await getStreakData();
    const today = isoDate();

    if (data.reviewedDates.includes(today)) return;

    const wasYesterday = data.lastReviewDate === isoDate(-1);
    const newCurrentStreak = wasYesterday ? data.currentStreak + 1 : 1;

    const updated: StreakData = {
      currentStreak: newCurrentStreak,
      longestStreak: Math.max(data.longestStreak, newCurrentStreak),
      lastReviewDate: today,
      reviewedDates: [...data.reviewedDates, today],
    };

    await saveStreakData(updated);
    setStreak(updated);
  }, []);

  return { streak, loading, todayReviewed, markTodayReviewed };
}
