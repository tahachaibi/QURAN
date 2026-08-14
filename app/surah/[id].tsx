import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { getSurah, getAudioUrl } from '../../src/services/quranApi';
import { Colors } from '../../src/constants/theme';
import type { SurahDetail, Ayah } from '../../src/types';

type Mode = 'listen' | 'read' | 'memorize';

export default function SurahScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [surah, setSurah] = useState<SurahDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('read');

  // Listen mode state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAyahIdx, setCurrentAyahIdx] = useState(0);
  const isPlayingRef = useRef(false);
  const currentIdxRef = useRef(0);
  const soundRef = useRef<Audio.Sound | null>(null);
  const ayahsRef = useRef<Ayah[]>([]);

  // Read mode state
  const [readPlayingNum, setReadPlayingNum] = useState<number | null>(null);

  // Memorize mode state
  const [memorizeIdx, setMemorizeIdx] = useState(0);
  const [textRevealed, setTextRevealed] = useState(false);

  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    });
    if (id) {
      getSurah(Number(id))
        .then((data) => {
          setSurah(data);
          ayahsRef.current = data.ayahs;
        })
        .catch((e: unknown) =>
          setError(e instanceof Error ? e.message : 'Failed to load surah')
        )
        .finally(() => setLoading(false));
    }
    return () => {
      isPlayingRef.current = false;
      soundRef.current?.unloadAsync();
    };
  }, [id]);

  const stopAudio = useCallback(async () => {
    isPlayingRef.current = false;
    if (soundRef.current) {
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    setIsPlaying(false);
    setReadPlayingNum(null);
  }, []);

  const playAyahAuto = useCallback(async (index: number) => {
    const ayahs = ayahsRef.current;
    if (index >= ayahs.length || !isPlayingRef.current) {
      setIsPlaying(false);
      isPlayingRef.current = false;
      return;
    }
    if (soundRef.current) {
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    currentIdxRef.current = index;
    setCurrentAyahIdx(index);
    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: getAudioUrl(ayahs[index].number) },
        { shouldPlay: true }
      );
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish && isPlayingRef.current) {
          playAyahAuto(currentIdxRef.current + 1);
        }
      });
    } catch {
      playAyahAuto(index + 1);
    }
  }, []);

  const toggleListenPlay = useCallback(async () => {
    if (isPlaying) {
      await stopAudio();
    } else {
      isPlayingRef.current = true;
      setIsPlaying(true);
      await playAyahAuto(currentAyahIdx);
    }
  }, [isPlaying, currentAyahIdx, stopAudio, playAyahAuto]);

  const skipAyah = useCallback(async (delta: number) => {
    if (!surah) return;
    const next = Math.max(0, Math.min(surah.ayahs.length - 1, currentAyahIdx + delta));
    await stopAudio();
    setCurrentAyahIdx(next);
    currentIdxRef.current = next;
    isPlayingRef.current = true;
    setIsPlaying(true);
    await playAyahAuto(next);
  }, [surah, currentAyahIdx, stopAudio, playAyahAuto]);

  const changeMode = useCallback(async (newMode: Mode) => {
    await stopAudio();
    setCurrentAyahIdx(0);
    currentIdxRef.current = 0;
    setMemorizeIdx(0);
    setTextRevealed(false);
    setMode(newMode);
  }, [stopAudio]);

  const toggleReadAyah = useCallback(async (ayah: Ayah) => {
    if (soundRef.current) {
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    if (readPlayingNum === ayah.number) {
      setReadPlayingNum(null);
      return;
    }
    setReadPlayingNum(ayah.number);
    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: getAudioUrl(ayah.number) },
        { shouldPlay: true }
      );
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) setReadPlayingNum(null);
      });
    } catch {
      setReadPlayingNum(null);
    }
  }, [readPlayingNum]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (error || !surah) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'Surah not found'}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>{surah.englishName}</Text>
          <Text style={styles.headerMeta}>
            {surah.numberOfAyahs} verses · {surah.revelationType}
          </Text>
        </View>
        <Text style={styles.headerArabic}>{surah.name}</Text>
      </View>

      {/* Mode tabs */}
      <View style={styles.modeTabs}>
        {(['listen', 'read', 'memorize'] as Mode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.modeTab, mode === m && styles.modeTabActive]}
            onPress={() => changeMode(m)}
          >
            <Text style={[styles.modeTabText, mode === m && styles.modeTabTextActive]}>
              {m === 'listen' ? '🔊 Listen' : m === 'read' ? '📖 Read' : '🧠 Memorize'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === 'listen' && (
        <ListenMode
          surah={surah}
          currentIdx={currentAyahIdx}
          isPlaying={isPlaying}
          onTogglePlay={toggleListenPlay}
          onSkip={skipAyah}
        />
      )}

      {mode === 'read' && (
        <ReadMode
          surah={surah}
          playingNum={readPlayingNum}
          onToggleAyah={toggleReadAyah}
        />
      )}

      {mode === 'memorize' && (
        <MemorizeMode
          surah={surah}
          currentIdx={memorizeIdx}
          revealed={textRevealed}
          onReveal={() => setTextRevealed(true)}
          onPrev={() => {
            setMemorizeIdx((i) => Math.max(0, i - 1));
            setTextRevealed(false);
          }}
          onNext={() => {
            setMemorizeIdx((i) => Math.min(surah.ayahs.length - 1, i + 1));
            setTextRevealed(false);
          }}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Listen Mode ──────────────────────────────────────────────────────────────

function ListenMode({
  surah,
  currentIdx,
  isPlaying,
  onTogglePlay,
  onSkip,
}: {
  surah: SurahDetail;
  currentIdx: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSkip: (delta: number) => void;
}) {
  const ayah = surah.ayahs[currentIdx];
  const isFirst = currentIdx === 0;
  const isLast = currentIdx === surah.ayahs.length - 1;

  return (
    <View style={styles.listenContainer}>
      <Text style={styles.progressText}>
        Ayah {currentIdx + 1} / {surah.numberOfAyahs}
      </Text>

      {/* Progress bar */}
      <View style={styles.progressBar}>
        <View
          style={[
            styles.progressFill,
            { width: `${((currentIdx + 1) / surah.numberOfAyahs) * 100}%` },
          ]}
        />
      </View>

      {/* Ayah card */}
      <View style={styles.listenCard}>
        {surah.number !== 9 && currentIdx === 0 && (
          <Text style={styles.bismillahListen}>
            بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ
          </Text>
        )}
        <View style={styles.ayahNumBadge}>
          <Text style={styles.ayahNumText}>{ayah.numberInSurah}</Text>
        </View>
        <Text style={styles.listenAyahText}>{ayah.text}</Text>
        <Text style={styles.listenAyahMeta}>Juz {ayah.juz} · Page {ayah.page}</Text>
      </View>

      {/* Controls */}
      <View style={styles.listenControls}>
        <TouchableOpacity
          style={[styles.skipBtn, isFirst && styles.btnDisabled]}
          onPress={() => onSkip(-1)}
          disabled={isFirst}
        >
          <Ionicons
            name="play-skip-back"
            size={28}
            color={isFirst ? Colors.border : Colors.primary}
          />
        </TouchableOpacity>

        <TouchableOpacity style={styles.playBtnLarge} onPress={onTogglePlay}>
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={38} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.skipBtn, isLast && styles.btnDisabled]}
          onPress={() => onSkip(1)}
          disabled={isLast}
        >
          <Ionicons
            name="play-skip-forward"
            size={28}
            color={isLast ? Colors.border : Colors.primary}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Read Mode ────────────────────────────────────────────────────────────────

function ReadMode({
  surah,
  playingNum,
  onToggleAyah,
}: {
  surah: SurahDetail;
  playingNum: number | null;
  onToggleAyah: (ayah: Ayah) => void;
}) {
  return (
    <FlatList
      data={surah.ayahs}
      keyExtractor={(item) => String(item.number)}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        surah.number !== 9 ? (
          <View style={styles.bismillah}>
            <Text style={styles.bismillahText}>
              بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ
            </Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => {
        const isPlaying = playingNum === item.number;
        return (
          <View style={[styles.ayahCard, isPlaying && styles.ayahCardActive]}>
            <View style={styles.ayahMeta}>
              <View style={styles.ayahBadge}>
                <Text style={styles.ayahNum}>{item.numberInSurah}</Text>
              </View>
              <TouchableOpacity onPress={() => onToggleAyah(item)} style={styles.playBtn}>
                <Ionicons
                  name={isPlaying ? 'pause-circle' : 'play-circle'}
                  size={30}
                  color={Colors.primary}
                />
              </TouchableOpacity>
            </View>
            <Text style={styles.ayahText}>{item.text}</Text>
          </View>
        );
      }}
    />
  );
}

// ─── Memorize Mode ────────────────────────────────────────────────────────────

function MemorizeMode({
  surah,
  currentIdx,
  revealed,
  onReveal,
  onPrev,
  onNext,
}: {
  surah: SurahDetail;
  currentIdx: number;
  revealed: boolean;
  onReveal: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const ayah = surah.ayahs[currentIdx];
  const isFirst = currentIdx === 0;
  const isLast = currentIdx === surah.ayahs.length - 1;

  return (
    <View style={styles.memorizeContainer}>
      <Text style={styles.progressText}>
        Ayah {currentIdx + 1} / {surah.numberOfAyahs}
      </Text>

      <View style={styles.memorizeCard}>
        <View style={styles.ayahNumBadge}>
          <Text style={styles.ayahNumText}>{ayah.numberInSurah}</Text>
        </View>

        {revealed ? (
          <Text style={styles.memorizeAyahText}>{ayah.text}</Text>
        ) : (
          <View style={styles.hiddenBlock}>
            <Text style={styles.hiddenDots}>{'⬛ '.repeat(12)}</Text>
            <Text style={styles.hiddenHint}>Tap to reveal</Text>
          </View>
        )}

        {!revealed && (
          <TouchableOpacity style={styles.revealBtn} onPress={onReveal}>
            <Ionicons name="eye-outline" size={20} color="#fff" />
            <Text style={styles.revealBtnText}>Reveal Ayah</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Voice coming soon */}
      <View style={styles.voiceBanner}>
        <Ionicons name="mic-outline" size={18} color={Colors.accent} />
        <Text style={styles.voiceBannerText}>
          Voice recitation checking — coming in next update
        </Text>
      </View>

      {/* Navigation */}
      <View style={styles.memorizeNav}>
        <TouchableOpacity
          style={[styles.navBtn, isFirst && styles.btnDisabled]}
          onPress={onPrev}
          disabled={isFirst}
        >
          <Ionicons
            name="chevron-back"
            size={20}
            color={isFirst ? Colors.border : Colors.primary}
          />
          <Text style={[styles.navBtnText, isFirst && styles.navBtnTextDisabled]}>
            Previous
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navBtn, isLast && styles.btnDisabled]}
          onPress={onNext}
          disabled={isLast}
        >
          <Text style={[styles.navBtnText, isLast && styles.navBtnTextDisabled]}>
            Next
          </Text>
          <Ionicons
            name="chevron-forward"
            size={20}
            color={isLast ? Colors.border : Colors.primary}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { color: Colors.error, marginBottom: 16 },
  backBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  backBtnText: { color: '#fff', fontWeight: '600' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  headerBack: { marginRight: 10 },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  headerMeta: { fontSize: 12, color: Colors.textSecondary },
  headerArabic: { fontSize: 22, color: Colors.textPrimary },

  // Mode tabs
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  modeTabActive: { borderBottomColor: Colors.primary },
  modeTabText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  modeTabTextActive: { color: Colors.primary, fontWeight: '700' },

  // Shared
  progressText: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 10,
  },
  progressBar: {
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    marginHorizontal: 16,
    marginBottom: 20,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  ayahNumBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.primary + '18',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  ayahNumText: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  btnDisabled: { opacity: 0.3 },

  // Listen mode
  listenContainer: {
    flex: 1,
    padding: 16,
    justifyContent: 'space-between',
  },
  bismillahListen: {
    fontSize: 18,
    color: Colors.primary,
    textAlign: 'center',
    marginBottom: 16,
  },
  listenCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 20,
  },
  listenAyahText: {
    fontSize: 26,
    lineHeight: 48,
    textAlign: 'center',
    color: Colors.textPrimary,
    writingDirection: 'rtl',
    marginBottom: 12,
  },
  listenAyahMeta: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  listenControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingBottom: 8,
  },
  skipBtn: { padding: 8 },
  playBtnLarge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },

  // Read mode
  list: { padding: 14, paddingBottom: 40 },
  bismillah: {
    padding: 14,
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bismillahText: { fontSize: 20, color: Colors.primary, textAlign: 'center' },
  ayahCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ayahCardActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '08',
  },
  ayahMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  ayahBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primary + '18',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ayahNum: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  playBtn: { padding: 2 },
  ayahText: {
    fontSize: 22,
    lineHeight: 42,
    textAlign: 'right',
    color: Colors.textPrimary,
    writingDirection: 'rtl',
  },

  // Memorize mode
  memorizeContainer: {
    flex: 1,
    padding: 16,
  },
  memorizeCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  memorizeAyahText: {
    fontSize: 26,
    lineHeight: 48,
    textAlign: 'center',
    color: Colors.textPrimary,
    writingDirection: 'rtl',
  },
  hiddenBlock: { alignItems: 'center', gap: 12 },
  hiddenDots: { fontSize: 18, color: Colors.border, textAlign: 'center' },
  hiddenHint: { fontSize: 13, color: Colors.textSecondary },
  revealBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 20,
  },
  revealBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  voiceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.accent + '18',
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
  },
  voiceBannerText: { fontSize: 13, color: Colors.textSecondary, flex: 1 },
  memorizeNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  navBtnText: { fontSize: 15, fontWeight: '600', color: Colors.primary },
  navBtnTextDisabled: { color: Colors.border },
});
