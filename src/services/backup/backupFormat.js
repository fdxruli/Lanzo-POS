export const BACKUP_MAGIC = 'LANZOBK1';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_CHUNK_SIZE = 4 * 1024 * 1024;
export const BACKUP_ITERATIONS = 600000;
export const BACKUP_EXTENSION = '.lzbk';
export const BACKUP_PREFIX = 'RESPALDO_LANZO_';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAGIC_BYTES = encoder.encode(BACKUP_MAGIC);
const IV_LENGTH = 12;
const LENGTH_BYTES = 4;

function uint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function readUint32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

export function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function concatBytes(...parts) {
  const arrays = parts.map((part) => part instanceof Uint8Array ? part : new Uint8Array(part));
  const length = arrays.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of arrays) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export async function deriveBackupKey(pin, salt, iterations = BACKUP_ITERATIONS) {
  const pinBytes = encoder.encode(pin);
  const material = await crypto.subtle.importKey('raw', pinBytes, 'PBKDF2', false, ['deriveBits']);
  const keyBytes = new Uint8Array(await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt,
    iterations
  }, material, 256));
  const verifierBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', keyBytes));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  keyBytes.fill(0);
  pinBytes.fill(0);
  return { key, verifier: bytesToBase64(verifierBytes) };
}

export function buildHeader(metadata) {
  const header = {
    format: BACKUP_MAGIC,
    version: BACKUP_FORMAT_VERSION,
    cipher: 'AES-GCM-256',
    kdf: 'PBKDF2-SHA-256',
    chunkSize: BACKUP_CHUNK_SIZE,
    ...metadata
  };
  const headerBytes = encoder.encode(JSON.stringify(header));
  return {
    header,
    headerBytes,
    prefix: concatBytes(MAGIC_BYTES, uint32(headerBytes.byteLength), headerBytes)
  };
}

export async function parseHeader(blob) {
  const fixedLength = MAGIC_BYTES.byteLength + LENGTH_BYTES;
  if (blob.size < fixedLength) throw new Error('BACKUP_INVALID_HEADER');

  const fixed = new Uint8Array(await blob.slice(0, fixedLength).arrayBuffer());
  const magic = decoder.decode(fixed.slice(0, MAGIC_BYTES.byteLength));
  if (magic !== BACKUP_MAGIC) throw new Error('BACKUP_INVALID_MAGIC');

  const headerLength = readUint32(fixed, MAGIC_BYTES.byteLength);
  if (headerLength <= 0 || headerLength > 1024 * 1024 || blob.size < fixedLength + headerLength) {
    throw new Error('BACKUP_INVALID_HEADER');
  }

  const headerBytes = new Uint8Array(await blob.slice(fixedLength, fixedLength + headerLength).arrayBuffer());
  const header = JSON.parse(decoder.decode(headerBytes));
  if (header.version !== BACKUP_FORMAT_VERSION || header.format !== BACKUP_MAGIC) {
    throw new Error('BACKUP_UNSUPPORTED_VERSION');
  }
  return { header, headerBytes, dataOffset: fixedLength + headerLength };
}

async function buildAad(headerBytes, index) {
  const headerHash = new Uint8Array(await crypto.subtle.digest('SHA-256', headerBytes));
  return concatBytes(headerHash, uint32(index));
}

export async function encryptChunk(key, headerBytes, index, plainBytes) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const additionalData = await buildAad(headerBytes, index);
  const cipherBytes = new Uint8Array(await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData,
    tagLength: 128
  }, key, plainBytes));
  return concatBytes(uint32(cipherBytes.byteLength), iv, cipherBytes);
}

export async function decryptChunk(key, headerBytes, index, iv, cipherBytes) {
  const additionalData = await buildAad(headerBytes, index);
  return new Uint8Array(await crypto.subtle.decrypt({
    name: 'AES-GCM',
    iv,
    additionalData,
    tagLength: 128
  }, key, cipherBytes));
}

export async function* readEncryptedChunks(blob, dataOffset) {
  let offset = dataOffset;
  let index = 0;
  while (offset < blob.size) {
    if (blob.size - offset < LENGTH_BYTES + IV_LENGTH) throw new Error('BACKUP_TRUNCATED');
    const recordHeader = new Uint8Array(await blob.slice(offset, offset + LENGTH_BYTES + IV_LENGTH).arrayBuffer());
    const cipherLength = readUint32(recordHeader, 0);
    if (cipherLength < 16 || offset + LENGTH_BYTES + IV_LENGTH + cipherLength > blob.size) {
      throw new Error('BACKUP_TRUNCATED');
    }
    const iv = recordHeader.slice(LENGTH_BYTES);
    const cipherStart = offset + LENGTH_BYTES + IV_LENGTH;
    const cipherBytes = new Uint8Array(await blob.slice(cipherStart, cipherStart + cipherLength).arrayBuffer());
    yield { index, iv, cipherBytes };
    offset = cipherStart + cipherLength;
    index += 1;
  }
}

export function createBackupFileName(date = new Date()) {
  return `${BACKUP_PREFIX}${date.toISOString().replace(/[:.]/g, '-')}${BACKUP_EXTENSION}`;
}
