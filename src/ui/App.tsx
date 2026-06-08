import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Cloud,
  FolderUp,
  Gauge,
  Globe2,
  HelpCircle,
  Leaf,
  Mail,
  Mic,
  Pause,
  Play,
  Save,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UploadCloud,
  Volume2,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CacheMetrics, ModelState, PolishOptions, SecretaryDocument, SyncDestination } from '../types';
import { AiWorkerClient } from '../services/aiWorkerClient';
import { AudioPipeline } from '../services/audioPipeline';
import { createDriveAuthorizationUrl, exchangeDriveAuthorizationCode, readAuthorizationCodeFromLocation } from '../services/oauth';
import { registerServiceWorker, subscribeToNetworkStatus } from '../services/pwa';
import {
  DEFAULT_DRIVE_CLIENT_ID,
  DEFAULT_DRIVE_FOLDER_ID,
  DEFAULT_EMAIL_RECIPIENT,
  type DriveCredentials,
  withDefaultDriveCredentials
} from '../services/defaultConfig';
import { SecretaryStorage } from '../services/storage';
import { SyncManager } from '../services/sync';
import { polishTranscript, translateTextOffline } from '../services/textProcessing';

const storage = new SecretaryStorage();
const defaultMetrics: CacheMetrics = { documents: 0, pending: 0, failed: 0, synced: 0 };
const languageOptions = [
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['ja', 'Japanese']
] as const;
const waveformBars = Array.from({ length: 48 }, (_, index) => index);
const defaultGlossaryTerms: GlossaryTerm[] = [{ key: 'k8s', value: 'Kubernetes' }];

interface GlossaryTerm {
  key: string;
  value: string;
}

