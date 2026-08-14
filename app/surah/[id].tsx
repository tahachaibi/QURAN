import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { getSurah, getAudioUrl, DEFAULT_RECITER } from '../../src/services/quranApi';
import { useVoiceRecognition } from '../../src/hooks/useVoiceRecognition';
import { wordsMatch } from '../../src/utils/arabicText';
import { Colors } from '../../src/constants/theme';
import type { SurahDetail, Ayah } from '../../src/types';

type Mode = 'listen' | 'read' | 'memorize';
type WordState = 'hidden' | 'known' | 'peeked';

const RECITERS = [
  { id: 'ar.alafasy',              name: 'Mishary Alafasy',         nameAr: 'مشاري العفاسي' },
  { id: 'ar.abdurrahmaansudais',   name: 'Abdur-Rahman Al-Sudais',  nameAr: 'عبد الرحمن السديس' },
  { id: 'ar.husary',               name: 'Mahmoud Al-Husary',       nameAr: 'محمود خليل الحصري' },
  { id: 'ar.minshawi',             name: 'Mohamed Al-Minshawi',     nameAr: 'محمد صديق المنشاوي' },
  { id: 'ar.abdullahbasfar',       name: 'Abdullah Basfar',         nameAr: 'عبد الله بصفر' },
  { id: 'ar.muhammadayyoub',       name: 'Muhammad Ayyoub',         nameAr: 'محمد أيوب' },
];

