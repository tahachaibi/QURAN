const { withAndroidManifest, withAppBuildGradle } = require('@expo/config-plugins');

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

function applyGradleExclusions(config) {
  return withAppBuildGradle(config, (config) => {
    const { contents } = config.modResults;

    if (contents.includes("exclude group: 'com.android.support'")) {
      return config;
    }

    // Exclude the old support library from every dependency tree.
    // Jetifier (enabled via expo-build-properties) rewrites voice library bytecode
    // to reference AndroidX, so the old library is no longer needed at runtime.
    config.modResults.contents = contents.replace(
      /^android \{/m,
      `configurations.all {
    exclude group: 'com.android.support', module: 'support-compat'
    exclude group: 'com.android.support', module: 'versionedparcelable'
    exclude group: 'com.android.support', module: 'animated-vector-drawable'
    exclude group: 'com.android.support', module: 'support-vector-drawable'
}

android {`
    );

    return config;
  });
}

module.exports = function withAndroidFixes(config) {
  config = applyManifestFix(config);
  config = applyGradleExclusions(config);
  return config;
};