export function App(): JSX.Element {
  const [documents, setDocuments] = useState<SecretaryDocument[]>([]);
  const [metrics, setMetrics] = useState<CacheMetrics>(defaultMetrics);
  const [online, setOnline] = useState(navigator.onLine);
  const [state, setState] = useState<ModelState>('model-initializing');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const [rawText, setRawText] = useState('');
  const [polishedText, setPolishedText] = useState('');
  const [translatedText, setTranslatedText] = useState('');

  const [sourceLang, setSourceLang] = useState('en');
  const [targetLang, setTargetLang] = useState('es');
  const [destinationType, setDestinationType] = useState<SyncDestination['type']>('email');
  const [recipient, setRecipient] = useState(DEFAULT_EMAIL_RECIPIENT);
  const [driveFolder, setDriveFolder] = useState(DEFAULT_DRIVE_FOLDER_ID);
  const [driveClientId, setDriveClientId] = useState(DEFAULT_DRIVE_CLIENT_ID);
  const [driveAccessToken, setDriveAccessToken] = useState('');
  const [polishOptions, setPolishOptions] = useState<PolishOptions>({ concise: 55, structure: 80, tone: 45 });
  const [glossaryKey, setGlossaryKey] = useState('');
  const [glossaryValue, setGlossaryValue] = useState('');
  const [glossaryTerms, setGlossaryTerms] = useState<GlossaryTerm[]>([]);

  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();

  const aiClient = useRef<AiWorkerClient>();
  const audioController = useRef<AudioPipeline>();
  const syncManager = useMemo(
    () =>
      new SyncManager(storage, {
        isOnline: () => navigator.onLine,
        openMailto: (href) => {
          window.location.href = href;
        },
        getDriveCredentials: async () => storage.getConfig<DriveCredentials>('driveCredentials')
      }),
    []
  );

  useEffect(() => {
    aiClient.current = new AiWorkerClient(
      (nextState) => setState(nextState as ModelState),
      (warning) => setWarnings((current) => [...current.slice(-2), warning])
    );
    aiClient.current.initialize();

    registerServiceWorker(() => flushSyncQueue()).catch((error) => addWarning(error));
    const unsubscribe = subscribeToNetworkStatus((isOnline) => {
      setOnline(isOnline);
      if (isOnline) flushSyncQueue();
    });

    refreshDocuments();
    loadExportConfiguration().catch((error) => addWarning(error));
    loadGlossaryTerms().catch((error) => addWarning(error));

    return () => {
      unsubscribe();
      aiClient.current?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        toggleRecording();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveCurrentDocument();
      }
      if (event.key === 'Escape') {
        setSettingsOpen(false);
        setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  async function refreshDocuments(): Promise<void> {
    const [nextDocuments, nextMetrics] = await Promise.all([storage.listDocuments(), storage.getMetrics()]);
    setDocuments(nextDocuments);
    setMetrics(nextMetrics);
  }

  async function loadExportConfiguration(): Promise<void> {
    const saved = withDefaultDriveCredentials(await storage.getConfig<DriveCredentials>('driveCredentials'));
    setDriveFolder(saved.folderId);
    setDriveClientId(saved.clientId);
    setDriveAccessToken(saved.accessToken ?? '');
    setRecipient((current) => current.trim() || DEFAULT_EMAIL_RECIPIENT);

    await completeDriveOAuthIfPresent(saved);
  }

  async function loadGlossaryTerms(): Promise<void> {
    const saved = await storage.getConfig<GlossaryTerm[]>('glossaryTerms');
    setGlossaryTerms(Array.isArray(saved) ? saved : defaultGlossaryTerms);
  }

  async function completeDriveOAuthIfPresent(credentials: DriveCredentials): Promise<void> {
    const code = readAuthorizationCodeFromLocation();
    if (!code || !credentials.clientId) return;
    try {
      const token = await exchangeDriveAuthorizationCode(code, {
        clientId: credentials.clientId,
        redirectUri: window.location.origin + window.location.pathname
      });
      const nextCredentials = { ...credentials, accessToken: token };
      await storage.putConfig('driveCredentials', nextCredentials);
      setDriveAccessToken(token);
      window.history.replaceState({}, document.title, window.location.pathname);
      setWarnings((current) => [...current.slice(-2), 'Google Drive authorization saved locally.']);
    } catch (error) {
      addWarning(error);
    }
  }

  async function toggleRecording(): Promise<void> {
    if (recording) {
      await stopRecording();
      return;
    }
    await startRecording();
  }

  async function startRecording(): Promise<void> {
    try {
      audioController.current = new AudioPipeline((text) => {
        setRawText(text);
      }, setLevel);

      await audioController.current.initialize();
      await audioController.current.startRecording();

      setRecording(true);
      setState('recording-active');
    } catch (error) {
      addWarning(`Microphone Error: ${error instanceof Error ? error.message : String(error)}`);
      setState('system-ready');
    }
  }

  async function stopRecording(): Promise<void> {
    try {
      await audioController.current?.stopRecording();

      setRecording(false);
      setLevel(0);
      setState('processing-local-polish');
      setWarnings((current) => [...current.slice(-2), 'Audio captured locally.']);

      await runPolish(rawText);
    } catch (error) {
      addWarning(`Stop Recording Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function runPolish(text = rawText): Promise<void> {
    const preparedText = applyGlossary(text);
    setState('processing-local-polish');
    const fallback = polishTranscript(preparedText, polishOptions);
    const polished = aiClient.current?.isReady() ? await aiClient.current.polish(preparedText, polishOptions) : fallback;
    setPolishedText(polished || fallback);
    setTranslatedText('');
    setState('system-ready');
  }

  async function runTranslate(text = polishedText || rawText): Promise<void> {
    const preparedText = applyGlossary(text);
    const fallback = translateTextOffline(preparedText, sourceLang, targetLang);
    const translated = aiClient.current?.isReady() ? await aiClient.current.translate(preparedText, sourceLang, targetLang) : fallback;
    setTranslatedText(translated || fallback);
  }

  async function saveCurrentDocument(): Promise<void> {
    const effectiveDrive = withDefaultDriveCredentials({
      folderId: driveFolder,
      clientId: driveClientId,
      accessToken: driveAccessToken
    });
    const destination: SyncDestination =
      destinationType === 'email'
        ? { type: 'email', path_or_recipient: recipient.trim() || DEFAULT_EMAIL_RECIPIENT }
        : { type: 'gdrive', path_or_recipient: effectiveDrive.folderId, accessToken: effectiveDrive.accessToken };

    const title = buildTitle(polishedText || rawText);
    const document = await storage.saveDocument({
      raw_transcript: rawText,
      polished_text: translatedText || polishedText || rawText,
      source_lang: sourceLang,
      target_lang: targetLang,
      sync_status: 'pending',
      sync_destination: destination,
      title
    });

    setSelectedId(document.id);
    setState('sync-pending');
    await refreshDocuments();
    if (online) await flushSyncQueue();
  }

  async function flushSyncQueue(): Promise<void> {
    const result = await syncManager.flushPending();
    if (result.failed > 0) {
      addWarning(`Sync completed with ${result.failed} failed item(s).`);
    }
    await refreshDocuments();
    setState(navigator.onLine ? 'system-ready' : 'offline');
  }

  async function authorizeDrive(): Promise<void> {
    const credentials = withDefaultDriveCredentials({
      folderId: driveFolder,
      clientId: driveClientId,
      accessToken: driveAccessToken
    });
    if (!credentials.clientId.trim()) {
      addWarning('Enter a browser OAuth client ID before authorizing Drive.');
      return;
    }
    await storage.putConfig('driveCredentials', credentials);
    setDriveFolder(credentials.folderId);
    setDriveClientId(credentials.clientId);
    const url = await createDriveAuthorizationUrl({
      clientId: credentials.clientId,
      redirectUri: window.location.origin + window.location.pathname
    });
    window.location.href = url;
  }

  async function resetDriveCredentials(): Promise<void> {
    await storage.deleteConfig('driveCredentials');
    setDriveFolder(DEFAULT_DRIVE_FOLDER_ID);
    setDriveClientId(DEFAULT_DRIVE_CLIENT_ID);
    setDriveAccessToken('');
    setWarnings((current) => [...current.slice(-2), 'Drive token reset. Built-in folder and client ID remain ready.']);
  }

  async function addGlossaryTerm(): Promise<void> {
    const key = glossaryKey.trim();
    const value = glossaryValue.trim();
    if (!key || !value) return;
    const next = [...glossaryTerms.filter((term) => term.key.toLowerCase() !== key.toLowerCase()), { key, value }];
    setGlossaryTerms(next);
    setGlossaryKey('');
    setGlossaryValue('');
    await storage.putConfig('glossaryTerms', next);
  }

  async function removeGlossaryTerm(key: string): Promise<void> {
    const next = glossaryTerms.filter((term) => term.key !== key);
    setGlossaryTerms(next);
    await storage.putConfig('glossaryTerms', next);
  }

  function selectDocument(document: SecretaryDocument): void {
    setSelectedId(document.id);
    setRawText(document.raw_transcript);
    setPolishedText(document.polished_text);
    setTranslatedText('');
    setSourceLang(document.source_lang);
    setTargetLang(document.target_lang);
    setDestinationType(document.sync_destination.type);
  }

  function addWarning(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    setWarnings((current) => [...current.slice(-2), message]);
    setState('resource-restricted');
  }

  function applyGlossary(text: string): string {
    return glossaryTerms.reduce((output, term) => {
      const escaped = term.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return output.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), term.value);
    }, text);
  }

  const outputText = translatedText || polishedText;
  const wordCount = countWords(rawText);
  const outputWordCount = countWords(outputText);
  const status = friendlyStatus(state, online, recording);
  const driveConnected = Boolean(driveAccessToken);

  return (
    <main className="secretary-shell">
      <section className="workspace-view" aria-label="Workspace View">
        <header className="workspace-header">
          <button className="icon-button" type="button" aria-label="Open help" onClick={() => setHelpOpen(true)}>
            <HelpCircle size={22} />
          </button>
          <div className="workspace-title">
            <h1>Sandbox Secretary</h1>
            <span className={`friendly-status ${status === 'Offline Mode' ? 'offline' : ''}`}>
              <span />
              {status}
            </span>
          </div>
          <button className="icon-button" type="button" aria-label="Open settings" onClick={() => setSettingsOpen(true)}>
            <Settings size={22} />
          </button>
        </header>

        <section className="hero-dictation" aria-label="Dictation controls">
          <button className={`hero-mic ${recording ? 'recording' : ''}`} type="button" onClick={toggleRecording}>
            {recording ? <Pause size={54} /> : <Mic size={58} />}
          </button>
          <div className="dictation-copy">
            <h2>{recording ? 'Recording' : 'Start Dictation'}</h2>
            <p>{recording ? 'Tap to pause and polish your words' : 'Tap to start speaking'}</p>
          </div>
          <div className="waveform" aria-label="Audio waveform">
            {waveformBars.map((bar) => (
              <span
                key={bar}
                style={{
                  height: `${Math.max(14, 18 + Math.sin(bar * 0.7) * 14 + level * 72)}px`
                }}
              />
            ))}
          </div>
        </section>

        <section className="text-grid" aria-label="Composition workspace">
          <label className="text-card">
            <span className="card-title">
              Your Words <small>{wordCount} words</small>
            </span>
            <textarea
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              placeholder="Start speaking or type here..."
            />
          </label>
          <label className="text-card output-card">
            <span className="card-title">
              Polished Text <Sparkles size={16} /> <small>{outputWordCount} words</small>
            </span>
            <textarea
              value={outputText}
              onChange={(event) => {
                setTranslatedText('');
                setPolishedText(event.target.value);
              }}
              placeholder="Your polished text will appear here."
            />
            <button className="listen-button" type="button" onClick={() => speakText(outputText)}>
              <Volume2 size={18} /> Read Aloud
            </button>
          </label>
        </section>

        <section className="language-row" aria-label="Language selection">
          <Select label="Source Language" value={sourceLang} onChange={setSourceLang} />
          <Globe2 className="swap-mark" size={24} />
          <Select label="Target Language" value={targetLang} onChange={setTargetLang} />
        </section>

        <nav className="action-bar" aria-label="Primary actions">
          <button className="polish-action" type="button" onClick={() => runPolish()}>
            <Sparkles size={18} /> Polish Text
          </button>
          <button className="translate-action" type="button" onClick={() => runTranslate()}>
            <Globe2 size={18} /> Translate
          </button>
          <button className="export-action" type="button" onClick={saveCurrentDocument}>
            <UploadCloud size={18} /> Export
          </button>
        </nav>
      </section>

      {helpOpen ? <HelpView onClose={() => setHelpOpen(false)} /> : null}

      <SettingsView
        connected={driveConnected}
        destinationType={destinationType}
        documents={documents}
        driveAccessToken={driveAccessToken}
        driveClientId={driveClientId}
        driveFolder={driveFolder}
        glossaryKey={glossaryKey}
        glossaryTerms={glossaryTerms}
        glossaryValue={glossaryValue}
        metrics={metrics}
        online={online}
        polishOptions={polishOptions}
        recipient={recipient}
        selectedId={selectedId}
        warnings={warnings}
        onAddGlossary={addGlossaryTerm}
        onAuthorizeDrive={authorizeDrive}
        onClose={() => setSettingsOpen(false)}
        onFlush={flushSyncQueue}
        onRemoveGlossary={removeGlossaryTerm}
        onResetDrive={resetDriveCredentials}
        onSave={saveCurrentDocument}
        onSelectDestination={setDestinationType}
        onSelectDocument={selectDocument}
        open={settingsOpen}
        setDriveClientId={setDriveClientId}
        setDriveFolder={setDriveFolder}
        setDriveAccessToken={setDriveAccessToken}
        setGlossaryKey={setGlossaryKey}
        setGlossaryValue={setGlossaryValue}
        setPolishOptions={setPolishOptions}
        setRecipient={setRecipient}
      />
    </main>
  );
}

function HelpView({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <aside className="help-view" aria-label="Help page">
      <button className="icon-button close-help" type="button" aria-label="Close help" onClick={onClose}>
        <X size={22} />
      </button>
      <div className="help-brand">
        <div className="help-mark">
          <Mic size={54} />
        </div>
        <h2>
          Sandbox
          <br />
          <span>Secretary</span>
        </h2>
        <p>Speak. Polish. Translate. All offline. All yours.</p>
      </div>
      <div className="help-list">
        <HelpItem icon={<ShieldCheck size={28} />} title="100% Private" text="Everything stays on your device." />
        <HelpItem icon={<Leaf size={28} />} title="Works Offline" text="No internet? No problem." />
        <HelpItem icon={<Sparkles size={28} />} title="Instant Results" text="Real-time dictation, polish & translate." />
        <HelpItem icon={<Cloud size={28} />} title="Export Anywhere" text="Email, Drive, WebDAV or local file." />
      </div>
    </aside>
  );
}

function HelpItem({ icon, title, text }: { icon: JSX.Element; title: string; text: string }): JSX.Element {
  return (
    <div className="help-item">
      <div>{icon}</div>
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
    </div>
  );
}

interface SettingsViewProps {
  connected: boolean;
  destinationType: SyncDestination['type'];
  documents: SecretaryDocument[];
  driveAccessToken: string;
  driveClientId: string;
  driveFolder: string;
  glossaryKey: string;
  glossaryTerms: GlossaryTerm[];
  glossaryValue: string;
  metrics: CacheMetrics;
  online: boolean;
  open: boolean;
  polishOptions: PolishOptions;
  recipient: string;
  selectedId?: string;
  warnings: string[];
  onAddGlossary: () => Promise<void>;
  onAuthorizeDrive: () => Promise<void>;
  onClose: () => void;
  onFlush: () => Promise<void>;
  onRemoveGlossary: (key: string) => Promise<void>;
  onResetDrive: () => Promise<void>;
  onSave: () => Promise<void>;
  onSelectDestination: (destination: SyncDestination['type']) => void;
  onSelectDocument: (document: SecretaryDocument) => void;
  setDriveAccessToken: (value: string) => void;
  setDriveClientId: (value: string) => void;
  setDriveFolder: (value: string) => void;
  setGlossaryKey: (value: string) => void;
  setGlossaryValue: (value: string) => void;
  setPolishOptions: (value: PolishOptions) => void;
  setRecipient: (value: string) => void;
}

function SettingsView(props: SettingsViewProps): JSX.Element | null {
  if (!props.open) return null;

  return (
    <aside className="settings-drawer" aria-label="App Settings">
      <button className="icon-button settings-close" type="button" aria-label="Close settings" onClick={props.onClose}>
        <X size={22} />
      </button>
      <header className="settings-heading">
        <div className="grabber" />
        <h2>App Settings</h2>
        <p>Customize your experience</p>
      </header>

      <Accordion icon={<SlidersHorizontal size={26} />} title="Writing Style Preferences" subtitle="Adjust how text is polished">
        <Slider label="Concise" value={props.polishOptions.concise} onChange={(concise) => props.setPolishOptions({ ...props.polishOptions, concise })} />
        <Slider label="Structure" value={props.polishOptions.structure} onChange={(structure) => props.setPolishOptions({ ...props.polishOptions, structure })} />
        <Slider label="Tone" value={props.polishOptions.tone} onChange={(tone) => props.setPolishOptions({ ...props.polishOptions, tone })} />
      </Accordion>

      <Accordion icon={<BookOpen size={26} />} title="Word Auto-Correct Glossary" subtitle="Add or edit your custom terms">
        <div className="settings-grid">
          <label className="field">
            Typed term
            <input value={props.glossaryKey} onChange={(event) => props.setGlossaryKey(event.target.value)} />
          </label>
          <label className="field">
            Replacement
            <input value={props.glossaryValue} onChange={(event) => props.setGlossaryValue(event.target.value)} />
          </label>
        </div>
        <button type="button" onClick={() => props.onAddGlossary()}>
          <Save size={16} /> Add Term
        </button>
        <div className="glossary-list">
          {props.glossaryTerms.length === 0 ? <p>No custom terms yet.</p> : null}
          {props.glossaryTerms.map((term) => (
            <div className="glossary-row" key={term.key}>
              <span>
                <strong>{term.key}</strong>
                <small>{term.value}</small>
              </span>
              <button type="button" aria-label={`Remove ${term.key}`} onClick={() => props.onRemoveGlossary(term.key)}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </Accordion>

      <Accordion
        defaultOpen
        icon={<FolderUp size={26} />}
        title="Cloud Accounts & Export destinations"
        subtitle="Email, Drive, WebDAV & more"
      >
        <div className="saved-banner">
          <CheckCircle2 size={18} />
          {props.connected ? 'Settings saved securely' : 'Drive authorization needed'}
        </div>
        <div className="destination-tabs">
          <button className={props.destinationType === 'email' ? 'selected' : ''} type="button" onClick={() => props.onSelectDestination('email')}>
            <Mail size={16} /> Email
          </button>
          <button className={props.destinationType === 'gdrive' ? 'selected' : ''} type="button" onClick={() => props.onSelectDestination('gdrive')}>
            <FolderUp size={16} /> Google Drive
          </button>
        </div>
        <label className="field">
          Email address
          <input value={props.recipient} onChange={(event) => props.setRecipient(event.target.value)} />
        </label>
        <div className="credential-card">
          <div className="credential-title">
            <strong>Google Drive</strong>
            <span className={props.connected ? 'pill connected' : 'pill'}>{props.connected ? 'Connected' : 'Authorize'}</span>
          </div>
          <label className="field">
            Folder ID
            <input value={props.driveFolder} onChange={(event) => props.setDriveFolder(event.target.value)} />
          </label>
          <label className="field">
            OAuth client ID
            <input value={props.driveClientId} onChange={(event) => props.setDriveClientId(event.target.value)} />
          </label>
          <label className="field">
            Access token
            <input
              placeholder="Created after Authorize"
              type="password"
              value={props.driveAccessToken}
              onChange={(event) => props.setDriveAccessToken(event.target.value)}
            />
          </label>
          <div className="settings-grid">
            <button type="button" onClick={() => props.onAuthorizeDrive()}>
              <Play size={16} /> Authorize Google Drive
            </button>
            <button className="danger-button" type="button" onClick={() => props.onResetDrive()}>
              <Trash2 size={16} /> Reset Credentials
            </button>
          </div>
        </div>
        <div className="destination-status">
          <span>WebDAV</span>
          <small>Not configured</small>
        </div>
        <div className="destination-status">
          <span>Email (mailto:)</span>
          <small>Ready</small>
        </div>
      </Accordion>

      <Accordion icon={<Gauge size={26} />} title="Advanced Engine Diagnostics" subtitle="Engine options, logs & templates">
        <div className="metric-grid">
          <Metric label="Documents" value={props.metrics.documents} />
          <Metric label="Pending" value={props.metrics.pending} />
          <Metric label="Synced" value={props.metrics.synced} />
          <Metric label="Failed" value={props.metrics.failed} />
        </div>
        <div className="settings-grid">
          <button type="button" onClick={() => props.onSave()}>
            <Save size={16} /> Save Current Text
          </button>
          <button type="button" onClick={() => props.onFlush()}>
            <Send size={16} /> Run Sync Now
          </button>
        </div>
        <p className="diagnostic-line">Network: {props.online ? 'Online' : 'Offline Mode'}</p>
        <div className="history-list">
          <strong>Document History</strong>
          {props.documents.length === 0 ? <p>No local documents yet.</p> : null}
          {props.documents.map((document) => (
            <button
              className={`history-item ${props.selectedId === document.id ? 'selected' : ''}`}
              key={document.id}
              type="button"
              onClick={() => props.onSelectDocument(document)}
            >
              <span>{document.title}</span>
              <small>{document.sync_status}</small>
            </button>
          ))}
        </div>
        {props.warnings.length ? (
          <div className="diagnostic-list">
            {props.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}
      </Accordion>
    </aside>
  );
}

function Accordion({
  children,
  defaultOpen,
  icon,
  subtitle,
  title
}: {
  children: React.ReactNode;
  defaultOpen?: boolean;
  icon: JSX.Element;
  subtitle: string;
  title: string;
}): JSX.Element {
  return (
    <details className="settings-accordion" open={defaultOpen}>
      <summary>
        <span className="accordion-icon">{icon}</span>
        <span>
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
        <ChevronDown size={22} />
      </summary>
      <div className="accordion-body">{children}</div>
    </details>
  );
}

function Metric({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }): JSX.Element {
  return (
    <label className="slider">
      <span>
        {label} <strong>{value}</strong>
      </span>
      <input type="range" min="0" max="100" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function Select({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): JSX.Element {
  return (
    <label className="field language-field">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {languageOptions.map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

function buildTitle(text: string): string {
  const firstLine = text.split('\n').find(Boolean)?.replace(/^[-#*\s]+/, '').trim();
  return firstLine ? firstLine.slice(0, 60) : `Dictation ${new Date().toLocaleString()}`;
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function friendlyStatus(state: ModelState, online: boolean, recording: boolean): string {
  if (!online || state === 'offline') return 'Offline Mode';
  if (recording || state === 'recording-active') return 'Recording';
  if (state === 'processing-local-polish' || state === 'sync-pending') return 'Polishing...';
  return 'Ready';
}

function speakText(text: string): void {
  if (!text.trim() || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}
