import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const projectRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const generationVersion = '1.0.0';
const generatedAt = '2026-08-03';
const sourceCommit = '0decbc4124fed4e8cda4e807a9a400f7257e3084';
const manifestPath = path.join(projectRoot, 'brand', 'brand-assets.manifest.json');

const canonicalDefinitions = Object.freeze([
  {
    path: 'brand/lanzo-mark.svg',
    role: 'square favicon, PWA and maskable mark',
    width: 64,
    height: 64,
  },
  {
    path: 'brand/lanzo-wordmark.svg',
    role: 'horizontal Lanzo wordmark',
    width: 360,
    height: 96,
  },
  {
    path: 'brand/lanzo-assistant.svg',
    role: 'abstract assistant mark',
    width: 64,
    height: 64,
  },
]);

const derivedDefinitions = Object.freeze([
  {
    canonicalSource: 'brand/lanzo-mark.svg',
    path: 'public/icono-web.png',
    width: 192,
    height: 192,
    format: 'PNG',
    process: 'sharp: rasterize canonical mark at 192x192 with deterministic PNG settings',
  },
  {
    canonicalSource: 'brand/lanzo-mark.svg',
    path: 'public/pwa-192x192.png',
    width: 192,
    height: 192,
    format: 'PNG',
    process: 'sharp: rasterize canonical mark at 192x192 with deterministic PNG settings',
  },
  {
    canonicalSource: 'brand/lanzo-mark.svg',
    path: 'public/pwa-512x512.png',
    width: 512,
    height: 512,
    format: 'PNG',
    process: 'sharp: rasterize canonical mark at 512x512 with deterministic PNG settings',
  },
  {
    canonicalSource: 'brand/lanzo-wordmark.svg',
    path: 'public/log.svg',
    width: 360,
    height: 96,
    format: 'SVG',
    process: 'byte-identical copy of canonical wordmark source',
  },
  {
    canonicalSource: 'brand/lanzo-mark.svg',
    path: 'public/logIcon.svg',
    width: 64,
    height: 64,
    format: 'SVG',
    process: 'byte-identical copy of canonical mark source',
  },
  {
    canonicalSource: 'brand/lanzo-assistant.svg',
    path: 'public/boticon.svg',
    width: 64,
    height: 64,
    format: 'SVG',
    process: 'byte-identical copy of canonical assistant source',
  },
]);

const legacyHashes = new Set([
  '6d171dc8eecdb616bea0fe862880dc80fee5b3b4c8d91d8723839bc6f315dc0c',
  'f18a142863439b8a147d335f2232c23edabc2b1cde4b42b4ff959020378b5ef5',
  '85d444cf5d1e2545a916a48ccc8567667a98c890074929e5fab0f30b8bd29673',
  'b8dfbddccca477b9ca8125ab3f9a9f790e8f8040fb5a1f3480509680217f2460',
  '3cc39f6eff3148fbeb418eb3ff18397e537067ebf8a172e2324782609f1c1ae2',
  'fd0e93e021a8d91d0272753f295d48862fef2c8c9bff91a8e6b90ddab313c98a',
  '93bf10b60605088cfbd4f35fe23b82f4d9f387fa604f72f5fff54931debea1c4',
]);

const assetPathsToAudit = Object.freeze([
  ...canonicalDefinitions.map(({ path: assetPath }) => assetPath),
  ...derivedDefinitions.map(({ path: assetPath }) => assetPath),
  'icono/icono.png',
  'icono/icono-web.png',
  'public/icono.png',
]);

const removedLegacyPaths = Object.freeze([
  'icono/icono.png',
  'icono/icono-web.png',
  'public/icono.png',
]);

const forbiddenSvgPatterns = Object.freeze([
  { label: '<text>', pattern: /<text\b/i },
  { label: '<image>', pattern: /<image\b/i },
  { label: 'href', pattern: /(?:\bxlink:)?href\s*=/i },
  { label: 'data URI', pattern: /data:/i },
  { label: 'script', pattern: /<script\b/i },
  { label: 'remote URL', pattern: /https?:\/\/(?!www\.w3\.org\/2000\/svg)/i },
  { label: 'font', pattern: /font(?:-family|\s*=|\s*:)|\.(?:woff2?|ttf|otf)\b/i },
  { label: 'editor metadata', pattern: /<metadata\b|inkscape:|sodipodi:/i },
  { label: 'comment', pattern: /<!--/i },
]);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const absolute = (relativePath) => path.join(projectRoot, ...relativePath.split('/'));
const readText = (relativePath) => readFile(absolute(relativePath), 'utf8');

