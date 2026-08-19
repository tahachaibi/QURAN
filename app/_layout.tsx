import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { AmiriQuran_400Regular } from '@expo-google-fonts/amiri-quran';
import { Amiri_400Regular, Amiri_700Bold } from '@expo-google-fonts/amiri';

export default function RootLayout() {
  // Quranic typography: AmiriQuran for ayah text, Amiri for Arabic titles.
  // On failure we render anyway — system fonts are the fallback.
  const [fontsLoaded, fontError] = useFonts({
    AmiriQuran_400Regular,
    Amiri_400Regular,
    Amiri_700Bold,
  });

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="surah/[id]" />
        <Stack.Screen name="recite/[id]" />
      </Stack>
    </SafeAreaProvider>
  );
}
