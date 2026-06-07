const CODE_VERIFIER_KEY = 'sandbox-secretary-drive-code-verifier';

export interface DriveOAuthConfig {
  clientId: string;
  redirectUri: string;
  scope?: string;
}

export async function createDriveAuthorizationUrl(config: DriveOAuthConfig): Promise<string> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = await sha256Base64Url(verifier);
  sessionStorage.setItem(CODE_VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scope ?? 'https://www.googleapis.com/auth/drive.file',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'consent'
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeDriveAuthorizationCode(
  code: string,
  config: DriveOAuthConfig,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const verifier = sessionStorage.getItem(CODE_VERIFIER_KEY);
  if (!verifier) {
    throw new Error('Missing OAuth verifier for Drive authorization.');
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier
  });
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!response.ok) {
    throw new Error(`Drive OAuth exchange failed with ${response.status}.`);
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error('Drive OAuth response did not include an access token.');
  }
  sessionStorage.removeItem(CODE_VERIFIER_KEY);
  return payload.access_token;
}

export function readAuthorizationCodeFromLocation(location: Location = window.location): string | undefined {
  const params = new URLSearchParams(location.search);
  return params.get('code') ?? undefined;
}

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}
