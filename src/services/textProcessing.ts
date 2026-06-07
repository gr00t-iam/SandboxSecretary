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
