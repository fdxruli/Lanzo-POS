import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  MANIFEST_PATH,
  REPO_ROOT,
  classifyIdentityPath,
  enumerateFiles,
  findIdentityTokens,
  loadBoundaryManifest,
  matchesPathPattern,
  outputRelativePath,
  restrictedAssetBuffers,
  resolveOutputPath,
  sha256File,
  updateBoundaryAudit
} from './release-boundary.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function countTransformationText(text, transformation) {
  if (transformation.mode === 'word') {
    const escaped = transformation.textExpected.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return [...text.matchAll(new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'gu'))].length;
  }
  return text.split(transformation.textExpected).length - 1;
}

function assertBaseline(manifest) {
  const drift = [];
  for (const asset of manifest.restrictedAssets) {
    const actual = sha256File(join(REPO_ROOT, asset.path));
    if (actual !== asset.sha256) drift.push({ path: asset.path, expected: asset.sha256, actual });
  }
  if (drift.length) throw new Error(`BLOCKED - restricted official asset baseline drift: ${drift.map(({ path }) => path).join(', ')}`);
  return drift;
}

function assertNoSensitiveFiles(files, outputPath) {
  const violations = [];
  for (const filePath of files) {
    const relativePath = outputRelativePath(outputPath, filePath);
    const name = relativePath.split('/').at(-1) || '';
    if ((name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) || /\.(pem|key|p12|pfx)$/iu.test(name)) {
      violations.push(relativePath);
      continue;
    }
    if (/\/tests?\//u.test(`/${relativePath}`) || /\.test\.|\.spec\./u.test(name) || relativePath.startsWith('scripts/')) continue;
    const bytes = readFileSync(filePath);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(bytes.toString('utf8'))) violations.push(relativePath);
  }
  if (violations.length) throw new Error(`Secret or local file detected in OSS output: ${violations.join(', ')}`);
  return violations;
}

function assertIdentityBoundary(files, outputPath, manifest) {
  const unknown = [];
  const allowlisted = [];
  for (const filePath of files) {
    const relativePath = outputRelativePath(outputPath, filePath);
    const text = readFileSync(filePath).toString('utf8');
    const tokens = findIdentityTokens(text);
    if (!tokens.length) continue;
    const allowlistEntry = classifyIdentityPath(relativePath, manifest);
    if (allowlistEntry) {
      allowlisted.push({ path: relativePath, classification: allowlistEntry.classification, tokens: [...new Set(tokens)] });
    } else {
      unknown.push({ path: relativePath, tokens: [...new Set(tokens)] });
    }
  }
  if (unknown.length) {
    throw new Error(`BLOCKED - unclassified restricted identity reference: ${unknown.map(({ path }) => path).join(', ')}`);
  }
  return { unknown, allowlisted };
}

function assertRequiredConsumers(outputPath, manifest) {
  const source = (relativePath) => readFileSync(join(outputPath, relativePath), 'utf8');
  const index = source('index.html');
  const storeIndex = source('store/index.html');
  const adminManifest = source('src/pwa/adminManifest.js');
  const assistant = source('src/components/common/AssistantBot.jsx');
  const vite = source('vite.config.js');
  const failures = [];
  if (!index.includes('href="/logIcon.svg"')) failures.push('administrative favicon reference');
  if (!storeIndex.includes('href="../public/logIcon.svg"')) failures.push('store favicon reference');
  if (!adminManifest.includes("'/pwa-192x192.png'") || !adminManifest.includes("'/pwa-512x512.png'")) failures.push('PWA manifest icon references');
  if (!assistant.includes('src="/boticon.svg"')) failures.push('AssistantBot icon reference');
  if (!vite.includes("'pwa-192x192.png'") || !vite.includes("'pwa-512x512.png'") || !vite.includes("'logIcon.svg'")) failures.push('admin precache source globs');
  for (const asset of manifest.restrictedAssets.filter((item) => item.action === 'replace')) {
    if (!existsSync(join(outputPath, asset.path))) failures.push(`replacement ${asset.path}`);
  }
  if (failures.length) throw new Error(`Required consumer resolution failed: ${failures.join(', ')}`);
  return { adminFavicon: true, storeFavicon: true, pwaManifest: true, assistantIcon: true, precacheSource: true };
}

