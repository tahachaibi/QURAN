import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useSurahs } from '../../src/hooks/useQuran';
import { Colors, Fonts } from '../../src/constants/theme';
import type { Surah } from '../../src/types';

export default function QuranScreen() {
  const { surahs, loading, error } = useSurahs();
  const [query, setQuery] = useState('');

  const filtered = query
    ? surahs.filter(
        (s) =>
          s.englishName.toLowerCase().includes(query.toLowerCase()) ||
          s.name.includes(query) ||
          String(s.number).startsWith(query)
      )
    : surahs;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  function renderItem({ item }: { item: Surah }) {
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => router.push(`/surah/${item.number}` as never)}
      >
        <View style={styles.badge}>
          <Text style={styles.badgeNum}>{item.number}</Text>
        </View>
        <View style={styles.info}>
          <Text style={styles.nameEn}>{item.englishName}</Text>
          <Text style={styles.meta}>
            {item.englishNameTranslation} · {item.numberOfAyahs} verses ·{' '}
            {item.revelationType}
          </Text>
        </View>
        <Text style={styles.nameAr}>{item.name}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerArea}>
        <Text style={styles.title}>Quran</Text>
        <TextInput
          style={styles.search}
          placeholder="Search surah…"
          placeholderTextColor={Colors.textSecondary}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.number)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: Colors.error },
  headerArea: { padding: 16, paddingBottom: 8 },
  title: { fontSize: 28, fontWeight: '700', color: Colors.textPrimary, marginBottom: 12 },
  search: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  list: { paddingHorizontal: 16, paddingBottom: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary + '18',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  badgeNum: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  info: { flex: 1 },
  nameEn: { fontSize: 16, fontWeight: '600', color: Colors.textPrimary },
  meta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  nameAr: { fontSize: 21, color: Colors.primary, fontFamily: Fonts.arabicBold },
});
