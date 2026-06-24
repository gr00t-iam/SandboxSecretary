import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('React workspace artifact', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/ui/App.tsx'), 'utf8');
  const sync = readFileSync(resolve(process.cwd(), 'src/services/sync.ts'), 'utf8');
  const styles = readFileSync(resolve(process.cwd(), 'src/ui/styles.css'), 'utf8');

  it('keeps the GitHub Pages entry on the clean two-view workspace', () => {
    [
      'Workspace View',
      'HelpView',
      'SettingsView',
      'Start Dictation',
      'Your Words',
      'Polished Text',
      'Translation',
      'activeOutputTab',
      'emailActiveText',
      'buildGmailComposeHref',
      "window.open(gmailUrl, '_blank')",
      'application/vnd.google-apps.document',
      "key: 'k8s', value: 'Kubernetes'",
      'App Settings',
      'Cloud Accounts & Export destinations',
      'Advanced Engine Diagnostics'
    ].forEach((marker) => expect(app).toContain(marker));

    expect(app).not.toContain('State machine');
    expect(app).not.toContain('WASM/WebGPU worker');
    expect(app).not.toContain('Local-first dictation desk');
    expect(app).not.toContain('mailto:');
    expect(app).not.toContain('window.location.href');
    expect(app).not.toContain(['Web', 'DAV'].join(''));
    expect(app).not.toContain(`Email (${['mail', 'to'].join('')}:)`);
    expect(app).toContain('<span>Email</span>');
    expect(sync).toContain('mail.google.com/mail/?');
    expect(sync).toContain("view: 'cm'");
    expect(sync).toContain("body: `${document.polished_text}");
    expect(styles).toContain('.destination-status.email-status');
  });

  it('uses the warm iOS-style shell instead of the old three-column dashboard', () => {
    ['secretary-shell', 'workspace-view', 'hero-dictation', 'settings-drawer', 'help-view', 'action-bar'].forEach((marker) =>
      expect(styles).toContain(marker)
    );
    expect(styles).not.toContain('grid-template-columns: minmax(220px, 270px) minmax(430px, 1fr) minmax(280px, 340px)');
  });
});
