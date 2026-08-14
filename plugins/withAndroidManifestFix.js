const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withAndroidManifestFix(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // Add tools namespace so we can use tools:replace
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    const application = manifest.application[0];
    if (!application.$) application.$ = {};

    // Fix conflict between com.android.support and androidx brought in by @react-native-voice/voice
    application.$['tools:replace'] = 'android:appComponentFactory';

    return config;
  });
};
