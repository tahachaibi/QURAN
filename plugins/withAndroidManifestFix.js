const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
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

    // Resolve android:appComponentFactory conflict between com.android.support and AndroidX
    application.$['tools:replace'] = 'android:appComponentFactory';
    application.$['android:appComponentFactory'] = 'androidx.core.app.CoreComponentFactory';

    return config;
  });
}

function applyGradlePatches(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const androidRoot = config.modRequest.platformProjectRoot;

      // ── Patch 1: voice library ─────────────────────────────────────────────
      // @react-native-voice/voice v3 declares com.android.support:support-compat:28
      // in its own build.gradle.  androidx.core:core:1.13.1 ships the same
      // android.support.v4.* shim classes, so the voice library's Java sources
      // still compile after the swap — and support-compat-28 is removed from
      // the APK classpath, eliminating the duplicate-class conflict.
      const voiceGradle = path.join(
        projectRoot,
        'node_modules',
        '@react-native-voice',
        'voice',
        'android',
        'build.gradle'
      );

      if (fs.existsSync(voiceGradle)) {
        let contents = fs.readFileSync(voiceGradle, 'utf-8');
        if (contents.includes('com.android.support:support-compat')) {
          contents = contents.replace(
            /(['"])com\.android\.support:support-compat:[^'"]+\1/g,
            "'androidx.core:core:1.13.1'"
          );
          fs.writeFileSync(voiceGradle, contents, 'utf-8');
        }
      }

      // ── Patch 2: root android/build.gradle safety net ─────────────────────
      // Belt-and-suspenders: if any other transitive dep pulls in com.android.support
      // artifacts, exclude them at the allprojects level too.
      const rootGradle = path.join(androidRoot, 'build.gradle');

      if (fs.existsSync(rootGradle)) {
        let contents = fs.readFileSync(rootGradle, 'utf-8');
        if (!contents.includes("exclude group: 'com.android.support'")) {
          contents +=
            '\nallprojects {\n' +
            '    configurations.all {\n' +
            "        exclude group: 'com.android.support', module: 'support-compat'\n" +
            "        exclude group: 'com.android.support', module: 'versionedparcelable'\n" +
            "        exclude group: 'com.android.support', module: 'animated-vector-drawable'\n" +
            "        exclude group: 'com.android.support', module: 'support-vector-drawable'\n" +
            '    }\n' +
            '}\n';
          fs.writeFileSync(rootGradle, contents, 'utf-8');
        }
      }

      return config;
    },
  ]);
}

module.exports = function withAndroidFixes(config) {
  config = applyManifestFix(config);
  config = applyGradlePatches(config);
  return config;
};