async function pathExists(relativePath) {
  try {
    await stat(absolute(relativePath));
    return true;
  } catch {
    return false;
  }
}

function validateSvg(relativePath, source) {
  const violations = forbiddenSvgPatterns
    .filter(({ pattern }) => pattern.test(source))
    .map(({ label }) => label);
  if (!/<title\b[^>]*>[\s\S]*<\/title>/i.test(source)) violations.push('missing <title>');
  if (!/<desc\b[^>]*>[\s\S]*<\/desc>/i.test(source)) violations.push('missing <desc>');
  if (!/viewBox\s*=\s*"[^"]+"/i.test(source)) violations.push('missing explicit viewBox');
  if (violations.length > 0) {
    throw new Error(`${relativePath} failed SVG validation: ${[...new Set(violations)].join(', ')}`);
  }
}

async function getSharpVersion() {
  try {
    const packageSource = await readFile(path.join(projectRoot, 'node_modules', 'sharp', 'package.json'), 'utf8');
    return JSON.parse(packageSource).version;
  } catch {
    return sharp.versions?.sharp || 'unknown';
  }
}

async function renderPng(source, width, height) {
  return sharp(Buffer.from(source, 'utf8'))
    .resize(width, height, {
      fit: 'contain',
      position: 'centre',
      withoutEnlargement: false,
      background: { r: 248, g: 250, b: 252, alpha: 1 },
    })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

async function writeIfChanged(relativePath, content) {
  const filePath = absolute(relativePath);
  try {
    const existing = await readFile(filePath);
    if (Buffer.compare(existing, content) === 0) return false;
  } catch {
    // The output is created below.
  }
  await writeFile(filePath, content);
  return true;
}

async function prepareArtifacts() {
  const canonicalSources = new Map();
  for (const definition of canonicalDefinitions) {
    const source = await readText(definition.path);
    validateSvg(definition.path, source);
    canonicalSources.set(definition.path, source);
  }

  const sharpVersion = await getSharpVersion();
  const artifacts = [];
  for (const definition of derivedDefinitions) {
    const source = canonicalSources.get(definition.canonicalSource);
    const content = definition.format === 'PNG'
      ? await renderPng(source, definition.width, definition.height)
      : Buffer.from(source, 'utf8');
    artifacts.push({
      ...definition,
      content,
      sha256: sha256(content),
      sourceSha256: sha256(Buffer.from(source, 'utf8')),
      generationVersion,
      generatedAt,
      sharpVersion,
    });
  }

  const canonicalManifest = canonicalDefinitions.map((definition) => ({
    path: definition.path,
    format: 'SVG',
    dimensions: { width: definition.width, height: definition.height },
    sha256: sha256(Buffer.from(canonicalSources.get(definition.path), 'utf8')),
    role: definition.role,
  }));

  const manifest = {
    version: generationVersion,
    generatedAt,
    sourceCommit,
    canonicalAssets: canonicalManifest,
    derivedAssets: artifacts.map(({ content, ...artifact }) => ({
      canonicalSource: artifact.canonicalSource,
      sourceSha256: artifact.sourceSha256,
      path: artifact.path,
      dimensions: { width: artifact.width, height: artifact.height },
      format: artifact.format,
      sha256: artifact.sha256,
      generationVersion: artifact.generationVersion,
      generatedAt: artifact.generatedAt,
      sharpVersion: artifact.sharpVersion,
      process: artifact.process,
    })),
    safeArea: {
      mark: 'At least 20% around the central figure',
      pwa: 'At least 20% around the central figure',
    },
    supportedBackgrounds: [
      'Lanzo Navy #14213D',
      'Lanzo Cloud #F8FAFC',
      'Lanzo Slate #334155',
    ],
    trademarkStatus: 'TRADEMARK-RESERVED',
    provenanceStatus: 'AI-ASSISTED / PROJECT-GENERATED; NO THIRD-PARTY SOURCE IDENTIFIED',
    process: {
      generator: 'scripts/generate-brand-assets.mjs',
      deterministic: true,
      sharpVersion,
      sourceRule: 'All PNG variants are rasterized from canonical SVG sources.',
      svgRule: 'Public SVG variants are byte-identical copies of canonical SVG sources.',
    },
  };

  return { artifacts, canonicalSources, manifest };
}

async function verifyLegacyPaths() {
  const remainingPaths = [];
  for (const relativePath of removedLegacyPaths) {
    if (await pathExists(relativePath)) remainingPaths.push(relativePath);
  }
  if (remainingPaths.length > 0) {
    throw new Error(`Removed legacy paths remain in the current tree: ${remainingPaths.join(', ')}`);
  }

  const remaining = [];
  for (const relativePath of assetPathsToAudit) {
    if (!await pathExists(relativePath)) continue;
    const content = await readFile(absolute(relativePath));
    const hash = sha256(content);
    if (legacyHashes.has(hash)) remaining.push(`${relativePath} (${hash})`);
  }
  if (remaining.length > 0) {
    throw new Error(`Legacy asset hashes remain in current asset paths: ${remaining.join(', ')}`);
  }
}

async function checkPngDimensions(artifact) {
  if (artifact.format !== 'PNG') return;
  const metadata = await sharp(artifact.content).metadata();
  if (metadata.width !== artifact.width || metadata.height !== artifact.height) {
    throw new Error(`${artifact.path} has dimensions ${metadata.width}x${metadata.height}; expected ${artifact.width}x${artifact.height}.`);
  }
  if (metadata.hasAlpha && metadata.channels !== 4) {
    throw new Error(`${artifact.path} has unexpected alpha channel metadata.`);
  }
}

async function generate() {
  const { artifacts, manifest } = await prepareArtifacts();
  for (const artifact of artifacts) await writeIfChanged(artifact.path, artifact.content);
  await writeIfChanged(manifestPathToRelative(), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
  console.log(`Generated ${artifacts.length} brand derivatives from ${canonicalDefinitions.length} canonical SVG sources.`);
}

function manifestPathToRelative() {
  return path.relative(projectRoot, manifestPath).replaceAll(path.sep, '/');
}

async function check() {
  const { artifacts, canonicalSources, manifest } = await prepareArtifacts();
  const expectedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
  if (!await pathExists(manifestPathToRelative())) throw new Error('Missing brand/brand-assets.manifest.json.');
  const actualManifest = await readText(manifestPathToRelative());
  if (actualManifest !== expectedManifest) throw new Error('brand-assets.manifest.json is out of date.');

  for (const definition of canonicalDefinitions) {
    if (!canonicalSources.has(definition.path)) throw new Error(`Missing canonical source: ${definition.path}.`);
  }
  for (const artifact of artifacts) {
    if (!await pathExists(artifact.path)) throw new Error(`Missing derived asset: ${artifact.path}.`);
    const actual = await readFile(absolute(artifact.path));
    if (sha256(actual) !== artifact.sha256 || Buffer.compare(actual, artifact.content) !== 0) {
      throw new Error(`${artifact.path} does not match its canonical source.`);
    }
    await checkPngDimensions(artifact);
  }
  await verifyLegacyPaths();
  console.log(`Brand check passed: ${canonicalDefinitions.length} canonical sources, ${artifacts.length} derivatives.`);
}

const checkOnly = process.argv.includes('--check');
const unexpectedArguments = process.argv.slice(2).filter((argument) => argument !== '--check');

if (unexpectedArguments.length > 0) {
  console.error(`Unknown argument: ${unexpectedArguments[0]}`);
  process.exitCode = 1;
} else {
  (checkOnly ? check : generate)().catch((error) => {
    console.error(`Brand asset ${checkOnly ? 'check' : 'generation'} failed: ${error.message}`);
    process.exitCode = 1;
  });
}
