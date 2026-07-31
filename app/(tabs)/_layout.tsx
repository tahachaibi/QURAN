import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/constants/theme';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(name: IoniconsName) {
  return ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} size={size} color={color} />
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Prayer', tabBarIcon: tabIcon('moon') }}
      />
      <Tabs.Screen
        name="quran"
        options={{ title: 'Quran', tabBarIcon: tabIcon('book') }}
      />
      <Tabs.Screen
        name="tracker"
        options={{ title: 'Tracker', tabBarIcon: tabIcon('flame') }}
      />
    </Tabs>
  );
}
