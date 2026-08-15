import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import ReciteView from '../../src/components/ReciteView';
import { Colors } from '../../src/constants/theme';

export default function ReciteScreen() {
  const { id, ayah, auto } = useLocalSearchParams<{
    id: string;
    ayah?: string;
    auto?: string;
  }>();

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: Colors.background }}
      edges={['top']}
    >
      <ReciteView
        surahId={Number(id)}
        initialAyah={ayah ? Number(ayah) : undefined}
        autoStart={auto === '1'}
        showHeader
      />
    </SafeAreaView>
  );
}
