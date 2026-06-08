import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DRIVE_CLIENT_ID,
  DEFAULT_DRIVE_FOLDER_ID,
  DEFAULT_EMAIL_RECIPIENT,
  withDefaultDriveCredentials
} from './defaultConfig';

describe('default export configuration', () => {
  it('bakes in the requested non-secret destinations', () => {
    expect(DEFAULT_EMAIL_RECIPIENT).toBe('technician.there@gmail.com');
    expect(DEFAULT_DRIVE_FOLDER_ID).toBe('1cfq17rEgFDMehIUd7xDb6ctittwzrkVA');
    expect(DEFAULT_DRIVE_CLIENT_ID).toBe('806567057060-152daedbqsjtemq6qa1r3tsq6dpfgj2i.apps.googleusercontent.com');
  });

  it('keeps the access token optional because Google creates it after authorization', () => {
    expect(withDefaultDriveCredentials(null)).toEqual({
      folderId: DEFAULT_DRIVE_FOLDER_ID,
      clientId: DEFAULT_DRIVE_CLIENT_ID,
      accessToken: undefined
    });
  });
});
