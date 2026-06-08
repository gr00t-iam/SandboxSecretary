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
      'uploadWebDav',
      'buildMailto',
      'exportMarkdown',
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
      'Polish Text',
      'Writing Style Preferences',
      'Word Auto-Correct Glossary',
      'Cloud Accounts & Export destinations',
      'Advanced Engine Diagnostics'
    ].forEach((marker) => expect(html).toContain(marker));

    expect(html).not.toContain('State machine');
    expect(html).not.toContain('Execution log</div>');
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
});
