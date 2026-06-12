export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export function hasOnlyDriveFileScope(scope = '') {
  const grantedScopes = scope.split(/\s+/).filter(Boolean);

  return grantedScopes.length === 1 && grantedScopes[0] === GOOGLE_DRIVE_FILE_SCOPE;
}
