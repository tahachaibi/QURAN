const { withAndroidManifest, withDangerousMod, withProjectBuildGradle } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

function applyManifestFix(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    const application = manifest.application[0];
    if (!application.$) application.$ = {};

    application.$['tools:replace'] = 'android:appComponentFactory';
    application.$['android:appComponentFactory'] = 'androidx.core.app.CoreComponentFactory';

    return config;
  });
}

// Patch the voice library's build.gradle, which declares:
//   implementation "com.android.support:appcompat-v7:${supportVersion}"
// (GString interpolation, NOT a plain literal — our old regex targeted
//  'support-compat' and never matched, so the patch was always skipped)
function applyVoiceLibraryPatch(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const voiceGradle = path.join(
        projectRoot,
        'node_modules',
        '@react-native-voice',
        'voice',
        'android',
        'build.gradle'
      );

      if (!fs.existsSync(voiceGradle)) return config;

      let contents = fs.readFileSync(voiceGradle, 'utf-8');

      // Match both plain-quoted and GString forms of appcompat-v7
      // e.g. "com.android.support:appcompat-v7:${supportVersion}"
      //   or 'com.android.support:appcompat-v7:28.0.0'
      let updated = contents.replace(
        /["']com\.android\.support:appcompat-v7:[^"'\n]*["']/g,
        '"androidx.appcompat:appcompat:1.7.0"'
      );

      if (updated !== contents) {
        fs.writeFileSync(voiceGradle, updated, 'utf-8');
      }

      return config;
    },
  ]);
}

// Belt-and-suspenders: exclude the entire com.android.support group from
// the root android/build.gradle so no transitive dep can sneak it in.
// We use BOTH withProjectBuildGradle (runs at the right time in the pipeline)
// AND withDangerousMod as a fallback fs.write (covers whichever runs last).
function applyRootGradleExclusion(config) {
  const EXCLUSION_BLOCK =
    '\n// Added by ./plugins/withAndroidManifestFix.js — the println marker proves\n' +
    '// in the Gradle log that this project was generated from the fixed source.\n' +
    "println '>>> [quran-habit] FIX ACTIVE: com.android.support globally excluded <<<'\n" +
    'allprojects {\n' +
    '    configurations.all {\n' +
    "        exclude group: 'com.android.support'\n" +
    '    }\n' +
    '}\n';
  const MARKER = "exclude group: 'com.android.support'";

  // Primary path: proper mod API for android/build.gradle
  config = withProjectBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes(MARKER)) {
      config.modResults.contents += EXCLUSION_BLOCK;
    }
    return config;
  });

  // Fallback path: direct fs write (handles timing edge cases)
  config = withDangerousMod(config, [
    'android',
    (config) => {
      const rootGradle = path.join(config.modRequest.platformProjectRoot, 'build.gradle');

      if (!fs.existsSync(rootGradle)) return config;

      let contents = fs.readFileSync(rootGradle, 'utf-8');
      if (!contents.includes(MARKER)) {
        fs.writeFileSync(rootGradle, contents + EXCLUSION_BLOCK, 'utf-8');
      }

      return config;
    },
  ]);

  return config;
}

module.exports = function withAndroidFixes(config) {
  config = applyManifestFix(config);
  config = applyVoiceLibraryPatch(config);
  config = applyRootGradleExclusion(config);
  return config;
};
