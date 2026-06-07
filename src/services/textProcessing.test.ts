import { describe, expect, it } from 'vitest';
import { polishTranscript, translateTextOffline } from './textProcessing';

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
    const result = translateTextOffline('specialized vocabulary', 'en', 'ja');
    expect(result).toBe('[en -> ja offline draft] specialized vocabulary');
  });
});
