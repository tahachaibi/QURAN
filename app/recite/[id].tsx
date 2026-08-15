import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { getSurah } from '../../src/services/quranApi';
import { useRecitationSession } from '../../src/hooks/useRecitationSession';
import { tokenize } from '../../src/utils/recitationMatcher';
import { Colors } from '../../src/constants/theme';
import type { SurahDetail } from '../../src/types';

type FollowMode = 'follow' | 'memorize';

interface AyahWords {
  ayahIndex: number;
  numberInSurah: number;
  words: string[]; // display words (with tashkeel)
  startWord: number; // global index of first word
}

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
function toArabicNumber(n: number): string {
  return String(n)
    .split('')
    .map((d) => ARABIC_DIGITS[Number(d)] ?? d)
    .join('');
}

function formatTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function ReciteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [surah, setSurah] = useState<SurahDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<FollowMode>('follow');
  const [seconds, setSeconds] = useState(0);
  const [mistakesOpen, setMistakesOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    getSurah(Number(id))
      .then(setSurah)
      .catch((e: unknown) =>
        setLoadError(e instanceof Error ? e.message : 'Failed to load surah')
      )
      .finally(() => setLoading(false));
  }, [id]);

  // Flatten the surah into per-ayah word lists + one normalized word stream.
  const { ayahBlocks, expectedNorm, totalWords } = useMemo(() => {
    const blocks: AyahWords[] = [];
    const norm: string[] = [];
    if (surah) {
      let globalIdx = 0;
      surah.ayahs.forEach((ayah, ayahIndex) => {
        const displayWords = ayah.text.split(/\s+/).filter(Boolean);
        blocks.push({
          ayahIndex,
          numberInSurah: ayah.numberInSurah,
          words: displayWords,
          startWord: globalIdx,
        });
        for (const w of displayWords) {
          const t = tokenize(w);
          // tokenize() may drop pure-symbol tokens; keep 1:1 with display words
          norm.push(t[0] ?? '');
        }
        globalIdx += displayWords.length;
      });
    }
    return { ayahBlocks: blocks, expectedNorm: norm, totalWords: norm.length };
  }, [surah]);

  const session = useRecitationSession(expectedNorm);
  const {
    cursor,
    missed,
    peeked,
    active,
    error,
    start,
    stop,
    reset,
    peekWord,
    dismissMiss,
  } = session;

  // Session timer
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  // Auto-scroll to the ayah containing the cursor
  const listRef = useRef<FlatList<AyahWords>>(null);
  const currentAyahIdx = useMemo(() => {
    for (let i = ayahBlocks.length - 1; i >= 0; i--) {
      if (cursor >= ayahBlocks[i].startWord) return i;
    }
    return 0;
  }, [cursor, ayahBlocks]);

  useEffect(() => {
    if (!active || ayahBlocks.length === 0) return;
    listRef.current?.scrollToIndex({
      index: currentAyahIdx,
      viewPosition: 0.35,
      animated: true,
    });
  }, [currentAyahIdx, active, ayahBlocks.length]);

  const done = totalWords > 0 && cursor >= totalWords;

  useEffect(() => {
    if (done && active) stop();
  }, [done, active, stop]);

  // Build the review list: every miss/peek with its ayah + correct word.
  // (Must live above the early returns — hooks can't be conditional.)
  const mistakeEntries = useMemo(() => {
    if (ayahBlocks.length === 0) return [];
    const findBlock = (g: number) => {
      for (let i = ayahBlocks.length - 1; i >= 0; i--) {
        if (g >= ayahBlocks[i].startWord) return ayahBlocks[i];
      }
      return ayahBlocks[0];
    };
    const makeEntry = (
      g: number,
      heard: string | null,
      type: 'missed' | 'peeked'
    ) => {
      const b = findBlock(g);
      const wi = g - b.startWord;
      // Verse context: a few words on each side of the flagged word.
      const from = Math.max(0, wi - 3);
      const to = Math.min(b.words.length, wi + 4);
      return {
        index: g,
        ayah: b.numberInSurah,
        correct: b.words[wi] ?? '',
        context: b.words.slice(from, to),
        highlight: wi - from,
        heard,
        type,
      };
    };
    const entries = [
      ...[...missed].map(([g, heard]) => makeEntry(g, heard, 'missed' as const)),
      ...[...peeked].map((g) => makeEntry(g, null, 'peeked' as const)),
    ];
    return entries.sort((a, b) => a.index - b.index);
  }, [missed, peeked, ayahBlocks]);

  async function handleMicPress() {
    if (active) {
      await stop();
    } else {
      if (done) {
        await reset();
        setSeconds(0);
      }
      await start();
    }
  }

  async function handleReset() {
    await reset();
    setSeconds(0);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (loadError || !surah) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{loadError ?? 'Not found'}</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const mistakeCount = missed.size + peeked.size;
  const progress = totalWords > 0 ? cursor / totalWords : 0;

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
            Recite along · {surah.numberOfAyahs} verses
          </Text>
        </View>
        <Text style={styles.headerArabic}>{surah.name}</Text>
      </View>

      {/* Mode toggle */}
      <View style={styles.modeTabs}>
        {(['follow', 'memorize'] as FollowMode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.modeTab, mode === m && styles.modeTabActive]}
            onPress={() => setMode(m)}
          >
            <Text
              style={[styles.modeTabText, mode === m && styles.modeTabTextActive]}
            >
              {m === 'follow' ? '👁 Follow' : '🧠 Hidden'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      {/* Text */}
      <FlatList
        ref={listRef}
        data={ayahBlocks}
        keyExtractor={(b) => String(b.ayahIndex)}
        extraData={{ cursor, missed, peeked, mode }}
        contentContainerStyle={styles.listContent}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item }) => (
          <AyahLine
            block={item}
            cursor={cursor}
            missed={missed}
            peeked={peeked}
            hidden={mode === 'memorize'}
          />
        )}
        ListFooterComponent={
          done ? (
            <View style={styles.doneBox}>
              <Ionicons name="checkmark-circle" size={40} color={Colors.primary} />
              <Text style={styles.doneTitle}>Surah completed!</Text>
              <Text style={styles.doneMeta}>
                {formatTime(seconds)} · {mistakeCount} mistake
                {mistakeCount === 1 ? '' : 's'}
              </Text>
            </View>
          ) : null
        }
      />

      {error ? (
        <View style={styles.errorBanner}>
          <Ionicons name="warning-outline" size={16} color="#fff" />
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      ) : null}

      {/* Bottom bar */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.statsCol}
          onPress={() => setMistakesOpen(true)}
          disabled={mistakeCount === 0}
        >
          <View style={styles.statRow}>
            <View
              style={[styles.recDot, active ? styles.recDotOn : styles.recDotOff]}
            />
            <Text style={styles.timerText}>{formatTime(seconds)}</Text>
          </View>
          <View style={styles.statRow}>
            <Text
              style={[
                styles.mistakesText,
                mistakeCount > 0 && styles.mistakesTextActive,
              ]}
            >
              {mistakeCount} mistake{mistakeCount === 1 ? '' : 's'}
            </Text>
            {mistakeCount > 0 && (
              <Ionicons name="chevron-up" size={12} color={Colors.error} />
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleReset} style={styles.resetBtn}>
          <Ionicons name="refresh" size={22} color={Colors.textSecondary} />
        </TouchableOpacity>

        {mode === 'memorize' && (
          <TouchableOpacity onPress={peekWord} style={styles.peekBtn}>
            <Ionicons name="eye-outline" size={22} color={Colors.primary} />
            <Text style={styles.peekText}>Peek</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={handleMicPress}
          style={[styles.micBtn, active && styles.micBtnActive]}
        >
          <Ionicons name={active ? 'stop' : 'mic'} size={30} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Mistakes review */}
      <Modal
        visible={mistakesOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMistakesOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setMistakesOpen(false)}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              Mistakes ({mistakeEntries.length})
            </Text>
            <ScrollView style={styles.mistakeList}>
              {mistakeEntries.map((m) => (
                <View key={m.index} style={styles.mistakeRow}>
                  <View style={styles.mistakeTopRow}>
                    <View style={styles.mistakeAyahBadge}>
                      <Text style={styles.mistakeAyahText}>
                        {toArabicNumber(m.ayah)}
                      </Text>
                    </View>
                    {/* Verse context, flagged word in red inline */}
                    <Text style={styles.mistakeContext}>
                      {m.context.map((w, i) => (
                        <Text
                          key={i}
                          style={
                            i === m.highlight
                              ? styles.mistakeContextBad
                              : undefined
                          }
                        >
                          {w}
                          {i < m.context.length - 1 ? ' ' : ''}
                        </Text>
                      ))}
                    </Text>
                  </View>
                  <View style={styles.mistakeBottomRow}>
                    <TouchableOpacity
                      style={styles.dismissBtn}
                      onPress={() => dismissMiss(m.index)}
                    >
                      <Ionicons
                        name="checkmark"
                        size={14}
                        color={Colors.primary}
                      />
                      <Text style={styles.dismissBtnText}>I said it right</Text>
                    </TouchableOpacity>
                    <View style={styles.mistakeDetail}>
                      {m.type === 'peeked' ? (
                        <Text style={styles.mistakePeekedLabel}>
                          👁 Revealed with Peek
                        </Text>
                      ) : m.heard ? (
                        <Text style={styles.mistakeHeardLabel}>
                          You said:{' '}
                          <Text style={styles.mistakeHeardWord}>{m.heard}</Text>
                        </Text>
                      ) : (
                        <Text style={styles.mistakeHeardLabel}>
                          Skipped or not recognized
                        </Text>
                      )}
                      <Text style={styles.mistakeCorrectLabel}>
                        Correct:{' '}
                        <Text style={styles.mistakeCorrect}>{m.correct}</Text>
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
              {mistakeEntries.length === 0 && (
                <Text style={styles.mistakeEmpty}>No mistakes — ما شاء الله!</Text>
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const AyahLine = React.memo(function AyahLine({
  block,
  cursor,
  missed,
  peeked,
  hidden,
}: {
  block: AyahWords;
  cursor: number;
  missed: Map<number, string | null>;
  peeked: Set<number>;
  hidden: boolean;
}) {
  return (
    <Text style={styles.ayahText}>
      {block.words.map((word, i) => {
        const g = block.startWord + i;
        const isPast = g < cursor;
        const isCurrent = g === cursor;
        const isMissed = missed.has(g);
        const isPeeked = peeked.has(g);

        let style;
        if (isPast) {
          if (isMissed) style = styles.wordMissed;
          else if (isPeeked) style = styles.wordPeeked;
          else style = styles.wordDone;
        } else if (isCurrent) {
          style = hidden ? styles.wordHiddenCurrent : styles.wordCurrent;
        } else {
          style = hidden ? styles.wordHidden : styles.wordUpcoming;
        }

        // In hidden mode, unrevealed words render as placeholder blocks
        const display = hidden && !isPast ? '•'.repeat(3) : word;

        return (
          <Text key={g} style={style}>
            {display}
            {i < block.words.length - 1 ? ' ' : ''}
          </Text>
        );
      })}
      <Text style={styles.ayahMarker}>
        {' '}﴿{toArabicNumber(block.numberInSurah)}﴾{' '}
      </Text>
    </Text>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  errorText: { color: Colors.error, fontSize: 16, marginBottom: 16 },
  backBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  backBtnText: { color: '#fff', fontWeight: '600' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerBack: { marginRight: 12 },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  headerMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  headerArabic: { fontSize: 20, color: Colors.primary, fontWeight: '600' },

  modeTabs: {
    flexDirection: 'row',
    margin: 12,
    backgroundColor: '#ECEAE4',
    borderRadius: 10,
    padding: 3,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  modeTabActive: { backgroundColor: Colors.surface, elevation: 1 },
  modeTabText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' },
  modeTabTextActive: { color: Colors.primary },

  progressTrack: {
    height: 4,
    backgroundColor: Colors.border,
    marginHorizontal: 12,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.accent,
    borderRadius: 2,
  },

  listContent: { padding: 16, paddingBottom: 24 },
  ayahText: {
    fontSize: 26,
    lineHeight: 46,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: 10,
  },
  wordDone: { color: Colors.primaryLight },
  wordMissed: { color: Colors.error },
  wordPeeked: { color: Colors.accent },
  wordCurrent: {
    color: Colors.textPrimary,
    backgroundColor: '#F4E7C3',
    borderRadius: 4,
  },
  wordUpcoming: { color: '#B9B4A9' },
  wordHidden: { color: 'transparent', backgroundColor: '#E8E4DC', borderRadius: 4 },
  wordHiddenCurrent: {
    color: 'transparent',
    backgroundColor: '#F4E7C3',
    borderRadius: 4,
  },
  ayahMarker: { color: Colors.accent, fontSize: 22 },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.error,
    marginHorizontal: 12,
    marginBottom: 6,
    padding: 8,
    borderRadius: 8,
  },
  errorBannerText: { color: '#fff', fontSize: 12, flex: 1 },

  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 12,
  },
  statsCol: { flex: 1 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recDot: { width: 8, height: 8, borderRadius: 4 },
  recDotOn: { backgroundColor: Colors.error },
  recDotOff: { backgroundColor: Colors.border },
  timerText: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  mistakesText: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  mistakesTextActive: { color: Colors.error, fontWeight: '600' },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 24,
    maxHeight: '70%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginVertical: 10,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  mistakeList: { flexGrow: 0 },
  mistakeRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  mistakeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mistakeAyahBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mistakeAyahText: { fontSize: 14, color: Colors.accent, fontWeight: '700' },
  mistakeContext: {
    flex: 1,
    fontSize: 20,
    lineHeight: 34,
    color: Colors.textPrimary,
    writingDirection: 'rtl',
    textAlign: 'right',
  },
  mistakeContextBad: {
    color: Colors.error,
    fontWeight: '700',
    backgroundColor: '#FBE3E5',
    borderRadius: 4,
  },
  mistakeBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  mistakeDetail: { flex: 1, alignItems: 'flex-end', gap: 2 },
  mistakeCorrectLabel: { fontSize: 12, color: Colors.textSecondary },
  mistakeCorrect: {
    fontSize: 18,
    color: Colors.primary,
    fontWeight: '700',
    backgroundColor: '#E7F0EA',
    borderRadius: 4,
  },
  mistakeHeardLabel: { fontSize: 12, color: Colors.textSecondary },
  mistakeHeardWord: { fontSize: 15, color: Colors.error, fontWeight: '600' },
  mistakePeekedLabel: { fontSize: 12, color: Colors.accent },
  dismissBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  dismissBtnText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  mistakeEmpty: {
    textAlign: 'center',
    color: Colors.textSecondary,
    paddingVertical: 20,
    fontSize: 14,
  },
  resetBtn: { padding: 8 },
  peekBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  peekText: { color: Colors.primary, fontSize: 13, fontWeight: '600' },
  micBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  micBtnActive: { backgroundColor: Colors.error },

  doneBox: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  doneTitle: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  doneMeta: { fontSize: 13, color: Colors.textSecondary },
});
