import { describe, expect, it } from 'vitest';
import { polishTranscript, translateText, translateTextOffline } from './textProcessing';

describe('polishTranscript', () => {
  it('removes filler words and keeps original intent', () => {
    const result = polishTranscript(
      'um I need to send the budget notes, you know, and then follow up with design.',
      { concise: 70, structure: 60, tone: 40 }
    );

    expect(result).not.toMatch(/\bum\b|\byou know\b/i);
    expect(result).toContain('send the budget notes');
    expect(result).toContain('follow up with design');
  });

  it('structures multi-sentence content as markdown when structure is high', () => {
    const result = polishTranscript(
      'first capture the meeting summary. next translate the customer quote. finally queue the drive upload.',
      { concise: 30, structure: 90, tone: 30 }
    );

    expect(result).toContain('- First capture the meeting summary.');
    expect(result).toContain('- Next translate the customer quote.');
    expect(result).toContain('- Finally queue the drive upload.');
  });
});

describe('translateTextOffline', () => {
  it('uses deterministic offline phrase translation for common UI dictation text', () => {
    const result = translateTextOffline('hello thank you goodbye', 'en', 'es');
    expect(result).toBe('hola gracias adios');
  });

  it('returns source text with a local marker when no dictionary route exists', () => {
    const result = translateTextOffline('specialized vocabulary', 'en', 'de');
    expect(result).toBe('[en -> de offline draft] specialized vocabulary');
  });

  it('keeps Japanese translation as UTF-8 text for Japanese TTS', () => {
    const result = translateTextOffline('hello thank you goodbye upload document', 'en', 'ja');
    expect(result).toContain('こんにちは');
    expect(result).toContain('ありがとう');
    expect(result).toContain('アップロード');
    expect(result).toContain('文書');
  });

  it('translates Japanese source phrases without requiring word boundaries', () => {
    const result = translateTextOffline('こんにちはありがとう文書', 'ja', 'en');
    expect(result).toBe('hellothank youdocument');
  });

  it('translates full common dictated strings into French instead of only the first word', () => {
    const result = translateTextOffline('hello thank you. next upload the document tomorrow', 'en', 'fr');
    expect(result).toContain('bonjour');
    expect(result).toContain('merci');
    expect(result).toContain('ensuite');
    expect(result).toContain('televerser');
    expect(result).toContain('le document');
    expect(result).toContain('demain');
    expect(result).not.toMatch(/\bhello\b|\bthank you\b|\bnext\b|\bupload\b|\btomorrow\b/i);
  });
});

describe('translateText', () => {
  it('sends complete chunks and combines complete French responses', async () => {
    const fetchImpl = async (url: string | URL | Request): Promise<Response> => {
      const requestUrl = new URL(String(url));
      const sourceText = requestUrl.searchParams.get('q') ?? '';
      expect(sourceText).toContain('Hello team');
      expect(sourceText).toContain('upload the document tomorrow');
      return new Response(
        JSON.stringify({
          responseStatus: 200,
          responseData: { translatedText: 'Bonjour equipe. Veuillez televerser le document demain.' }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const result = await translateText('Hello team. Please upload the document tomorrow.', 'en', 'fr', fetchImpl);
    expect(result).toBe('Bonjour equipe. Veuillez televerser le document demain.');
  });
});
