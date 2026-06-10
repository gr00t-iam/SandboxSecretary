const languageLocales: Record<string, string> = {
  de: 'de-DE',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  ja: 'ja-JP'
};

export interface SpeechResult {
  spoken: boolean;
  warning?: string;
}

export function resolveSpeechLocale(language: string, text: string): string {
  if (containsJapaneseScript(text)) {
    return 'ja-JP';
  }
  return languageLocales[language] ?? language;
}

export function chooseSpeechVoice(
  voices: Array<Pick<SpeechSynthesisVoice, 'lang' | 'name' | 'localService'>>,
  locale: string
): Pick<SpeechSynthesisVoice, 'lang' | 'name' | 'localService'> | undefined {
  const normalizedLocale = locale.toLowerCase();
  const language = normalizedLocale.split('-')[0];
  return (
    voices.find((voice) => voice.lang.toLowerCase() === normalizedLocale && voice.localService) ??
    voices.find((voice) => voice.lang.toLowerCase() === normalizedLocale) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(`${language}-`) && voice.localService) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(`${language}-`))
  );
}

export async function speakTextWithLocale(text: string, language: string): Promise<SpeechResult> {
  const normalizedText = text.normalize('NFC').trim();
  if (!normalizedText) {
    return { spoken: false, warning: 'Add words before reading aloud.' };
  }
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
    return { spoken: false, warning: 'Speech playback is unavailable in this browser.' };
  }

  const locale = resolveSpeechLocale(language, normalizedText);
  const voices = await loadSpeechVoices();
  const voice = chooseSpeechVoice(voices, locale);
  const utterance = new SpeechSynthesisUtterance(normalizedText);
  utterance.lang = locale;
  if (voice) {
    utterance.voice = voice as SpeechSynthesisVoice;
  }

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);

  if (!voice && locale.toLowerCase().startsWith('ja')) {
    return {
      spoken: true,
      warning: 'No local Japanese voice is installed. The browser default voice was used with ja-JP.'
    };
  }
  return { spoken: true };
}

function containsJapaneseScript(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u.test(text);
}

function loadSpeechVoices(): Promise<SpeechSynthesisVoice[]> {
  const immediate = window.speechSynthesis.getVoices();
  if (immediate.length > 0) {
    return Promise.resolve(immediate);
  }

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.speechSynthesis.onvoiceschanged = null;
      resolve(window.speechSynthesis.getVoices());
    }, 750);

    window.speechSynthesis.onvoiceschanged = () => {
      window.clearTimeout(timeout);
      window.speechSynthesis.onvoiceschanged = null;
      resolve(window.speechSynthesis.getVoices());
    };
  });
}
