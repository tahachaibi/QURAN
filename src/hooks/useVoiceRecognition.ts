import { useState, useEffect } from 'react';
import Voice from '@react-native-voice/voice';

export function useVoiceRecognition() {
  const [isListening, setIsListening] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Voice.onSpeechResults = (e: any) => {
      setResult(e.value?.[0] ?? null);
      setIsListening(false);
    };

    Voice.onSpeechError = (e: any) => {
      const code = String(e.error?.code ?? '');
      // Code 7 = "no match" — user just didn't speak, not a real error
      if (!code.startsWith('7')) {
        setError(e.error?.message ?? 'Recognition failed');
      }
      setIsListening(false);
    };

    Voice.onSpeechEnd = () => {
      setIsListening(false);
    };

    return () => {
      Voice.destroy().then(() => Voice.removeAllListeners()).catch(() => {});
    };
  }, []);

  async function startListening() {
    setResult(null);
    setError(null);
    setIsListening(true);
    try {
      await Voice.start('ar-SA');
    } catch {
      setIsListening(false);
      setError('Could not start microphone');
    }
  }

  function clearResult() {
    setResult(null);
    setError(null);
  }

  return { isListening, result, error, startListening, clearResult };
}
