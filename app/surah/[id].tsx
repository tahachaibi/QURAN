import React, { useState, useEffect, useRef } from 'react';
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

export default function SurahScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [surah, setSurah] = useState<SurahDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playingNumber, setPlayingNumber] = useState<number | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    });
    if (id) {
      getSurah(Number(id))
        .then(setSurah)
        .catch((e: unknown) =>
          setError(e instanceof Error ? e.message : 'Failed to load surah')
        )
        .finally(() => setLoading(false));
    }
    return () => {
      soundRef.current?.unloadAsync();
    };
  }, [id]);

  async function toggleAyah(ayah: Ayah) {
    if (soundRef.current) {
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    if (playingNumber === ayah.number) {
      setPlayingNumber(null);
      return;
    }
    setPlayingNumber(ayah.number);
    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: getAudioUrl(ayah.number) },
        { shouldPlay: true }
      );
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlayingNumber(null);
        }
      });
    } catch {
      setPlayingNumber(null);
    }
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

  function renderAyah({ item }: { item: Ayah }) {
    const isPlaying = playingNumber === item.number;
    return (
      <View style={styles.ayahCard}>
        <View style={styles.ayahMeta}>
          <View style={styles.ayahBadge}>
            <Text style={styles.ayahNum}>{item.numberInSurah}</Text>
          </View>
          <TouchableOpacity onPress={() => toggleAyah(item)} style={styles.playBtn}>
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

      {surah.number !== 9 && (
        <View style={styles.bismillah}>
          <Text style={styles.bismillahText}>
            بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ
          </Text>
        </View>
      )}

      <FlatList
        data={surah.ayahs}
        keyExtractor={(item) => String(item.number)}
        renderItem={renderAyah}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

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
  bismillah: {
    padding: 14,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  bismillahText: { fontSize: 22, color: Colors.primary, textAlign: 'center' },
  list: { padding: 14 },
  ayahCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
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
});
