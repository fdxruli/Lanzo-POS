import { useAppStore } from '../store/useAppStore';

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const BACKUP_APP_PROPERTY = 'lanzo_pos_backup';
const MAX_DRIVE_BACKUPS = 14;

export class GoogleDriveError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GoogleDriveError';
    this.status = status;
  }
}

function createBoundary() {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}_${Math.random().toString(16).slice(2)}`;

  return `lanzo_pos_boundary_${suffix}`;
}

async function parseErrorResponse(response) {
  try {
    const data = await response.json();
    return data?.error?.message || data?.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

async function assertSuccessfulResponse(response) {
  if (response.ok) return;

  const message = await parseErrorResponse(response);
  if (response.status === 401) {
    useAppStore.getState().markDriveNeedsReauth();
  }

  throw new GoogleDriveError(
    `Google Drive API error (${response.status}): ${message || 'Unknown error'}`,
    response.status
  );
}

/**
 * Uploads a POS backup using Google Drive's multipart/related protocol.
 */
export async function uploadBackup(token, fileBlob, fileName) {
  const boundary = createBoundary();
  const metadata = {
    name: fileName,
    appProperties: {
      type: BACKUP_APP_PROPERTY
    }
  };
  const fileContentType = fileBlob.type || 'application/octet-stream';
  const body = new Blob([
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\n`,
    `Content-Type: ${fileContentType}\r\n\r\n`,
    fileBlob,
    `\r\n--${boundary}--\r\n`
  ], {
    type: `multipart/related; boundary=${boundary}`
  });

  const response = await fetch(DRIVE_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });

  await assertSuccessfulResponse(response);
  const uploadedBackup = await response.json();
  const { files = [] } = await listBackups(token);
  const expiredBackups = files.slice(MAX_DRIVE_BACKUPS);

  for (const backup of expiredBackups) {
    await deleteBackup(token, backup.id);
  }

  return uploadedBackup;
}

/**
 * Lists backups created by Lanzo, newest first.
 */
export async function listBackups(token) {
  const query = "appProperties has { key='type' and value='lanzo_pos_backup' }";
  const files = [];
  let pageToken = '';

  do {
    const url = new URL(DRIVE_FILES_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('orderBy', 'createdTime desc');
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('fields', 'nextPageToken,files(id,name,createdTime)');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    await assertSuccessfulResponse(response);
    const page = await response.json();
    files.push(...(page.files || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);

  return { files };
}

/**
 * Deletes a backup by its Google Drive file ID.
 */
export async function deleteBackup(token, fileId) {
  const response = await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  await assertSuccessfulResponse(response);
  return true;
}
