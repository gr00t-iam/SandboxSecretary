import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('standalone Sandbox Secretary artifact', () => {
  const html = readFileSync(resolve(process.cwd(), 'sandbox-secretary.html'), 'utf8');

  it('contains the required iOS PWA shell and no incomplete markers', () => {
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">');
    expect(html).toContain('"display":"standalone"');
    expect(html).not.toMatch(/TODO|OMITTED|throw new Error\('Not implemented/i);
  });

  it('defines the single-file module boundaries requested by the architecture', () => {
    [
      'Module 1: Thread-Isolated Audio Core',
      'Module 2: Client-Side Open-Source AI Inference Pipeline',
      'Module 3: Local Ledger Storage',
      'Module 4: Automatic Sync Pipeline',
      'Module 5: iOS Compatibility',
      'Module 6: Responsive Multi-Panel Grid Interface'
    ].forEach((marker) => expect(html).toContain(marker));
  });

  it('ships the local-first browser capabilities in one artifact', () => {
    [
      'SandboxSecretaryDB',
      'documents',
      'glossary',
      'config',
      'createWorkerBlob',
      'applyGlossary',
      'uploadGoogleDriveMultipart',
      'buildGmailComposeUrl',
      'exportActiveToDrive',
      'emailActiveText',
      'navigator.storage.persist',
      'visibilitychange',
      'pagehide',
      'drawMeter'
    ].forEach((marker) => expect(html).toContain(marker));
  });

  it('uses a clean two-view workspace with advanced controls hidden in settings', () => {
    [
      'Workspace View',
      'settingsToggle',
      'App Settings',
      'Your Words',
      'Polished Text',
      'Translation',
      'polishedTabBtn',
      'translationTabBtn',
      'Polish Text',
      'emailBtn',
      'Writing Style Preferences',
      'Word Auto-Correct Glossary',
      'Cloud Accounts & Export destinations',
      'Advanced Engine Diagnostics'
    ].forEach((marker) => expect(html).toContain(marker));

    expect(html).not.toContain('State machine');
    expect(html).not.toContain('Execution log</div>');
    expect(html).not.toContain(['Web', 'DAV'].join(''));
    expect(html).not.toContain(['web', 'dav'].join(''));
  });

  it('persists Drive credentials as a one-time configuration with reset support', () => {
    [
      'saveDriveCredentials',
      'loadDriveCredentials',
      'resetCredentials',
      'authorizeDrive',
      'initTokenClient',
      'accounts.google.com/gsi/client',
      'technician.there@gmail.com',
      '1cfq17rEgFDMehIUd7xDb6ctittwzrkVA',
      '806567057060-152daedbqsjtemq6qa1r3tsq6dpfgj2i.apps.googleusercontent.com',
      'Credentials Saved',
      'Authorize',
      'Reset Credentials'
    ].forEach((marker) => expect(html).toContain(marker));
  });

  it('keeps Japanese translation and speech output locale-aware in the standalone artifact', () => {
    [
      "ja: 'Japanese'",
      "'en:ja'",
      "'ja:en'",
      'こんにちは',
      'speechLocaleFor',
      'chooseSpeechVoice',
      'ja-JP',
      ".normalize('NFC')",
      'No local '
    ].forEach((marker) => expect(html).toContain(marker));
  });

  it('keeps French full-string translation, French TTS, and Google Docs export in the standalone artifact', () => {
    [
      "'en:fr'",
      "'fr:en'",
      "next: 'ensuite'",
      "upload: 'televerser'",
      "fr: 'fr-FR'",
      'application/vnd.google-apps.document',
      'Content-Type: text/html; charset=UTF-8',
      'activeOutputText'
    ].forEach((marker) => expect(html).toContain(marker));

    expect(html).not.toContain('text/markdown');
    expect(html).not.toContain('exportMarkdown');
  });

  it('opens Gmail compose in a new browser tab instead of navigating the PWA with mailto', () => {
    [
      'https://mail.google.com/mail/?view=cm&fs=1',
      "window.open(gmailUrl, '_blank')",
      'encodeURIComponent'
    ].forEach((marker) => expect(html).toContain(marker));

    expect(html).not.toContain('mailto:');
    expect(html).not.toContain('window.location.href');
  });
});
