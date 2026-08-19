import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  ScrollView,
  useWindowDimensions,
  Animated,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getSurah } from '../services/quranApi';
import {
  loadQuranIndex,
  findVerseByPhrase,
  stripLeadingBismillah,
} from '../services/quranIndex';
import { useRecitationSession } from '../hooks/useRecitationSession';
import { tokenize, alignTranscript } from '../utils/recitationMatcher';
import { Colors, Fonts } from '../constants/theme';
import type { SurahDetail } from '../types';

type FollowMode = 'follow' | 'memorize';

interface AyahWords {
  ayahIndex: number;
  numberInSurah: number;
  words: string[]; // display words (with tashkeel)
  startWord: number; // global index of first word
  page: number; // Madani mushaf page number
}

interface MushafPage {
  page: number;
  blocks: AyahWords[];
}

/** A boundary page that navigates to the previous/next surah when reached. */
interface SentinelPage {
  sentinel: 'prev' | 'next';
  page: number;
}

type PageItem = MushafPage | SentinelPage;

function isSentinel(p: PageItem): p is SentinelPage {
  return 'sentinel' in p;
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

export interface ReciteViewProps {
  surahId: number;
  /** Anchor the session at this ayah once loaded (cross-surah verse search). */
  initialAyah?: number;
  /** Word offset within the initial ayah to anchor at. */
  initialWord?: number;
  /**
   * The transcript that triggered a cross-surah jump — pre-aligned on
   * arrival so the words already recited count as progress instead of
   * being marked as mistakes.
   */
  initialTranscript?: string;
  /** Start listening automatically after anchoring. */
  autoStart?: boolean;
  /** Render the surah header with a back button (standalone screen). */
  showHeader?: boolean;
}

export default function ReciteView({
  surahId,
  initialAyah,
  initialWord,
  initialTranscript,
  autoStart,
  showHeader,
}: ReciteViewProps) {
  const [surah, setSurah] = useState<SurahDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<FollowMode>('follow');
  const [seconds, setSeconds] = useState(0);
  const [mistakesOpen, setMistakesOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [foundNote, setFoundNote] = useState<string | null>(null);
  const { width: pageWidth } = useWindowDimensions();

  useEffect(() => {
    if (!surahId) return;
    getSurah(surahId)
      .then(setSurah)
      .catch((e: unknown) =>
        setLoadError(e instanceof Error ? e.message : 'Failed to load surah')
      )
      .finally(() => setLoading(false));
  }, [surahId]);

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
          page: ayah.page,
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

  // Group ayahs into mushaf pages (real Madani page numbers from the API).
  const pages = useMemo(() => {
    const result: MushafPage[] = [];
    for (const b of ayahBlocks) {
      const last = result[result.length - 1];
      if (last && last.page === b.page) last.blocks.push(b);
      else result.push({ page: b.page, blocks: [b] });
    }
    return result;
  }, [ayahBlocks]);

  // Boundary sentinels: swiping past the first/last page moves to the
  // neighboring surah, like paging through a physical mushaf.
  const listData = useMemo(() => {
    const arr: PageItem[] = [...pages];
    if (pages.length > 0) {
      if (surahId > 1) arr.unshift({ sentinel: 'prev', page: -1 });
      if (surahId < 114) arr.push({ sentinel: 'next', page: -2 });
    }
    return arr;
  }, [pages, surahId]);
  const prevOffset = pages.length > 0 && surahId > 1 ? 1 : 0;

  const navigatingRef = useRef(false);
  const navigateToSurah = useCallback(
    async (target: number) => {
      if (navigatingRef.current || target < 1 || target > 114) return;
      navigatingRef.current = true;
      await sessionRef.current?.stop();
      // Standalone screen hops recite→recite; embedded (surah Read tab)
      // replaces the whole surah screen, which opens on the Read tab.
      router.replace(showHeader ? `/recite/${target}` : `/surah/${target}`);
    },
    [showHeader]
  );

  // Warm up the verse-search index in the background so the first "find my
  // verse" doesn't pay the download cost.
  useEffect(() => {
    loadQuranIndex().catch(() => {});
  }, []);

  // Voice verse search: the reciter is saying something that doesn't match
  // here — find the verse anywhere in the Quran and jump to it.
  const searchBusyRef = useRef(false);
  const ayahBlocksRef = useRef<AyahWords[]>([]);
  ayahBlocksRef.current = ayahBlocks;
  const expectedNormRef = useRef<string[]>([]);
  expectedNormRef.current = expectedNorm;

  const handleNoMatch = useCallback(
    async (transcript: string) => {
      if (searchBusyRef.current) return;
      searchBusyRef.current = true;
      setSearching(true);
      try {
        const entries = await loadQuranIndex();
        const heard = tokenize(transcript);
        // Nearly every surah opens with Bismillah — the words AFTER it are
        // what identify the verse, so search the stripped form first.
        const stripped = stripLeadingBismillah(heard);
        const match =
          (stripped && findVerseByPhrase(entries, stripped, surahId)) ||
          findVerseByPhrase(entries, heard, surahId);
        if (!match) return;
        if (match.surah === surahId) {
          const block = ayahBlocksRef.current.find(
            (b) => b.numberInSurah === match.ayah
          );
          if (block) {
            const target = block.startWord + match.wordOffset;
            const liveCursor = sessionRef.current?.cursor ?? 0;
            // Already reciting right here — nothing to jump to.
            if (Math.abs(target - liveCursor) <= 6) return;
            // Credit everything already recited: align the triggering
            // transcript from the landing point and jump past it.
            const credited = alignTranscript(
              expectedNormRef.current,
              target,
              transcript
            ).cursor;
            sessionRef.current?.seekTo(Math.max(target, credited));
            setFoundNote(`Jumped to verse ${match.ayah}`);
            setTimeout(() => setFoundNote(null), 3000);
          }
        } else {
          await sessionRef.current?.stop();
          router.replace(
            `/recite/${match.surah}?ayah=${match.ayah}&w=${match.wordOffset}&auto=1&t=${encodeURIComponent(transcript)}`
          );
        }
      } catch {
        // Index download failed (offline?) — stay put, keep listening.
      } finally {
        setSearching(false);
        searchBusyRef.current = false;
      }
    },
    [surahId]
  );

  const session = useRecitationSession(expectedNorm, {
    onNoMatch: handleNoMatch,
  });
  const sessionRef = useRef<typeof session | null>(null);
  sessionRef.current = session;
  const {
    cursor,
    livePos,
    missed,
    peeked,
    active,
    error,
    start,
    stop,
    reset,
    peekWord,
    dismissMiss,
    seekTo,
  } = session;

  // Deep link: /recite/<surah>?ayah=N (used by cross-surah verse search).
  // Anchor the session at that ayah once the surah loads; auto=1 also starts
  // listening immediately so the recitation continues seamlessly.
  const anchoredRef = useRef(false);
  useEffect(() => {
    if (anchoredRef.current || !initialAyah || ayahBlocks.length === 0) return;
    const block = ayahBlocks.find((b) => b.numberInSurah === initialAyah);
    if (!block) return;
    anchoredRef.current = true;
    const offset = Math.min(initialWord ?? 0, block.words.length - 1);
    let anchor = block.startWord + Math.max(0, offset);
    // Credit the words that triggered the jump — the reciter may already be
    // mid-verse, and re-marking the beginning as "missed" would be wrong.
    if (initialTranscript) {
      const credited = alignTranscript(
        expectedNorm,
        anchor,
        initialTranscript
      ).cursor;
      anchor = Math.max(anchor, credited);
    }
    seekTo(anchor);
    // Small delay lets the previous screen's recognizer teardown finish
    // before this session claims the microphone.
    if (autoStart) {
      const t = setTimeout(() => start(), 200);
      return () => clearTimeout(t);
    }
  }, [
    initialAyah,
    initialWord,
    initialTranscript,
    autoStart,
    ayahBlocks,
    expectedNorm,
    seekTo,
    start,
  ]);

  // Session timer
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  // Auto page-turn: the mushaf page containing the live position (follows
  // the reciter even when they restart a passage after catching their breath)
  const listRef = useRef<FlatList<PageItem>>(null);
  const currentPageIdx = useMemo(() => {
    for (let i = pages.length - 1; i >= 0; i--) {
      const first = pages[i].blocks[0];
      if (livePos >= first.startWord) return i;
    }
    return 0;
  }, [livePos, pages]);

  useEffect(() => {
    if (pages.length === 0) return;
    listRef.current?.scrollToIndex({
      index: currentPageIdx + prevOffset,
      animated: true,
    });
  }, [currentPageIdx, pages.length, prevOffset]);

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
    <View style={styles.container}>
      {showHeader ? (
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
      ) : null}

      {/* Mode toggle */}
      <View style={styles.modeTabs}>
        {(['follow', 'memorize'] as FollowMode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.modeTab, mode === m && styles.modeTabActive]}
            onPress={() => setMode(m)}
            activeOpacity={0.8}
          >
            <Ionicons
              name={m === 'follow' ? 'eye-outline' : 'eye-off-outline'}
              size={15}
              color={mode === m ? '#fff' : Colors.textSecondary}
            />
            <Text
              style={[styles.modeTabText, mode === m && styles.modeTabTextActive]}
            >
              {m === 'follow' ? 'Follow' : 'Hidden'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      {/* Mushaf pages — horizontal, right-to-left like a physical Quran.
          Sentinel pages at both ends page into the neighboring surahs. */}
      <FlatList
        ref={listRef}
        data={listData}
        horizontal
        inverted
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(p) => (isSentinel(p) ? p.sentinel : String(p.page))}
        extraData={{ cursor, livePos, missed, peeked, mode }}
        initialScrollIndex={prevOffset}
        windowSize={5}
        maxToRenderPerBatch={3}
        initialNumToRender={2}
        getItemLayout={(_, index) => ({
          length: pageWidth,
          offset: pageWidth * index,
          index,
        })}
        onScrollToIndexFailed={() => {}}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
          const item = listData[idx];
          if (item && isSentinel(item)) {
            navigateToSurah(item.sentinel === 'prev' ? surahId - 1 : surahId + 1);
          }
        }}
        renderItem={({ item }) =>
          isSentinel(item) ? (
            <View style={[styles.page, styles.sentinelPage, { width: pageWidth }]}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={styles.sentinelText}>
                {item.sentinel === 'prev' ? 'Previous surah…' : 'Next surah…'}
              </Text>
            </View>
          ) : (
            <MushafPageView
              page={item}
              width={pageWidth}
              cursor={cursor}
              livePos={livePos}
              missed={missed}
              peeked={peeked}
              hidden={mode === 'memorize'}
            />
          )
        }
      />

      {done ? (
        <View style={styles.doneBox}>
          <Ionicons name="checkmark-circle" size={28} color={Colors.primary} />
          <Text style={styles.doneTitle}>Surah completed!</Text>
          <Text style={styles.doneMeta}>
            {formatTime(seconds)} · {mistakeCount} mistake
            {mistakeCount === 1 ? '' : 's'}
          </Text>
        </View>
      ) : null}

      {searching ? (
        <View style={styles.searchBanner}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.searchBannerText}>Finding your verse…</Text>
        </View>
      ) : null}

      {foundNote ? (
        <View style={styles.foundBanner}>
          <Ionicons name="locate" size={16} color="#fff" />
          <Text style={styles.searchBannerText}>{foundNote}</Text>
        </View>
      ) : null}

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

        <MicButton active={active} onPress={handleMicPress} />
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
    </View>
  );
}

