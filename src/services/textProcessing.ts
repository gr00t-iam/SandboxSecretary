import type { PolishOptions } from '../types';

const fillerPatterns = [
  /\b(um+|uh+|erm|ah)\b[,\s]*/gi,
  /\b(you know|kind of|sort of|basically|literally|actually)\b[,\s]*/gi,
  /\s+,/g
];

const dictionaries: Record<string, Record<string, string>> = {
  'en:es': {
    hello: 'hola',
    'thank you': 'gracias',
    thanks: 'gracias',
    goodbye: 'adios',
    yes: 'si',
    no: 'no',
    meeting: 'reunion',
    notes: 'notas',
    document: 'documento',
    record: 'grabar',
    translate: 'traducir',
    send: 'enviar',
    draft: 'borrador',
    today: 'hoy',
    tomorrow: 'manana'
  },
  'es:en': {
    hola: 'hello',
    gracias: 'thank you',
    adios: 'goodbye',
    si: 'yes',
    no: 'no',
    reunion: 'meeting',
    notas: 'notes',
    documento: 'document',
    grabar: 'record',
    traducir: 'translate',
    enviar: 'send',
    borrador: 'draft',
    hoy: 'today',
    manana: 'tomorrow'
  },
  'en:fr': {
    hello: 'bonjour',
    'thank you': 'merci',
    goodbye: 'au revoir',
    meeting: 'reunion',
    notes: 'notes',
    document: 'document',
    send: 'envoyer'
  },
  'fr:en': {
    bonjour: 'hello',
    merci: 'thank you',
    'au revoir': 'goodbye',
    reunion: 'meeting',
    notes: 'notes',
    document: 'document',
    envoyer: 'send'
  }
};

export function polishTranscript(rawTranscript: string, options: PolishOptions): string {
  const cleaned = normalizeWhitespace(removeFillers(rawTranscript));
  const sentences = splitSentences(cleaned).map(capitalizeSentence);

  if (sentences.length === 0) {
    return '';
  }

  const conciseSentences = options.concise > 65 ? dedupeAdjacent(sentences) : sentences;

  if (options.structure >= 70 && conciseSentences.length > 1) {
    return conciseSentences.map((sentence) => `- ${sentence}`).join('\n');
  }

  if (options.tone >= 70) {
    return conciseSentences.map((sentence) => softenTone(sentence)).join(' ');
  }

  return conciseSentences.join(' ');
}

export function translateTextOffline(text: string, sourceLang: string, targetLang: string): string {
  if (sourceLang === targetLang) {
    return text;
  }

  const route = `${sourceLang}:${targetLang}`;
  const dictionary = dictionaries[route];
  if (!dictionary) {
    return `[${sourceLang} -> ${targetLang} offline draft] ${text}`;
  }

  let translated = text.toLowerCase();
  const phrases = Object.keys(dictionary).sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    translated = translated.replace(new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi'), dictionary[phrase]);
  }

  return translated;
}

function removeFillers(input: string): string {
  return fillerPatterns.reduce((current, pattern) => current.replace(pattern, ' '), input);
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}

function splitSentences(input: string): string[] {
  return input
    .split(/(?<=[.!?])\s+|\s+(?=first|next|finally|then)\b/gi)
    .map((sentence) => sentence.trim().replace(/[.?!]+$/g, ''))
    .filter(Boolean);
}

function capitalizeSentence(sentence: string): string {
  const trimmed = sentence.trim();
  if (!trimmed) {
    return '';
  }
  return `${trimmed[0].toUpperCase()}${trimmed.slice(1)}.`;
}

function dedupeAdjacent(sentences: string[]): string[] {
  return sentences.filter((sentence, index) => index === 0 || sentence !== sentences[index - 1]);
}

function softenTone(sentence: string): string {
  return sentence
    .replace(/\bneed to\b/gi, 'should')
    .replace(/\bmust\b/gi, 'should')
    .replace(/\bASAP\b/g, 'soon');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Online translation ------------------------------------------------------
// Real, full-sentence translation for any supported language via the free
// MyMemory API (CORS-enabled, no key). Falls back to translateTextOffline when
// the network is unavailable. Text is chunked to respect the per-request limit.

const TRANSLATION_ENDPOINT = 'https://api.mymemory.translated.net/get';
const TRANSLATION_CONTACT = 'sandbox-secretary@users.noreply.github.com';

export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const clean = text.trim();
  if (!clean || sourceLang === targetLang) {
    return text;
  }

  const chunks = chunkText(clean, 480);
  const results: string[] = [];
  for (const chunk of chunks) {
    const params = new URLSearchParams({
      q: chunk,
      langpair: `${sourceLang}|${targetLang}`,
      de: TRANSLATION_CONTACT
    });
    const response = await fetchImpl(`${TRANSLATION_ENDPOINT}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Translation service returned HTTP ${response.status}.`);
    }
    const data = (await response.json()) as {
      responseData?: { translatedText?: string };
      responseStatus?: number | string;
    };
    const status = Number(data?.responseStatus ?? 200);
    const translated = data?.responseData?.translatedText;
    if (status !== 200 || !translated) {
      throw new Error('Translation service was unavailable.');
    }
    results.push(decodeEntities(translated));
  }
  return results.join(' ');
}

function chunkText(text: string, max: number): string[] {
  if (text.length <= max) {
    return [text];
  }
  const parts: string[] = [];
  let current = '';
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (`${current} ${sentence}`.trim().length <= max) {
      current = `${current} ${sentence}`.trim();
      continue;
    }
    if (current) {
      parts.push(current);
      current = '';
    }
    if (sentence.length <= max) {
      current = sentence;
      continue;
    }
    let buffer = '';
    for (const word of sentence.split(/\s+/)) {
      if (`${buffer} ${word}`.trim().length <= max) {
        buffer = `${buffer} ${word}`.trim();
      } else {
        if (buffer) parts.push(buffer);
        buffer = word;
      }
    }
    current = buffer;
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
