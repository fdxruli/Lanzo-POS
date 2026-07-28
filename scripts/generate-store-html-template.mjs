import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  STORE_SOCIAL_HEAD_END,
  STORE_SOCIAL_HEAD_START,
  validateStoreHtmlTemplate,
} from '../store/api/_storeHtmlTemplate.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_INPUT = path.join(projectRoot, 'dist-store', 'index.html');
const DEFAULT_OUTPUT = path.join(projectRoot, 'store', 'generated', 'storeHtmlTemplate.js');

function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Store HTML must be valid UTF-8.');
  }
}

export function serializeStoreHtmlTemplateModule(template) {
  validateStoreHtmlTemplate(template);
  if (/file:\/\/|sourceMappingURL|[\r\n][A-Za-z]:\\/iu.test(template)) {
    throw new Error('Store HTML contains a forbidden local or source-map reference.');
  }
  const htmlBytes = Buffer.byteLength(template, 'utf8');
  const htmlSha256 = createHash('sha256').update(template).digest('hex');
  return [
    '// Generated from dist-store/index.html. Do not edit manually.',
    `export const STORE_HTML_TEMPLATE = ${JSON.stringify(template)};`,
    `export const STORE_HTML_BYTES = ${htmlBytes};`,
    `export const STORE_HTML_SHA256 = ${JSON.stringify(htmlSha256)};`,
    `export const STORE_SOCIAL_HEAD_START = ${JSON.stringify(STORE_SOCIAL_HEAD_START)};`,
    `export const STORE_SOCIAL_HEAD_END = ${JSON.stringify(STORE_SOCIAL_HEAD_END)};`,
    '',
  ].join('\n');
}

export async function generateStoreHtmlTemplate({
  inputPath = DEFAULT_INPUT,
  outputPath = DEFAULT_OUTPUT,
} = {}) {
  await access(inputPath, constants.R_OK);
  const template = decodeUtf8(await readFile(inputPath));
  const moduleSource = serializeStoreHtmlTemplateModule(template);
  const outputDirectory = path.dirname(outputPath);
  const temporaryPath = path.join(
    outputDirectory,
    `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp`,
  );

  await mkdir(outputDirectory, { recursive: true });
  try {
    await writeFile(temporaryPath, moduleSource, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return Object.freeze({ inputPath, outputPath });
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_INPUT;
  const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUTPUT;
  generateStoreHtmlTemplate({ inputPath, outputPath }).catch(() => {
    process.stderr.write('Store HTML template generation failed.\n');
    process.exitCode = 1;
  });
}
