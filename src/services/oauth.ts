// Google Identity Services (GIS) token-client OAuth for a browser-only SPA.
// Replaces the old redirect + PKCE code flow (which failed because Google's
// token endpoint blocks browser CORS for web clients). The token client opens
// a popup and hands back an access token directly — no server, no secret.

export const GOOGLE_OAUTH_SCOPES =
  'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.send';
export const GMAIL_SEND_ENDPOINT =
  'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

export interface GoogleTokenResult {
  accessToken: string;
  expiresAt: number; // epoch milliseconds
}

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GisTokenClient {
  requestAccessToken: (options: { prompt: '' | 'consent' }) => void;
}

interface GisTokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: GisTokenResponse) => void;
  error_callback: (error: { type?: string }) => void;
}

interface GoogleOAuth2Namespace {
  initTokenClient: (config: GisTokenClientConfig) => GisTokenClient;
}

interface GoogleWindow {
  google?: {
    accounts?: {
      oauth2?: GoogleOAuth2Namespace;
    };
  };
}

// Injects the GIS script once and resolves when its oauth2 namespace is ready.
export function loadGoogleIdentityServices(timeoutMs = 8000): Promise<GoogleOAuth2Namespace> {
  return new Promise<GoogleOAuth2Namespace>((resolve, reject) => {
    const w = window as unknown as GoogleWindow;
    const ready = (): GoogleOAuth2Namespace | undefined => w.google?.accounts?.oauth2;
    const immediate = ready();
    if (immediate) {
      resolve(immediate);
      return;
    }
    if (!document.querySelector(`script[src="${GIS_SRC}"]`)) {
      const script = document.createElement('script');
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      script.onerror = () => reject(new Error('Failed to load the Google sign-in library.'));
      document.head.appendChild(script);
    }
    const start = Date.now();
    const poll = (): void => {
      const oauth2 = ready();
      if (oauth2) {
        resolve(oauth2);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(
          new Error(
            'Google sign-in library could not load. Check your connection, and serve the app over http(s) — Google OAuth does not work from a file:// URL.'
          )
        );
        return;
      }
      window.setTimeout(poll, 120);
    };
    poll();
  });
}

let cachedClient: GisTokenClient | null = null;
let cachedClientId = '';
let pendingResolve: ((response: GisTokenResponse) => void) | null = null;
let pendingReject: ((error: Error) => void) | null = null;

async function getTokenClient(clientId: string, scope: string): Promise<GisTokenClient> {
  const oauth2 = await loadGoogleIdentityServices();
  if (cachedClient && cachedClientId === clientId) return cachedClient;
  cachedClient = oauth2.initTokenClient({
    client_id: clientId,
    scope,
    callback: (response: GisTokenResponse) => {
      if (response && !response.error && response.access_token) {
        pendingResolve?.(response);
      } else {
        pendingReject?.(
          new Error('Google authorization failed: ' + (response?.error_description || response?.error || 'no access token returned'))
        );
      }
      pendingResolve = null;
      pendingReject = null;
    },
    error_callback: (err: { type?: string }) => {
      pendingReject?.(new Error('Google sign-in was cancelled or blocked (' + (err?.type || 'popup closed') + '). Allow pop-ups and try again.'));
      pendingResolve = null;
      pendingReject = null;
    }
  });
  cachedClientId = clientId;
  return cachedClient;
}

// Requests an access token through the GIS popup.
// prompt='consent' is interactive; prompt='' attempts a silent refresh.
export async function requestGoogleAccessToken(
  clientId: string,
  scope: string = GOOGLE_OAUTH_SCOPES,
  prompt: '' | 'consent' = 'consent'
): Promise<GoogleTokenResult> {
  const client = await getTokenClient(clientId, scope);
  const response = await new Promise<GisTokenResponse>((resolve, reject) => {
    pendingResolve = resolve;
    pendingReject = reject;
    try {
      client.requestAccessToken({ prompt });
    } catch (error) {
      pendingResolve = null;
      pendingReject = null;
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
  return {
    accessToken: response.access_token as string,
    expiresAt: Date.now() + Number(response.expires_in || 3600) * 1000
  };
}