async function assertPlaceholders(outputPath, manifest) {
  const failures = [];
  const placeholders = [];
  for (const asset of manifest.restrictedAssets.filter((item) => item.action === 'replace')) {
    const filePath = join(outputPath, asset.path);
    const bytes = readFileSync(filePath);
    const text = bytes.toString('utf8');
    if (/c2pa/iu.test(text)) failures.push(`${asset.path}: C2PA marker`);
    if (sha256File(filePath) === asset.sha256) failures.push(`${asset.path}: official hash reused`);
    if (asset.path.endsWith('.png')) {
      const metadata = await sharp(bytes).metadata();
      const expectedSize = asset.path.includes('192x192') ? 192 : 512;
      if (metadata.width !== expectedSize || metadata.height !== expectedSize) failures.push(`${asset.path}: dimensions`);
      placeholders.push({ path: asset.path, width: metadata.width, height: metadata.height, sha256: sha256File(filePath) });
    } else {
      placeholders.push({ path: asset.path, sha256: sha256File(filePath) });
    }
  }
  if (failures.length) throw new Error(`Neutral placeholder validation failed: ${failures.join(', ')}`);
  return placeholders;
}

function assertRestrictedBytes(files, outputPath, manifest) {
  const matches = [];
  const buffers = restrictedAssetBuffers(manifest);
  for (const filePath of files) {
    const relativePath = outputRelativePath(outputPath, filePath);
    const bytes = readFileSync(filePath);
    const hash = sha256File(filePath);
    const exact = buffers.find((asset) => asset.sha256 === hash);
    if (exact) matches.push({ outputPath: relativePath, restrictedPath: exact.path, kind: 'exact-sha256' });
    if (/\.(?:png|svg|webp|ico|bin|dat|zip)$/iu.test(relativePath)) {
      for (const asset of buffers) {
        if (bytes.length >= asset.bytes.length && bytes.includes(asset.bytes)) {
          matches.push({ outputPath: relativePath, restrictedPath: asset.path, kind: 'embedded-official-bytes' });
        }
      }
    }
  }
  if (matches.length) throw new Error(`Restricted official bytes found in export: ${matches.map(({ outputPath: path }) => path).join(', ')}`);
  return matches;
}

function assertForbiddenPr171(files, outputPath, manifest) {
  const matches = [];
  for (const filePath of files) {
    const relativePath = outputRelativePath(outputPath, filePath);
    if (classifyIdentityPath(relativePath, manifest)?.classification === 'DOCUMENTATION') continue;
    const text = readFileSync(filePath).toString('utf8');
    for (const marker of manifest.forbiddenPr171Markers) {
      if (text.includes(marker)) matches.push({ path: relativePath, marker });
    }
  }
  if (matches.length) throw new Error(`Rejected PR #171 marker found in output: ${matches.map(({ path }) => path).join(', ')}`);
  return matches;
}

function assertTransformationCounts(outputPath, boundary) {
  const failures = [];
  for (const transformation of boundary.identityTransformations) {
    const filePath = join(outputPath, transformation.path);
    if (!existsSync(filePath)) {
      failures.push(`${transformation.path}: missing`);
      continue;
    }
    const remaining = countTransformationText(readFileSync(filePath, 'utf8'), transformation);
    if (remaining !== 0) failures.push(`${transformation.path}: ${transformation.textExpected} remains (${remaining})`);
  }
  if (failures.length) throw new Error(`Identity transformation audit failed: ${failures.join(', ')}`);
  return [];
}

