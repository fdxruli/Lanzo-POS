import { describe, expect, it } from 'vitest';
import {
  GOOGLE_DRIVE_FILE_SCOPE,
  hasOnlyDriveFileScope
} from './googleDrive';

describe('Google Drive OAuth scope', () => {
  it('acepta exclusivamente drive.file', () => {
    expect(hasOnlyDriveFileScope(GOOGLE_DRIVE_FILE_SCOPE)).toBe(true);
  });

  it('rechaza scopes de identidad o acceso total a Drive', () => {
    expect(hasOnlyDriveFileScope(`openid ${GOOGLE_DRIVE_FILE_SCOPE}`)).toBe(false);
    expect(hasOnlyDriveFileScope('https://www.googleapis.com/auth/drive')).toBe(false);
  });
});
