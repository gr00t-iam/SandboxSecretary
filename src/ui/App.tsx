import {
  Activity,
  Cloud,
  CloudOff,
  FileText,
  FolderUp,
  Languages,
  Mail,
  Mic,
  Pause,
  Play,
  Save,
  Send,
  SlidersHorizontal,
  Sparkles
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CacheMetrics, ModelState, PolishOptions, SecretaryDocument, SyncDestination } from '../types';
import { AiWorkerClient } from '../services/aiWorkerClient';
import { AudioCaptureController } from '../services/audioPipeline';
import { createDriveAuthorizationUrl, exchangeDriveAuthorizationCode, readAuthorizationCodeFromLocation } from '../services/oauth';
import { registerServiceWorker, subscribeToNetworkStatus } from '../services/pwa';
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

export function App(): JSX.Element {
  const [documents, setDocuments] = useState<SecretaryDocument[]>([]);
  const [metrics, setMetrics] = useState<CacheMetrics>(defaultMetrics);
  const [online, setOnline] = useState(navigator.onLine);
  const [state, setState] = useState<ModelState>('model-initializing');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [rawText, setRawText] = useState('');
  const [polishedText, setPolishedText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLang, setTargetLang] = useState('es');
  const [destinationType, setDestinationType] = useState<SyncDestination['type']>('email');
  const [recipient, setRecipient] = useState('me@example.com');
  const [driveFolder, setDriveFolder] = useState('');
  const [driveClientId, setDriveClientId] = useState('');
  const [driveAccessToken, setDriveAccessToken] = useState('');
  const [polishOptions, setPolishOptions] = useState<PolishOptions>({ concise: 55, structure: 80, tone: 45 });
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();

  const aiClient = useRef<AiWorkerClient>();
  const audioController = useRef<AudioCaptureController>();
  const transcriptBuffer = useRef<Float32Array[]>([]);

  const syncManager = useMemo(
    () =>
      new SyncManager(storage, {
        isOnline: () => navigator.onLine,
        openMailto: (href) => {
          window.location.href = href;
        }
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
      if (isOnline) {
        flushSyncQueue();
      }
    });

    refreshDocuments();
    completeDriveOAuthIfPresent();

    return () => {
      unsubscribe();
      aiClient.current?.dispose();
    };
    // Service worker and model startup should run once for this app shell.
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
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  async function refreshDocuments(): Promise<void> {
    const [nextDocuments, nextMetrics] = await Promise.all([storage.listDocuments(), storage.getMetrics()]);
    setDocuments(nextDocuments);
    setMetrics(nextMetrics);
  }

  async function completeDriveOAuthIfPresent(): Promise<void> {
    const code = readAuthorizationCodeFromLocation();
    if (!code || !driveClientId) {
      return;
    }
    try {
      const token = await exchangeDriveAuthorizationCode(code, {
        clientId: driveClientId,
        redirectUri: window.location.origin + window.location.pathname
      });
      setDriveAccessToken(token);
      window.history.replaceState({}, document.title, window.location.pathname);
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
    transcriptBuffer.current = [];
    audioController.current = new AudioCaptureController();
    await audioController.current.start({
      onAudioFrame: (samples) => {
        transcriptBuffer.current.push(samples);
      },
      onLevel: (rms) => setLevel(Math.min(1, rms * 12)),
      onError: addWarning
    });
    setRecording(true);
    setState('recording-active');
  }

  async function stopRecording(): Promise<void> {
    const blob = await audioController.current?.stop();
    setRecording(false);
    setLevel(0);
    setState('processing-local-polish');
    const samples = mergeAudioFrames(transcriptBuffer.current);
    const transcript = samples.length
      ? await aiClient.current?.transcribe(samples, sourceLang).then((segment) => segment.text)
      : '';
    const nextRaw = [rawText, transcript].filter(Boolean).join(rawText && transcript ? '\n' : '');
    setRawText(nextRaw);
    const audioUrl = blob ? URL.createObjectURL(blob) : undefined;
    if (audioUrl) {
      const audioSizeKb = Math.round((blob?.size ?? 0) / 1024);
      setWarnings((current) => [...current.slice(-2), `Audio captured locally: ${audioSizeKb} KB`]);
    }
    await runPolish(nextRaw);
  }

  async function runPolish(text = rawText): Promise<void> {
    setState('processing-local-polish');
    const fallback = polishTranscript(text, polishOptions);
    const polished = aiClient.current?.isReady() ? await aiClient.current.polish(text, polishOptions) : fallback;
    setPolishedText(polished || fallback);
    setState('system-ready');
  }

  async function runTranslate(text = polishedText || rawText): Promise<void> {
    const fallback = translateTextOffline(text, sourceLang, targetLang);
    const translated = aiClient.current?.isReady() ? await aiClient.current.translate(text, sourceLang, targetLang) : fallback;
    setTranslatedText(translated || fallback);
  }

  async function saveCurrentDocument(): Promise<void> {
    const destination: SyncDestination =
      destinationType === 'email'
        ? { type: 'email', path_or_recipient: recipient }
        : { type: 'gdrive', path_or_recipient: driveFolder, accessToken: driveAccessToken || undefined };
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
    if (online) {
      await flushSyncQueue();
    }
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
    if (!driveClientId.trim()) {
      addWarning('Enter a browser OAuth client ID before authorizing Drive.');
      return;
    }
    const url = await createDriveAuthorizationUrl({
      clientId: driveClientId.trim(),
      redirectUri: window.location.origin + window.location.pathname
    });
    window.location.href = url;
  }

  function selectDocument(document: SecretaryDocument): void {
    setSelectedId(document.id);
    setRawText(document.raw_transcript);
    setPolishedText(document.polished_text);
    setSourceLang(document.source_lang);
    setTargetLang(document.target_lang);
    setDestinationType(document.sync_destination.type);
  }

  function addWarning(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    setWarnings((current) => [...current.slice(-2), message]);
    setState('resource-restricted');
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Document history and cache metrics">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <h1>Sandbox Secretary</h1>
            <p>Local-first dictation desk</p>
          </div>
        </div>
        <div className={`network-badge ${online ? 'online' : 'offline'}`}>
          {online ? <Cloud size={16} /> : <CloudOff size={16} />}
          {online ? 'Online' : 'Offline'}
        </div>
        <section className="metric-grid" aria-label="Local cache metrics">
          <Metric label="Documents" value={metrics.documents} />
          <Metric label="Pending" value={metrics.pending} />
          <Metric label="Synced" value={metrics.synced} />
          <Metric label="Failed" value={metrics.failed} />
        </section>
        <section className="history-list" aria-label="Document history">
          <div className="section-title">
            <FileText size={16} />
            History
          </div>
          {documents.length === 0 ? <p className="empty">No local documents yet.</p> : null}
          {documents.map((document) => (
            <button
              className={`history-item ${selectedId === document.id ? 'selected' : ''}`}
              key={document.id}
              type="button"
              onClick={() => selectDocument(document)}
            >
              <span>{document.title}</span>
              <small>{document.sync_status}</small>
            </button>
          ))}
        </section>
      </aside>

      <section className="stage" aria-label="Transcription workspace">
        <header className="stage-header">
          <div>
            <p className="state-label">State machine</p>
            <h2>{formatState(state)}</h2>
          </div>
          <div className="runtime-status">
            <Activity size={18} />
            16 kHz mono capture · WASM/WebGPU worker
          </div>
        </header>

        <div className="meter-panel">
          <div className="record-core">
            <button className={`record-button ${recording ? 'active' : ''}`} type="button" onClick={toggleRecording}>
              {recording ? <Pause size={34} /> : <Mic size={34} />}
            </button>
            <div>
              <h3>{recording ? 'Recording active' : 'Ready for dictation'}</h3>
              <p>Audio remains in the browser sandbox and streams to the local worker.</p>
            </div>
          </div>
          <div className="vu-meter" aria-label="Input level">
            <span style={{ width: `${Math.max(3, level * 100)}%` }} />
          </div>
        </div>

        <div className="editor-grid">
          <label className="editor-panel">
            <span>Raw transcript</span>
            <textarea value={rawText} onChange={(event) => setRawText(event.target.value)} />
          </label>
          <label className="editor-panel">
            <span>Polished Markdown</span>
            <textarea value={polishedText} onChange={(event) => setPolishedText(event.target.value)} />
          </label>
        </div>

        <label className="translation-panel">
          <span>Translation output</span>
          <textarea value={translatedText} onChange={(event) => setTranslatedText(event.target.value)} />
        </label>

        {warnings.length ? (
          <div className="warning-stack" role="status">
            {warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}
      </section>

      <aside className="action-panel" aria-label="Actions and sync settings">
        <PanelHeader icon={<Sparkles size={18} />} title="Local actions" />
        <div className="button-row">
          <button type="button" onClick={() => runPolish()}>
            <Sparkles size={16} />
            Polish
          </button>
          <button type="button" onClick={() => runTranslate()}>
            <Languages size={16} />
            Translate
          </button>
        </div>

        <PanelHeader icon={<SlidersHorizontal size={18} />} title="Polishing constraints" />
        <Slider label="Concise" value={polishOptions.concise} onChange={(concise) => setPolishOptions({ ...polishOptions, concise })} />
        <Slider label="Structure" value={polishOptions.structure} onChange={(structure) => setPolishOptions({ ...polishOptions, structure })} />
        <Slider label="Tone" value={polishOptions.tone} onChange={(tone) => setPolishOptions({ ...polishOptions, tone })} />

        <PanelHeader icon={<Languages size={18} />} title="Languages" />
        <div className="field-row">
          <Select label="Source" value={sourceLang} onChange={setSourceLang} />
          <Select label="Target" value={targetLang} onChange={setTargetLang} />
        </div>

        <PanelHeader icon={destinationType === 'email' ? <Mail size={18} /> : <FolderUp size={18} />} title="Sync destination" />
        <div className="segmented">
          <button className={destinationType === 'email' ? 'selected' : ''} type="button" onClick={() => setDestinationType('email')}>
            <Mail size={15} />
            Email
          </button>
          <button className={destinationType === 'gdrive' ? 'selected' : ''} type="button" onClick={() => setDestinationType('gdrive')}>
            <FolderUp size={15} />
            Drive
          </button>
        </div>

        {destinationType === 'email' ? (
          <label className="field">
            Recipient
            <input value={recipient} onChange={(event) => setRecipient(event.target.value)} />
          </label>
        ) : (
          <div className="drive-fields">
            <label className="field">
              Drive folder ID
              <input value={driveFolder} onChange={(event) => setDriveFolder(event.target.value)} />
            </label>
            <label className="field">
              OAuth client ID
              <input value={driveClientId} onChange={(event) => setDriveClientId(event.target.value)} />
            </label>
            <label className="field">
              Access token
              <input value={driveAccessToken} onChange={(event) => setDriveAccessToken(event.target.value)} />
            </label>
            <button type="button" onClick={authorizeDrive}>
              <Play size={16} />
              Authorize
            </button>
          </div>
        )}

        <div className="button-column">
          <button className="primary-action" type="button" onClick={saveCurrentDocument}>
            <Save size={16} />
            Save to queue
          </button>
          <button type="button" onClick={flushSyncQueue}>
            <Send size={16} />
            Flush queue
          </button>
        </div>
      </aside>
    </main>
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

function PanelHeader({ icon, title }: { icon: JSX.Element; title: string }): JSX.Element {
  return (
    <div className="panel-header">
      {icon}
      <span>{title}</span>
    </div>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }): JSX.Element {
  return (
    <label className="slider">
      <span>
        {label}
        <strong>{value}</strong>
      </span>
      <input type="range" min="0" max="100" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function Select({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): JSX.Element {
  return (
    <label className="field">
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

function mergeAudioFrames(frames: Float32Array[]): Float32Array {
  const length = frames.reduce((total, frame) => total + frame.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const frame of frames) {
    merged.set(frame, offset);
    offset += frame.length;
  }
  return merged;
}

function buildTitle(text: string): string {
  const firstLine = text.split('\n').find(Boolean)?.replace(/^[-#*\s]+/, '').trim();
  return firstLine ? firstLine.slice(0, 60) : `Dictation ${new Date().toLocaleString()}`;
}

function formatState(state: ModelState): string {
  return state
    .split('-')
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
