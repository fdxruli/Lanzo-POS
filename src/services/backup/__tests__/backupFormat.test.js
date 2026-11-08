import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  buildHeader,
  bytesToBase64,
  concatBytes,
  decryptChunk,
  deriveBackupKey,
  encryptChunk,
  LEGACY_BACKUP_MAGIC,
  parseHeader,
  readEncryptedChunks
} from '../backupFormat';

async function createEncryptedBlob(pin, chunks) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyResult = await deriveBackupKey(pin, salt, 1000);
  const { headerBytes, prefix } = buildHeader({
    createdAt: new Date(0).toISOString(),
    dbName: 'TestDb',
    sourceBytes: chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
    salt: bytesToBase64(salt),
    iterations: 1000
  });
  const records = [];
  for (let index = 0; index < chunks.length; index += 1) {
    records.push(await encryptChunk(keyResult.key, headerBytes, index, chunks[index]));
  }
  return { blob: new Blob([prefix, ...records]), verifier: keyResult.verifier };
}

async function createLegacyEncryptedBlob(pin, chunks) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyResult = await deriveBackupKey(pin, salt, 1000);
  const header = {
    format: LEGACY_BACKUP_MAGIC,
    version: 1,
    cipher: 'AES-GCM-256',
    kdf: 'PBKDF2-SHA-256',
    chunkSize: 4 * 1024 * 1024,
    createdAt: new Date(0).toISOString(),
    dbName: 'LanzoDB_t_original-device-independent-id',
    tenantIdentity: 'license-id:same-business',
    sourceBytes: chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
    salt: bytesToBase64(salt),
    iterations: 1000
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, headerBytes.length, false);
  const prefix = concatBytes(new TextEncoder().encode(LEGACY_BACKUP_MAGIC), length, headerBytes);
  const records = [];
  for (let index = 0; index < chunks.length; index += 1) {
    records.push(await encryptChunk(keyResult.key, headerBytes, index, chunks[index]));
  }
  return new Blob([prefix, ...records]);
}

async function decryptBlob(blob, pin) {
  const parsed = await parseHeader(blob);
  const keyResult = await deriveBackupKey(
    pin,
    base64ToBytes(parsed.header.salt),
    parsed.header.iterations
  );
  const chunks = [];
  for await (const chunk of readEncryptedChunks(blob, parsed.dataOffset)) {
    chunks.push(await decryptChunk(
      keyResult.key,
      parsed.headerBytes,
      chunk.index,
      chunk.iv,
      chunk.cipherBytes
    ));
  }
  return chunks;
}

describe('backupFormat', () => {
  it('round-trips empty and multiple chunks', async () => {
    const source = [
      new Uint8Array(),
      new TextEncoder().encode('primer bloque'),
      crypto.getRandomValues(new Uint8Array(1024))
    ];
    const { blob } = await createEncryptedBlob('12345678', source);
    const decrypted = await decryptBlob(blob, '12345678');

    expect(decrypted).toHaveLength(source.length);
    decrypted.forEach((chunk, index) => {
      expect(Array.from(chunk)).toEqual(Array.from(source[index]));
    });
  });

  it('reads and decrypts a compatible V1 archive header', async () => {
    const source = new TextEncoder().encode('legacy backup');
    const blob = await createLegacyEncryptedBlob('12345678', [source]);
    const parsed = await parseHeader(blob);
    const decrypted = await decryptBlob(blob, '12345678');

    expect(parsed.header.version).toBe(1);
    expect(parsed.header.tenantIdentity).toBe('license-id:same-business');
    expect(new TextDecoder().decode(decrypted[0])).toBe('legacy backup');
  });

  it('rejects an incorrect PIN through AES-GCM authentication', async () => {
    const { blob } = await createEncryptedBlob('12345678', [
      new TextEncoder().encode('datos privados')
    ]);
    await expect(decryptBlob(blob, '87654321')).rejects.toBeTruthy();
  });

  it('rejects tampered ciphertext', async () => {
    const { blob } = await createEncryptedBlob('12345678', [
      new TextEncoder().encode('datos privados')
    ]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    bytes[bytes.length - 1] ^= 1;

    await expect(decryptBlob(new Blob([bytes]), '12345678')).rejects.toBeTruthy();
  });

  it('rejects a truncated encrypted record', async () => {
    const { blob } = await createEncryptedBlob('12345678', [new TextEncoder().encode('truncated')]);
    await expect(decryptBlob(blob.slice(0, blob.size - 3), '12345678')).rejects.toBeTruthy();
  });

  it('authenticates header metadata as associated data', async () => {
    const { blob } = await createEncryptedBlob('12345678', [
      new TextEncoder().encode('datos privados')
    ]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const marker = new TextEncoder().encode('TestDb');
    let markerOffset = -1;
    for (let index = 0; index <= bytes.length - marker.length; index += 1) {
      if (marker.every((value, markerIndex) => bytes[index + markerIndex] === value)) {
        markerOffset = index;
        break;
      }
    }
    expect(markerOffset).toBeGreaterThan(0);
    bytes[markerOffset] = 'X'.charCodeAt(0);

    await expect(decryptBlob(new Blob([bytes]), '12345678')).rejects.toBeTruthy();
  });

  it('uses a different IV for every encrypted block', async () => {
    const { blob } = await createEncryptedBlob('12345678', [
      new Uint8Array([1]),
      new Uint8Array([1]),
      new Uint8Array([1])
    ]);
    const parsed = await parseHeader(blob);
    const ivs = [];
    for await (const chunk of readEncryptedChunks(blob, parsed.dataOffset)) {
      ivs.push(bytesToBase64(chunk.iv));
    }
    expect(new Set(ivs).size).toBe(ivs.length);
  });
});
