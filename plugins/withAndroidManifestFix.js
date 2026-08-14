const { withAndroidManifest, withProjectBuildGradle } = require('@expo/config-plugins');

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

// Appends an allprojects block to the ROOT android/build.gradle so the exclusion
// applies to every Gradle module, including :react-native-voice_voice whose POM
// still pulls in com.android.support:support-compat:28.0.0.
// Jetifier (enabled via expo-build-properties) rewrites the voice library bytecode
// to reference AndroidX, so the old support library is not needed at runtime.
function applyGradleExclusions(config) {
  return withProjectBuildGradle(config, (config) => {
    const { contents } = config.modResults;

    if (contents.includes("exclude group: 'com.android.support'")) {
      return config;
    }

    config.modResults.contents = contents + `

allprojects {
    configurations.all {
        exclude group: 'com.android.support', module: 'support-compat'
        exclude group: 'com.android.support', module: 'versionedparcelable'
        exclude group: 'com.android.support', module: 'animated-vector-drawable'
        exclude group: 'com.android.support', module: 'support-vector-drawable'
    }
}
`;
    return config;
  });
}

module.exports = function withAndroidFixes(config) {
  config = applyManifestFix(config);
  config = applyGradleExclusions(config);
  return config;
};
