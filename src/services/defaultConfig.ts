export const DEFAULT_EMAIL_RECIPIENT = 'technician.there@gmail.com';
export const DEFAULT_DRIVE_FOLDER_ID = '1cfq17rEgFDMehIUd7xDb6ctittwzrkVA';
export const DEFAULT_DRIVE_CLIENT_ID = '806567057060-152daedbqsjtemq6qa1r3tsq6dpfgj2i.apps.googleusercontent.com';

export interface DriveCredentials {
  folderId: string;
  clientId: string;
  accessToken?: string;
}

export const DEFAULT_DRIVE_CREDENTIALS: DriveCredentials = {
  folderId: DEFAULT_DRIVE_FOLDER_ID,
  clientId: DEFAULT_DRIVE_CLIENT_ID
};

export function withDefaultDriveCredentials(credentials?: Partial<DriveCredentials> | null): DriveCredentials {
  return {
    folderId: credentials?.folderId?.trim() || DEFAULT_DRIVE_FOLDER_ID,
    clientId: credentials?.clientId?.trim() || DEFAULT_DRIVE_CLIENT_ID,
    accessToken: credentials?.accessToken?.trim() || undefined
  };
}
