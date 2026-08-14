/**
 * Patches @react-native-voice/voice v3 android/build.gradle to replace
 * the legacy com.android.support:appcompat-v7 declaration (which transitively
 * pulls in support-compat:28.0.0) with the AndroidX equivalent.
 *
 * This runs via the npm postinstall hook, before expo prebuild, so the
 * patched file is what Gradle sees when the Android project is built.
 */

const fs = require('fs');
const path = require('path');

const voiceGradle = path.resolve(
  __dirname,
  '..',
  'node_modules',
  '@react-native-voice',
  'voice',
  'android',
  'build.gradle'
);

if (!fs.existsSync(voiceGradle)) {
  console.log('[patch-voice] voice library not found at expected path, skipping');
  process.exit(0);
}

const original = fs.readFileSync(voiceGradle, 'utf-8');

// Matches both quoted literals and Groovy GString forms:
//   'com.android.support:appcompat-v7:28.0.0'
//   "com.android.support:appcompat-v7:${supportVersion}"
const patched = original.replace(
  /["']com\.android\.support:appcompat-v7:[^"'\n]*["']/g,
  '"androidx.appcompat:appcompat:1.7.0"'
);

if (patched === original) {
  console.log('[patch-voice] already patched or pattern not found, no changes made');
} else {
  fs.writeFileSync(voiceGradle, patched, 'utf-8');
  console.log('[patch-voice] replaced com.android.support:appcompat-v7 with androidx.appcompat:appcompat:1.7.0');
}

// Fail fast if the legacy support library is still referenced — better to stop
// the build here with a clear message than fail 3 minutes into Gradle with
// duplicate class errors.
const finalContents = fs.readFileSync(voiceGradle, 'utf-8');
if (finalContents.includes('com.android.support')) {
  console.error('[patch-voice] ERROR: build.gradle still references com.android.support — patch did not apply!');
  process.exit(1);
}
console.log('[patch-voice] verified: no com.android.support references remain');