export default function SurahScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [surah, setSurah] = useState<SurahDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('read');

  const [reciter, setReciter] = useState(DEFAULT_RECITER);
  const reciterRef = useRef(DEFAULT_RECITER);
  const [reciterModalOpen, setReciterModalOpen] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAyahIdx, setCurrentAyahIdx] = useState(0);
  const isPlayingRef = useRef(false);
  const currentIdxRef = useRef(0);
  const soundRef = useRef<Audio.Sound | null>(null);
  const ayahsRef = useRef<Ayah[]>([]);

  const [readPlayingNum, setReadPlayingNum] = useState<number | null>(null);
  const [memorizeIdx, setMemorizeIdx] = useState(0);

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
        { uri: getAudioUrl(ayahs[index].number, reciterRef.current) },
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
        { uri: getAudioUrl(ayah.number, reciterRef.current) },
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

  function handleReciterSelect(rid: string) {
    setReciter(rid);
    reciterRef.current = rid;
    setReciterModalOpen(false);
    stopAudio();
  }

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
          reciter={reciter}
          onTogglePlay={toggleListenPlay}
          onSkip={skipAyah}
          onOpenReciterPicker={() => setReciterModalOpen(true)}
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
          key={memorizeIdx}
          surah={surah}
          currentIdx={memorizeIdx}
          onPrev={() => setMemorizeIdx((i) => Math.max(0, i - 1))}
          onNext={() => setMemorizeIdx((i) => Math.min(surah.ayahs.length - 1, i + 1))}
        />
      )}

      {/* Reciter picker bottom sheet */}
      <Modal
        visible={reciterModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setReciterModalOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setReciterModalOpen(false)}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Choose Reciter</Text>
            {RECITERS.map((r) => (
              <TouchableOpacity
                key={r.id}
                style={[styles.reciterItem, reciter === r.id && styles.reciterItemActive]}
                onPress={() => handleReciterSelect(r.id)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.reciterItemName}>{r.name}</Text>
                  <Text style={styles.reciterItemAr}>{r.nameAr}</Text>
                </View>
                {reciter === r.id && (
                  <Ionicons name="checkmark-circle" size={22} color={Colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Listen Mode ──────────────────────────────────────────────────────────────

function ListenMode({
  surah,
  currentIdx,
  isPlaying,
  reciter,
  onTogglePlay,
  onSkip,
  onOpenReciterPicker,
}: {
  surah: SurahDetail;
  currentIdx: number;
  isPlaying: boolean;
  reciter: string;
  onTogglePlay: () => void;
  onSkip: (delta: number) => void;
  onOpenReciterPicker: () => void;
}) {
  const ayah = surah.ayahs[currentIdx];
  const isFirst = currentIdx === 0;
  const isLast = currentIdx === surah.ayahs.length - 1;
  const reciterName = RECITERS.find((r) => r.id === reciter)?.name ?? reciter;

  return (
    <View style={styles.listenContainer}>
      {/* Reciter selector */}
      <TouchableOpacity style={styles.reciterSelector} onPress={onOpenReciterPicker}>
        <Ionicons name="person-outline" size={14} color={Colors.primary} />
        <Text style={styles.reciterSelectorText}>{reciterName}</Text>
        <Ionicons name="chevron-down" size={14} color={Colors.primary} />
      </TouchableOpacity>

      <Text style={styles.progressText}>
        Ayah {currentIdx + 1} / {surah.numberOfAyahs}
      </Text>

      <View style={styles.progressBar}>
        <View
          style={[
            styles.progressFill,
            { width: `${((currentIdx + 1) / surah.numberOfAyahs) * 100}%` },
          ]}
        />
      </View>

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

      <View style={styles.listenControls}>
        <TouchableOpacity
          style={[styles.skipBtn, isFirst && styles.btnDisabled]}
          onPress={() => onSkip(-1)}
          disabled={isFirst}
        >
          <Ionicons name="play-skip-back" size={28} color={isFirst ? Colors.border : Colors.primary} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.playBtnLarge} onPress={onTogglePlay}>
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={38} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.skipBtn, isLast && styles.btnDisabled]}
          onPress={() => onSkip(1)}
          disabled={isLast}
        >
          <Ionicons name="play-skip-forward" size={28} color={isLast ? Colors.border : Colors.primary} />
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
            <Text style={styles.bismillahText}>بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ</Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => {
        const active = playingNum === item.number;
        return (
          <View style={[styles.ayahCard, active && styles.ayahCardActive]}>
            <View style={styles.ayahMeta}>
              <View style={styles.ayahBadge}>
                <Text style={styles.ayahNum}>{item.numberInSurah}</Text>
              </View>
              <TouchableOpacity onPress={() => onToggleAyah(item)} style={styles.playBtn}>
                <Ionicons
                  name={active ? 'pause-circle' : 'play-circle'}
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

// ─── Memorize Mode (word-by-word + voice) ────────────────────────────────────

function MemorizeMode({
  surah,
  currentIdx,
  onPrev,
  onNext,
}: {
  surah: SurahDetail;
  currentIdx: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const ayah = surah.ayahs[currentIdx];
  const words = ayah.text.split(' ');

  const [wordStates, setWordStates] = useState<WordState[]>(() => words.map(() => 'hidden'));
  const [currentWordIdx, setCurrentWordIdx] = useState(0);
  const [showError, setShowError] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceFeedback, setVoiceFeedback] = useState<{
    recognized: string;
    correct: boolean;
  } | null>(null);

  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const expectedWordRef = useRef(words[0] ?? '');

  const { isListening, result, error: voiceError, startListening, clearResult } =
    useVoiceRecognition();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  // Keep expected word ref in sync as user advances
  useEffect(() => {
    expectedWordRef.current = words[currentWordIdx] ?? '';
    setVoiceFeedback(null);
    clearResult();
  }, [currentWordIdx]);

  // Process voice recognition result
  useEffect(() => {
    if (result === null) return undefined;
    const recognized = result.trim();
    const correct = wordsMatch(expectedWordRef.current, recognized);
    setVoiceFeedback({ recognized, correct });
    if (!correct) return undefined;
    const t = setTimeout(() => {
      if (mountedRef.current) {
        markWord('known');
        setVoiceFeedback(null);
      }
    }, 900);
    return () => clearTimeout(t);
  }, [result]);

  const isFirst = currentIdx === 0;
  const isLast = currentIdx === surah.ayahs.length - 1;
  const isDone = currentWordIdx >= words.length;
  const knownCount = wordStates.filter((s) => s === 'known').length;
  const peekedCount = wordStates.filter((s) => s === 'peeked').length;

  function markWord(state: WordState) {
    setWordStates((prev) => {
      const next = [...prev];
      next[currentWordIdx] = state;
      return next;
    });
    setCurrentWordIdx((i) => i + 1);
  }

  function handleKnown() {
    markWord('known');
    setShowError(false);
    setVoiceFeedback(null);
  }

  function handlePeek() {
    markWord('peeked');
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setShowError(true);
    setVoiceFeedback(null);
    clearResult();
    errorTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setShowError(false);
    }, 2500);
  }

  function handleRevealAll() {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setWordStates(words.map(() => 'peeked'));
    setCurrentWordIdx(words.length);
    setShowError(false);
    setVoiceFeedback(null);
    clearResult();
  }

  function handleVoiceRetry() {
    setVoiceFeedback(null);
    clearResult();
  }

  function handleVoiceSkip() {
    setVoiceFeedback(null);
    clearResult();
    handlePeek();
  }

  function switchMode(toVoice: boolean) {
    setVoiceMode(toVoice);
    setVoiceFeedback(null);
    clearResult();
  }

  return (
    <ScrollView contentContainerStyle={styles.memorizeScroll} showsVerticalScrollIndicator={false}>
      <Text style={styles.progressText}>
        Ayah {currentIdx + 1} / {surah.numberOfAyahs}
      </Text>

      {/* Manual / Voice toggle */}
      <View style={styles.modeToggleRow}>
        <TouchableOpacity
          style={[styles.modeToggleBtn, !voiceMode && styles.modeToggleBtnActive]}
          onPress={() => switchMode(false)}
        >
          <Ionicons name="hand-left-outline" size={14} color={!voiceMode ? '#fff' : Colors.textSecondary} />
          <Text style={[styles.modeToggleText, !voiceMode && styles.modeToggleTextActive]}>
            Manual
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeToggleBtn, voiceMode && styles.modeToggleBtnActive]}
          onPress={() => switchMode(true)}
        >
          <Ionicons name="mic-outline" size={14} color={voiceMode ? '#fff' : Colors.textSecondary} />
          <Text style={[styles.modeToggleText, voiceMode && styles.modeToggleTextActive]}>
            Voice
          </Text>
        </TouchableOpacity>
      </View>

      {/* Manual error notice */}
      {showError && !voiceMode && (
        <View style={styles.errorNotice}>
          <Ionicons name="close-circle" size={18} color="#fff" />
          <Text style={styles.errorNoticeText}>Keep practicing — you'll get it! 💪</Text>
        </View>
      )}

      {/* Voice feedback card */}
      {voiceFeedback && (
        <View
          style={[
            styles.voiceFeedbackCard,
            voiceFeedback.correct ? styles.voiceFeedbackOk : styles.voiceFeedbackBad,
          ]}
        >
          {voiceFeedback.correct ? (
            <View style={styles.voiceFeedbackRow}>
              <Ionicons name="checkmark-circle" size={24} color={Colors.primary} />
              <Text style={styles.voiceFeedbackCorrectText}>مَاشَاءَ اللَّه — Correct! 🎉</Text>
            </View>
          ) : (
            <>
              <Text style={styles.voiceYouSaid}>
                You said:{' '}
                <Text style={styles.voiceRecognized}>
                  {voiceFeedback.recognized || '(nothing detected)'}
                </Text>
              </Text>
              <Text style={styles.voiceExpected}>
                Expected:{' '}
                <Text style={styles.voiceExpectedWord}>{words[currentWordIdx]}</Text>
              </Text>
              <View style={styles.voiceFeedbackBtns}>
                <TouchableOpacity style={styles.voiceRetryBtn} onPress={handleVoiceRetry}>
                  <Ionicons name="mic" size={15} color={Colors.primary} />
                  <Text style={styles.voiceRetryText}>Try again</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.voiceSkipBtn} onPress={handleVoiceSkip}>
                  <Ionicons name="eye-outline" size={15} color={Colors.textSecondary} />
                  <Text style={styles.voiceSkipText}>Show & skip</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}

      {/* Word grid */}
      <View style={styles.wordsWrap}>
        {words.map((word, idx) => {
          const state = wordStates[idx];
          const isCurrent = idx === currentWordIdx;
          return (
            <View
              key={idx}
              style={[
                styles.wordBlock,
                state === 'known' && styles.wordKnown,
                state === 'peeked' && styles.wordPeeked,
                isCurrent && state === 'hidden' && styles.wordCurrent,
              ]}
            >
              {state !== 'hidden' ? (
                <Text
                  style={[
                    styles.wordText,
                    state === 'known' && styles.wordTextKnown,
                    state === 'peeked' && styles.wordTextPeeked,
                  ]}
                >
                  {word}
                </Text>
              ) : (
                <Text style={[styles.wordPlaceholder, isCurrent && styles.wordPlaceholderCurrent]}>
                  ▬▬
                </Text>
              )}
            </View>
          );
        })}
      </View>

      {!isDone ? (
        voiceMode && !voiceFeedback ? (
          /* Voice controls */
          <>
            <Text style={styles.memorizeHint}>
              Word {currentWordIdx + 1} of {words.length} — recite it aloud
            </Text>
            <TouchableOpacity
              style={[styles.micBtn, isListening && styles.micBtnActive]}
              onPress={startListening}
              disabled={isListening}
              activeOpacity={0.8}
            >
              <Ionicons name={isListening ? 'radio' : 'mic'} size={36} color="#fff" />
              <Text style={styles.micBtnText}>
                {isListening ? 'Listening…' : 'Tap & recite'}
              </Text>
            </TouchableOpacity>
            {voiceError ? (
              <Text style={styles.voiceErrorHint}>{voiceError} — tap to retry</Text>
            ) : null}
            <TouchableOpacity style={styles.revealAllBtn} onPress={handleRevealAll}>
              <Text style={styles.revealAllText}>Reveal whole ayah</Text>
            </TouchableOpacity>
          </>
        ) : !voiceMode ? (
          /* Manual controls */
          <>
            <Text style={styles.memorizeHint}>
              Word {currentWordIdx + 1} of {words.length} — did you remember it?
            </Text>
            <View style={styles.memorizeActions}>
              <TouchableOpacity style={styles.knownBtn} onPress={handleKnown}>
                <Ionicons name="checkmark-circle-outline" size={22} color="#fff" />
                <Text style={styles.knownBtnText}>I knew it</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.peekBtn} onPress={handlePeek}>
                <Ionicons name="eye-outline" size={22} color={Colors.primary} />
                <Text style={styles.peekBtnText}>Show me</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.revealAllBtn} onPress={handleRevealAll}>
              <Text style={styles.revealAllText}>Reveal whole ayah</Text>
            </TouchableOpacity>
          </>
        ) : null
      ) : (
        /* Score card */
        <View style={styles.scoreCard}>
          <Text style={styles.scoreTitle}>Ayah Complete ✓</Text>
          <View style={styles.scoreRow}>
            <View style={styles.scoreItem}>
              <Text style={[styles.scoreNum, { color: Colors.primary }]}>{knownCount}</Text>
              <Text style={styles.scoreLabel}>Memorized ✓</Text>
            </View>
            <View style={styles.scoreDivider} />
            <View style={styles.scoreItem}>
              <Text style={[styles.scoreNum, { color: Colors.accent }]}>{peekedCount}</Text>
              <Text style={styles.scoreLabel}>Peeked 👁</Text>
            </View>
          </View>
        </View>
      )}

      {/* Ayah navigation */}
      <View style={styles.memorizeNav}>
        <TouchableOpacity
          style={[styles.navBtn, isFirst && styles.btnDisabled]}
          onPress={onPrev}
          disabled={isFirst}
        >
          <Ionicons name="chevron-back" size={20} color={isFirst ? Colors.border : Colors.primary} />
          <Text style={[styles.navBtnText, isFirst && styles.navBtnTextDisabled]}>Previous</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navBtn, isLast && styles.btnDisabled]}
          onPress={onNext}
          disabled={isLast}
        >
          <Text style={[styles.navBtnText, isLast && styles.navBtnTextDisabled]}>Next</Text>
          <Ionicons name="chevron-forward" size={20} color={isLast ? Colors.border : Colors.primary} />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { color: Colors.error, marginBottom: 16 },
  backBtn: { backgroundColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
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
  progressText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginBottom: 10 },
  progressBar: { height: 4, backgroundColor: Colors.border, borderRadius: 2, marginHorizontal: 16, marginBottom: 20, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 2 },
  ayahNumBadge: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.primary + '18', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  ayahNumText: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  btnDisabled: { opacity: 0.3 },

  // Listen mode
  listenContainer: { flex: 1, padding: 16, justifyContent: 'space-between' },
  reciterSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    backgroundColor: Colors.primary + '12',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 14,
  },
  reciterSelectorText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  bismillahListen: { fontSize: 18, color: Colors.primary, textAlign: 'center', marginBottom: 16 },
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
  listenAyahText: { fontSize: 26, lineHeight: 48, textAlign: 'center', color: Colors.textPrimary, writingDirection: 'rtl', marginBottom: 12 },
  listenAyahMeta: { fontSize: 12, color: Colors.textSecondary },
  listenControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, paddingBottom: 8 },
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
  bismillah: { padding: 14, alignItems: 'center', marginBottom: 8, backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  bismillahText: { fontSize: 20, color: Colors.primary, textAlign: 'center' },
  ayahCard: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: Colors.border },
  ayahCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  ayahMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  ayahBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.primary + '18', justifyContent: 'center', alignItems: 'center' },
  ayahNum: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  playBtn: { padding: 2 },
  ayahText: { fontSize: 22, lineHeight: 42, textAlign: 'right', color: Colors.textPrimary, writingDirection: 'rtl' },

  // Memorize mode
  memorizeScroll: { padding: 16, paddingBottom: 40 },
  errorNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#E53E3E',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  errorNoticeText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  wordsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 24, direction: 'rtl' },
  wordBlock: {
    backgroundColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 44,
    alignItems: 'center',
  },
  wordKnown: { backgroundColor: Colors.primary + '22', borderWidth: 1, borderColor: Colors.primary },
  wordPeeked: { backgroundColor: Colors.accent + '22', borderWidth: 1, borderColor: Colors.accent },
  wordCurrent: { backgroundColor: Colors.primary + '08', borderWidth: 2, borderColor: Colors.primary },
  wordText: { fontSize: 20, color: Colors.textPrimary },
  wordTextKnown: { color: Colors.primary },
  wordTextPeeked: { color: '#B7791F' },
  wordPlaceholder: { fontSize: 14, color: Colors.textSecondary, letterSpacing: 2 },
  wordPlaceholderCurrent: { color: Colors.primary },
  memorizeHint: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginBottom: 18 },
  memorizeActions: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  knownBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
  },
  knownBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  peekBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  peekBtnText: { color: Colors.primary, fontWeight: '700', fontSize: 15 },
  revealAllBtn: { alignSelf: 'center', paddingVertical: 8, marginBottom: 20 },
  revealAllText: { fontSize: 13, color: Colors.textSecondary, textDecorationLine: 'underline' },
  scoreCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  scoreTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center', marginBottom: 16 },
  scoreRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  scoreItem: { flex: 1, alignItems: 'center' },
  scoreNum: { fontSize: 36, fontWeight: '800', marginBottom: 4 },
  scoreLabel: { fontSize: 13, color: Colors.textSecondary },
  scoreDivider: { width: 1, height: 50, backgroundColor: Colors.border, marginHorizontal: 16 },
  memorizeNav: { flexDirection: 'row', justifyContent: 'space-between' },
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

  // Mode toggle (Manual / Voice)
  modeToggleRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: Colors.border,
    borderRadius: 20,
    padding: 3,
    marginBottom: 16,
    gap: 2,
  },
  modeToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 18,
  },
  modeToggleBtnActive: { backgroundColor: Colors.primary },
  modeToggleText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  modeToggleTextActive: { color: '#fff' },

  // Mic button
  micBtn: {
    alignSelf: 'center',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    width: 130,
    height: 130,
    borderRadius: 65,
    justifyContent: 'center',
    marginBottom: 16,
    elevation: 6,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  micBtnActive: { backgroundColor: '#C0392B' },
  micBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  voiceErrorHint: { fontSize: 12, color: Colors.error, textAlign: 'center', marginBottom: 12 },

  // Voice feedback card
  voiceFeedbackCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
  },
  voiceFeedbackOk: {
    backgroundColor: Colors.primary + '12',
    borderColor: Colors.primary,
  },
  voiceFeedbackBad: {
    backgroundColor: '#FFF5F5',
    borderColor: '#FC8181',
  },
  voiceFeedbackRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  voiceFeedbackCorrectText: { fontSize: 16, fontWeight: '700', color: Colors.primary },
  voiceYouSaid: { fontSize: 13, color: Colors.textSecondary, marginBottom: 4 },
  voiceRecognized: { fontSize: 18, fontWeight: '700', color: '#C53030' },
  voiceExpected: { fontSize: 13, color: Colors.textSecondary, marginBottom: 12 },
  voiceExpectedWord: { fontSize: 20, fontWeight: '700', color: Colors.primary },
  voiceFeedbackBtns: { flexDirection: 'row', gap: 10 },
  voiceRetryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  voiceRetryText: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  voiceSkipBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  voiceSkipText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },

  // Reciter modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
  },
  modalHandle: { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary, marginBottom: 12 },
  reciterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 6,
  },
  reciterItemActive: { backgroundColor: Colors.primary + '10' },
  reciterItemName: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  reciterItemAr: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
});
