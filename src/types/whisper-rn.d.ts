// Type shims for whisper.rn file-path imports (see useLocalWhisperSession).
// The package's "exports" map lacks a bare "." entry and Expo SDK 52's Metro
// ignores the map entirely, so runtime imports use lib/module file paths;
// these declarations point TypeScript at the matching declaration files.
declare module 'whisper.rn/lib/module/index' {
  export * from 'whisper.rn/lib/typescript/index';
}
declare module 'whisper.rn/lib/module/realtime-transcription/index' {
  export * from 'whisper.rn/lib/typescript/realtime-transcription/index';
}
declare module 'whisper.rn/lib/module/realtime-transcription/adapters/AudioPcmStreamAdapter' {
  export * from 'whisper.rn/lib/typescript/realtime-transcription/adapters/AudioPcmStreamAdapter';
}