function MicButton({ active, onPress }: { active: boolean; onPress: () => void }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1600,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  const ringScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.55],
  });
  const ringOpacity = pulse.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [0.45, 0.12, 0],
  });

  return (
    <View style={styles.micWrap}>
      {active && (
        <Animated.View
          style={[
            styles.micRing,
            { transform: [{ scale: ringScale }], opacity: ringOpacity },
          ]}
        />
      )}
      <TouchableOpacity
        onPress={onPress}
        style={[styles.micBtn, active && styles.micBtnActive]}
        activeOpacity={0.85}
      >
        <Ionicons name={active ? 'stop' : 'mic'} size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const MushafPageView = React.memo(function MushafPageView({
  page,
  width,
  cursor,
  livePos,
  missed,
  peeked,
  hidden,
}: {
  page: MushafPage;
  width: number;
  cursor: number;
  livePos: number;
  missed: Map<number, string | null>;
  peeked: Set<number>;
  hidden: boolean;
}) {
  return (
    <View style={[styles.page, { width }]}>
      <View style={styles.paperCard}>
        <View style={styles.paperRule} />
        <ScrollView
          contentContainerStyle={styles.pageContent}
          showsVerticalScrollIndicator={false}
        >
          {/* All ayahs of the page flow together, mushaf style */}
          <Text style={styles.ayahText}>
          {page.blocks.map((block) => (
            <Text key={block.ayahIndex}>
              {block.words.map((word, i) => {
                const g = block.startWord + i;
                // Reveal is driven by furthest progress (cursor); the amber
                // "you are here" highlight follows the live position, which
                // moves back when the reciter restarts after a breath.
                const isRevealed = g < cursor;
                const isCurrent = g === livePos;
                const isMissed = missed.has(g);
                const isPeeked = peeked.has(g);

                let style;
                if (isCurrent) {
                  style =
                    hidden && !isRevealed
                      ? styles.wordHiddenCurrent
                      : styles.wordCurrent;
                } else if (isRevealed) {
                  if (isMissed) style = styles.wordMissed;
                  else if (isPeeked) style = styles.wordPeeked;
                  else style = styles.wordDone;
                } else {
                  style = hidden ? styles.wordHidden : styles.wordUpcoming;
                }

                // Hidden mode: unrevealed words are placeholder blocks —
                // words already reached stay revealed during a breath replay.
                const display = hidden && !isRevealed ? '•'.repeat(3) : word;

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
          ))}
          </Text>
        </ScrollView>
        <View style={styles.pageFooter}>
          <View style={styles.pageNumberBadge}>
            <Text style={styles.pageNumber}>{toArabicNumber(page.page)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
},
// Re-render a page ONLY when its own words change state. Cursor/livePos are
// clamped to the page's word range — a movement entirely outside the page
// looks identical from inside it, so hundreds of off-screen pages skip
// re-rendering on every recognized word.
(prev, next) => {
  if (
    prev.page !== next.page ||
    prev.width !== next.width ||
    prev.hidden !== next.hidden ||
    prev.missed !== next.missed ||
    prev.peeked !== next.peeked
  ) {
    return false;
  }
  const first = next.page.blocks[0];
  const last = next.page.blocks[next.page.blocks.length - 1];
  const start = first.startWord;
  const end = last.startWord + last.words.length;
  const clamp = (v: number) => (v < start ? start - 1 : v > end ? end + 1 : v);
  return (
    clamp(prev.cursor) === clamp(next.cursor) &&
    clamp(prev.livePos) === clamp(next.livePos)
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
    borderRadius: 10,
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
  headerBack: { marginRight: 12, padding: 2 },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  headerMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  headerArabic: {
    fontSize: 24,
    color: Colors.primary,
    fontFamily: Fonts.arabicBold,
  },

  modeTabs: {
    flexDirection: 'row',
    marginHorizontal: 14,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: '#EBE5D6',
    borderRadius: 12,
    padding: 3,
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTabActive: { backgroundColor: Colors.primary, elevation: 2 },
  modeTabText: { fontSize: 13.5, color: Colors.textSecondary, fontWeight: '600' },
  modeTabTextActive: { color: '#fff' },

  progressTrack: {
    height: 5,
    backgroundColor: '#E4DECE',
    marginHorizontal: 14,
    marginBottom: 4,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.accent,
    borderRadius: 3,
  },

  page: { flex: 1, paddingHorizontal: 10, paddingVertical: 8 },
  paperCard: {
    flex: 1,
    backgroundColor: Colors.paper,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.paperEdge,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  paperRule: {
    height: 3,
    backgroundColor: Colors.accent,
    opacity: 0.55,
    marginHorizontal: 40,
    marginTop: 10,
    borderRadius: 2,
  },
  pageContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  pageFooter: { alignItems: 'center', paddingBottom: 8 },
  pageNumberBadge: {
    borderWidth: 1,
    borderColor: Colors.paperEdge,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 2,
    backgroundColor: Colors.surface,
  },
  pageNumber: { color: Colors.textSecondary, fontSize: 12.5 },
  sentinelPage: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  sentinelText: { color: Colors.textSecondary, fontSize: 14 },

  ayahText: {
    fontFamily: Fonts.quran,
    fontSize: 24,
    lineHeight: 54,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  wordDone: { color: Colors.primaryLight },
  wordMissed: { color: Colors.error },
  wordPeeked: { color: '#B8860B' },
  wordCurrent: {
    color: Colors.primary,
    backgroundColor: Colors.accentSoft,
    borderRadius: 6,
  },
  wordUpcoming: { color: '#BDB5A3' },
  wordHidden: { color: 'transparent', backgroundColor: '#EAE3D2', borderRadius: 6 },
  wordHiddenCurrent: {
    color: 'transparent',
    backgroundColor: Colors.accentSoft,
    borderRadius: 6,
  },
  ayahMarker: { color: Colors.accent, fontFamily: Fonts.arabic, fontSize: 21 },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.error,
    marginHorizontal: 14,
    marginBottom: 6,
    padding: 9,
    borderRadius: 12,
  },
  errorBannerText: { color: '#fff', fontSize: 12, flex: 1 },
  searchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primaryLight,
    marginHorizontal: 14,
    marginBottom: 6,
    padding: 9,
    borderRadius: 12,
  },
  foundBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.accent,
    marginHorizontal: 14,
    marginBottom: 6,
    padding: 9,
    borderRadius: 12,
  },
  searchBannerText: { color: '#fff', fontSize: 12.5, flex: 1, fontWeight: '600' },

  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginBottom: 10,
    marginTop: 2,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    gap: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  statsCol: { flex: 1 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recDot: { width: 8, height: 8, borderRadius: 4 },
  recDotOn: { backgroundColor: Colors.error },
  recDotOff: { backgroundColor: Colors.border },
  timerText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  mistakesText: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  mistakesTextActive: { color: Colors.error, fontWeight: '700' },

  resetBtn: {
    padding: 9,
    borderRadius: 12,
    backgroundColor: Colors.background,
  },
  peekBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: Colors.successSoft,
  },
  peekText: { color: Colors.primary, fontSize: 13, fontWeight: '700' },

  micWrap: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center' },
  micRing: {
    position: 'absolute',
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: Colors.error,
  },
  micBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  micBtnActive: { backgroundColor: Colors.error },

  doneBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 6,
    padding: 10,
    borderRadius: 12,
    backgroundColor: Colors.successSoft,
    borderWidth: 1,
    borderColor: Colors.primaryLight,
  },
  doneTitle: { fontSize: 15.5, fontWeight: '700', color: Colors.primary },
  doneMeta: { fontSize: 12.5, color: Colors.textSecondary },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(24,22,16,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingBottom: 26,
    maxHeight: '72%',
  },
  modalHandle: {
    width: 42,
    height: 5,
    borderRadius: 3,
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
    backgroundColor: Colors.paper,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.paperEdge,
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  mistakeTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mistakeAyahBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  mistakeAyahText: { fontSize: 14, color: Colors.accent, fontWeight: '700' },
  mistakeContext: {
    flex: 1,
    fontFamily: Fonts.quran,
    fontSize: 18,
    lineHeight: 40,
    color: Colors.textPrimary,
    writingDirection: 'rtl',
    textAlign: 'right',
  },
  mistakeContextBad: {
    color: Colors.error,
    backgroundColor: Colors.errorSoft,
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
    fontSize: 17,
    color: Colors.primary,
    fontWeight: '700',
    backgroundColor: Colors.successSoft,
    borderRadius: 4,
  },
  mistakeHeardLabel: { fontSize: 12, color: Colors.textSecondary },
  mistakeHeardWord: { fontSize: 15, color: Colors.error, fontWeight: '700' },
  mistakePeekedLabel: { fontSize: 12, color: '#B8860B' },
  dismissBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: Colors.successSoft,
  },
  dismissBtnText: { fontSize: 12, color: Colors.primary, fontWeight: '700' },
  mistakeEmpty: {
    textAlign: 'center',
    color: Colors.textSecondary,
    paddingVertical: 20,
    fontSize: 14,
  },
});