function assertNoVisibleBrandInBuild(buildPath) {
  const failures = [];
  if (!buildPath || !existsSync(buildPath)) return failures;
  for (const filePath of enumerateFiles(buildPath)) {
    const text = readFileSync(filePath).toString('utf8');
    if (/\b(?:Lanzo|LANZO)\b/gu.test(text)) failures.push(filePath);
  }
  if (failures.length) throw new Error(`Visible official identity remains in build output: ${failures.join(', ')}`);
  return failures;
}

export async function auditOssRelease({ outputRoot, adminBuildPath = null, storeBuildPath = null } = {}) {
  const manifest = loadBoundaryManifest(MANIFEST_PATH);
  assertBaseline(manifest);
  const outputPath = resolveOutputPath(outputRoot || manifest.outputRoot);
  if (!existsSync(join(outputPath, 'OSS_RELEASE_BOUNDARY.json'))) throw new Error('Missing OSS_RELEASE_BOUNDARY.json.');
  const boundary = JSON.parse(readFileSync(join(outputPath, 'OSS_RELEASE_BOUNDARY.json'), 'utf8'));
  if (boundary.baseCommit !== manifest.baseCommit || boundary.policy !== manifest.policy) throw new Error('Generated boundary manifest does not match source authority.');
  const files = enumerateFiles(outputPath);
  const outputPaths = new Set(files.map((filePath) => outputRelativePath(outputPath, filePath)));
  const omittedPaths = manifest.restrictedAssets.filter((asset) => asset.action === 'omit' && outputPaths.has(asset.path)).map(({ path }) => path);
  const replacementPaths = manifest.restrictedAssets.filter((asset) => asset.action === 'replace' && !outputPaths.has(asset.path)).map(({ path }) => path);
  if (omittedPaths.length) throw new Error(`Omitted restricted asset was copied: ${omittedPaths.join(', ')}`);
  if (replacementPaths.length) throw new Error(`Required neutral replacement is missing: ${replacementPaths.join(', ')}`);
  const secretViolations = assertNoSensitiveFiles(files, outputPath);
  const requiredConsumers = assertRequiredConsumers(outputPath, manifest);
  const placeholders = await assertPlaceholders(outputPath, manifest);
  const officialHashMatches = assertRestrictedBytes(files, outputPath, manifest);
  const pr171Matches = assertForbiddenPr171(files, outputPath, manifest);
  const identity = assertIdentityBoundary(files, outputPath, manifest);
  const transformationFailures = assertTransformationCounts(outputPath, boundary);
  assertNoVisibleBrandInBuild(adminBuildPath);
  assertNoVisibleBrandInBuild(storeBuildPath);
  const report = {
    status: 'PASS',
    outputRoot: manifest.outputRoot,
    outputPath,
    fileCount: files.length,
    trackedFilesCopied: files.filter((filePath) => !['OSS_RELEASE_BOUNDARY.json', 'REBRANDING_REQUIRED.md', ...manifest.restrictedAssets.filter((asset) => asset.action === 'replace').map(({ path }) => path)].includes(outputRelativePath(outputPath, filePath))).length,
    omittedPaths: manifest.restrictedAssets.filter((asset) => asset.action === 'omit').map(({ path }) => path),
    replacementPaths: manifest.restrictedAssets.filter((asset) => asset.action === 'replace').map(({ path }) => path),
    placeholders,
    officialHashMatches,
    c2pa: 'PASS',
    requiredConsumers,
    unknownIdentityReferences: identity.unknown,
    allowlistedReferences: identity.allowlisted,
    transformationFailures,
    secretViolations,
    pr171Matches,
    deterministic: 'NOT_RUN'
  };
  updateBoundaryAudit(outputPath, report);
  return report;
}

async function main() {
  const report = await auditOssRelease({
    outputRoot: option('--output-root') || undefined,
    adminBuildPath: option('--admin-build'),
    storeBuildPath: option('--store-build')
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
