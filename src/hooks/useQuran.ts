import { useState, useEffect } from 'react';
import { getSurahs } from '../services/quranApi';
import type { Surah } from '../types';

export function useSurahs() {
  const [surahs, setSurahs] = useState<Surah[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSurahs()
      .then(setSurahs)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Failed to load surahs')
      )
      .finally(() => setLoading(false));
  }, []);

  return { surahs, loading, error };
}
