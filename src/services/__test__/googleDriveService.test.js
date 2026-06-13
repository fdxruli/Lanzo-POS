import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteBackup,
  GoogleDriveError,
  listBackups,
  uploadBackup
} from '../googleDriveService';
import { useAppStore } from '../../store/useAppStore';

afterEach(() => {
  vi.restoreAllMocks();
  useAppStore.setState({
    driveAccessToken: null,
    driveTokenExpiresAt: null,
    isDriveConnected: false,
    needsDriveReauth: false
  });
});

describe('googleDriveService', () => {
  it('uploads a backup as multipart/related', async () => {
    const responseData = { id: 'drive-file-id', name: 'backup.lanzo' };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(responseData)
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ files: [] })
      });
    const fileBlob = new Blob(['backup-content'], {
      type: 'application/octet-stream'
    });

    await expect(
      uploadBackup('access-token', fileBlob, 'backup.lanzo')
    ).resolves.toEqual(responseData);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'
    );
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer access-token');
    expect(options.headers['Content-Type']).toMatch(
      /^multipart\/related; boundary=lanzo_pos_boundary_/
    );

    const boundary = options.headers['Content-Type'].split('boundary=')[1];
    const bodyText = await options.body.text();
    expect(bodyText).toContain(`--${boundary}\r\n`);
    expect(bodyText).toContain('Content-Type: application/json; charset=UTF-8');
    expect(bodyText).toContain(JSON.stringify({
      name: 'backup.lanzo',
      appProperties: {
        type: 'lanzo_pos_backup'
      }
    }));
    expect(bodyText).toContain('Content-Type: application/octet-stream');
    expect(bodyText).toContain('backup-content');
    expect(bodyText).toContain(`--${boundary}--\r\n`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('deletes backups older than the newest 14 after uploading', async () => {
    const files = Array.from({ length: 16 }, (_, index) => ({
      id: `backup-${index + 1}`
    }));
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ id: 'new-backup' })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ files })
      })
      .mockResolvedValue({ ok: true });

    await uploadBackup(
      'access-token',
      new Blob(['backup-content']),
      'backup.lzbk'
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2][0]).toContain('/backup-15');
    expect(fetchMock.mock.calls[3][0]).toContain('/backup-16');
  });

  it('lists only Lanzo backups ordered by newest first', async () => {
    const responseData = { files: [{ id: 'backup-1' }] };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(responseData)
    });

    await expect(listBackups('access-token')).resolves.toEqual(responseData);

    const [requestUrl, options] = fetchMock.mock.calls[0];
    const url = new URL(requestUrl);
    expect(url.origin + url.pathname).toBe(
      'https://www.googleapis.com/drive/v3/files'
    );
    expect(url.searchParams.get('q')).toBe(
      "appProperties has { key='type' and value='lanzo_pos_backup' }"
    );
    expect(url.searchParams.get('orderBy')).toBe('createdTime desc');
    expect(url.searchParams.get('pageSize')).toBe('1000');
    expect(url.searchParams.get('fields')).toBe(
      'nextPageToken,files(id,name,createdTime)'
    );
    expect(options).toEqual({
      method: 'GET',
      headers: {
        Authorization: 'Bearer access-token'
      }
    });
  });

  it('combines all backup pages in newest-first order', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          files: [{ id: 'backup-1' }],
          nextPageToken: 'next-page'
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          files: [{ id: 'backup-2' }]
        })
      });

    await expect(listBackups('access-token')).resolves.toEqual({
      files: [{ id: 'backup-1' }, { id: 'backup-2' }]
    });

    const secondUrl = new URL(fetchMock.mock.calls[1][0]);
    expect(secondUrl.searchParams.get('pageToken')).toBe('next-page');
  });

  it('deletes a backup by file ID', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true
    });

    await expect(
      deleteBackup('access-token', 'folder/file id')
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files/folder%2Ffile%20id',
      {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer access-token'
        }
      }
    );
  });

  it('surfaces Google Drive API errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: vi.fn().mockResolvedValue({
        error: {
          message: 'Invalid Credentials'
        }
      })
    });

    useAppStore.setState({
      driveAccessToken: 'expired-token',
      driveTokenExpiresAt: Date.now() - 1,
      isDriveConnected: true
    });

    const error = await listBackups('expired-token').catch((caughtError) => caughtError);

    expect(error).toBeInstanceOf(GoogleDriveError);
    expect(error.message).toBe('Google Drive API error (401): Invalid Credentials');
    expect(error.status).toBe(401);
    expect(useAppStore.getState()).toMatchObject({
      driveAccessToken: null,
      driveTokenExpiresAt: null,
      isDriveConnected: false,
      needsDriveReauth: true
    });
  });
});
