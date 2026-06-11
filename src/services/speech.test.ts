import { describe, expect, it } from 'vitest';
import { chooseSpeechVoice, resolveSpeechLocale } from './speech';

describe('speech locale selection', () => {
  it('uses ja-JP when the selected language is Japanese', () => {
    expect(resolveSpeechLocale('ja', 'こんにちは')).toBe('ja-JP');
  });

  it('detects Japanese script even when the language argument is stale', () => {
    expect(resolveSpeechLocale('en', '明日の会議')).toBe('ja-JP');
  });

  it('uses Spanish and German locales for local speech playback', () => {
    expect(resolveSpeechLocale('es', 'Hola, gracias.')).toBe('es-ES');
    expect(resolveSpeechLocale('de', 'Guten Morgen.')).toBe('de-DE');
  });

  it('uses the French locale for French translation playback', () => {
    expect(resolveSpeechLocale('fr', 'Bonjour, merci.')).toBe('fr-FR');
  });

  it('prefers a local exact Japanese voice over a default voice', () => {
    const voice = chooseSpeechVoice(
      [
        { lang: 'en-US', name: 'English', localService: true },
        { lang: 'ja-JP', name: 'Japanese Cloud', localService: false },
        { lang: 'ja-JP', name: 'Japanese Local', localService: true }
      ],
      'ja-JP'
    );

    expect(voice?.name).toBe('Japanese Local');
  });
});
