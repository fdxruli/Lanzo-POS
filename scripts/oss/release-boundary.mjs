import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
export const MANIFEST_PATH = join(SCRIPT_DIR, 'restricted-assets.manifest.json');
export const OSS_ROOT = join(REPO_ROOT, '.oss-release');

const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const SOURCE_ROOTS = ['src/', 'store/api/'];

export function loadBoundaryManifest(manifestPath = MANIFEST_PATH) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  validateManifestShape(manifest);
  return manifest;
}

export function validateManifestShape(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Restricted asset manifest must be an object.');
  if (manifest.schemaVersion !== '1.0.0') throw new Error('Unsupported restricted asset manifest schema.');
  if (!/^[a-f0-9]{40}$/.test(manifest.baseCommit)) throw new Error('Manifest baseCommit must be a full Git SHA.');
  if (!Array.isArray(manifest.restrictedAssets) || manifest.restrictedAssets.length !== 9) {
    throw new Error('Manifest must contain exactly nine restricted assets.');
  }
  const paths = new Set();
  for (const asset of manifest.restrictedAssets) {
    if (!asset.path || paths.has(asset.path)) throw new Error(`Invalid or duplicate restricted path: ${asset.path}`);
    paths.add(asset.path);
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error(`Invalid SHA-256 for ${asset.path}.`);
    if (!['omit', 'replace'].includes(asset.action)) throw new Error(`Invalid action for ${asset.path}.`);
    if (asset.action === 'replace' && !asset.requiredConsumer) {
      throw new Error(`Replacement ${asset.path} must declare a required consumer.`);
    }
  }
  if (!manifest.identityTransformRules?.rules?.length) throw new Error('Manifest identity transform rules are missing.');
  if (!Array.isArray(manifest.identityAllowlist)) throw new Error('Manifest identity allowlist is missing.');
}

function normalizeRelativePath(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//u, '');
}

export function matchesPathPattern(relativePath, pattern) {
  const value = normalizeRelativePath(relativePath);
  const normalizedPattern = normalizeRelativePath(pattern);
  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replaceAll('**', '___DOUBLE_STAR___')
    .replaceAll('*', '[^/]*')
    .replaceAll('___DOUBLE_STAR___', '.*')
    .replaceAll('?', '[^/]');
  return new RegExp(`^${escaped}$`, 'u').test(value);
}

export function assertSafeOutputRoot(outputRoot) {
  if (!outputRoot || typeof outputRoot !== 'string') throw new Error('OSS output root is required.');
  if (isAbsolute(outputRoot)) throw new Error('OSS output root must be relative to the repository.');
  const outputPath = resolve(REPO_ROOT, outputRoot);
  const ossRelative = relative(OSS_ROOT, outputPath);
  if (!ossRelative || ossRelative === '..' || ossRelative.startsWith(`..${sep}`) || isAbsolute(ossRelative)) {
    throw new Error('OSS output root must remain inside .oss-release.');
  }
  if (outputPath === REPO_ROOT || outputPath === resolve(REPO_ROOT, '.git') || outputPath === resolve(REPO_ROOT, '..')) {
    throw new Error('OSS output root cannot be a repository or disk root.');
  }
  ensureDirectoryIsNotSymlink(OSS_ROOT, true);
  ensureDirectoryIsNotSymlink(outputPath, false);
  return outputPath;
}

function ensureDirectoryIsNotSymlink(directoryPath, allowMissing) {
  if (!existsSync(directoryPath)) {
    if (allowMissing) mkdirSync(directoryPath, { recursive: true });
    return;
  }
  const stat = lstatSync(directoryPath);
  if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic-link output directory: ${directoryPath}`);
  if (!stat.isDirectory()) throw new Error(`OSS output path is not a directory: ${directoryPath}`);
}

export function clearSafeOutputRoot(outputPath) {
  const validated = assertSafeOutputRoot(relative(REPO_ROOT, outputPath));
  if (lstatSync(validated, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error('Refusing to clear a symbolic-link output directory.');
  }
  rmSync(validated, { recursive: true, force: true });
  mkdirSync(validated, { recursive: true });
}

export function resolveOutputPath(outputRoot) {
  return assertSafeOutputRoot(outputRoot);
}

function assertInside(parent, child, label) {
  const parentPath = resolve(parent);
  const childPath = resolve(child);
  const childRelative = relative(parentPath, childPath);
  if (!childRelative || childRelative === '..' || childRelative.startsWith(`..${sep}`) || isAbsolute(childRelative)) {
    throw new Error(`${label} escapes its authorized directory.`);
  }
  return childPath;
}

function assertSourcePath(relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (!normalizedPath || normalizedPath.startsWith('../') || normalizedPath.includes('/../') || isAbsolute(normalizedPath)) {
    throw new Error(`Unsafe tracked path: ${relativePath}`);
  }
  return assertInside(REPO_ROOT, join(REPO_ROOT, normalizedPath), 'Tracked source path');
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256File(filePath) {
  return sha256Bytes(readFileSync(filePath));
}

export function trackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT });
  return output.toString('utf8').split('\0').filter(Boolean).map(normalizeRelativePath);
}

function isSecretPath(relativePath) {
  const name = relativePath.split('/').at(-1) || '';
  return (name === '.env' || (name.startsWith('.env.') && name !== '.env.example'))
    || /\.(pem|key|p12|pfx)$/iu.test(name);
}

function restrictedAssetByPath(manifest, relativePath) {
  return manifest.restrictedAssets.find((asset) => asset.path === relativePath);
}

export function copyTrackedFiles(outputPath, manifest) {
  const copied = [];
  const omitted = [];
  for (const relativePath of trackedFiles()) {
    const asset = restrictedAssetByPath(manifest, relativePath);
    if (asset) {
      omitted.push(relativePath);
      continue;
    }
    if (isSecretPath(relativePath)) throw new Error(`Tracked secret-like path cannot enter OSS export: ${relativePath}`);
    const sourcePath = assertSourcePath(relativePath);
    const destinationPath = assertInside(outputPath, join(outputPath, relativePath), 'Export path');
    const sourceStat = lstatSync(sourcePath);
    if (sourceStat.isSymbolicLink()) {
      const linkTarget = resolve(dirname(sourcePath), readlinkSync(sourcePath, 'utf8'));
      assertInside(REPO_ROOT, linkTarget, 'Tracked symbolic link');
    }
    mkdirSync(dirname(destinationPath), { recursive: true });
    writeFileSync(destinationPath, readFileSync(sourcePath));
    copied.push({ path: relativePath, sha256: sha256File(destinationPath), size: sourceStat.size });
  }
  return { copied, omitted };
}

function countLiteral(text, expected) {
  if (!expected) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const index = text.indexOf(expected, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + expected.length;
  }
}

function rulePattern(rule) {
  const escaped = rule.textExpected.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  if (rule.mode === 'word') return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'gu');
  return new RegExp(escaped, 'gu');
}

function countRule(text, rule) {
  return rule.mode === 'literal' ? countLiteral(text, rule.textExpected) : [...text.matchAll(rulePattern(rule))].length;
}

function replaceRule(text, rule) {
  return text.replace(rulePattern(rule), rule.replacement);
}

export function applyExactTextTransformation(text, rule, expectedCount) {
  const actualCount = countRule(text, rule);
  if (actualCount !== expectedCount) {
    throw new Error(`Unexpected identity transformation count for ${rule.textExpected}: expected ${expectedCount}, got ${actualCount}.`);
  }
  return replaceRule(text, rule);
}

function isRuntimeTextPath(relativePath, rules) {
  const normalizedPath = normalizeRelativePath(relativePath);
  const extension = extname(normalizedPath).toLowerCase();
  const underRoot = normalizedPath === 'index.html'
    || normalizedPath === 'store/index.html'
    || SOURCE_ROOTS.some((root) => normalizedPath.startsWith(root));
  if (!underRoot || !TEXT_EXTENSIONS.has(extension)) return false;
  return !(rules.excludedPathPatterns || []).some((pattern) => matchesPathPattern(normalizedPath, pattern));
}

export function applyIdentityTransformations(outputPath, manifest, copiedPaths) {
  const rules = manifest.identityTransformRules;
  const transformations = [];
  for (const relativePath of copiedPaths) {
    if (!isRuntimeTextPath(relativePath, rules)) continue;
    const filePath = assertInside(outputPath, join(outputPath, relativePath), 'Identity transform path');
    let source = readFileSync(filePath, 'utf8');
    for (const rule of rules.rules) {
      const expectedCount = countRule(source, rule);
      if (!expectedCount) continue;
      const transformed = replaceRule(source, rule);
      if (countRule(transformed, rule)) throw new Error(`Identity transform replacement reintroduced ${rule.textExpected} in ${relativePath}.`);
      transformations.push({
        path: relativePath,
        textExpected: rule.textExpected,
        replacement: rule.replacement,
        mode: rule.mode,
        expectedCount,
        classification: 'RUNTIME-VISIBLE OFFICIAL IDENTITY',
        reason: 'Neutralize visible official identity only in the generated OSS copy.'
      });
      source = transformed;
    }
    writeFileSync(filePath, source, 'utf8');
  }
  return transformations;
}

function neutralSvg(label, size, kind) {
  const background = '#F4F5F7';
  const foreground = kind === 'bot' ? '#607D8B' : '#273142';
  const accent = kind === 'bot' ? '#273142' : '#607D8B';
  const fontSize = Math.round(size * 0.24);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * 0.18)}" fill="${background}"/><circle cx="${Math.round(size * 0.5)}" cy="${Math.round(size * 0.42)}" r="${Math.round(size * 0.22)}" fill="${foreground}"/><path d="M ${Math.round(size * 0.27)} ${Math.round(size * 0.72)} H ${Math.round(size * 0.73)}" fill="none" stroke="${accent}" stroke-width="${Math.max(3, Math.round(size * 0.045))}" stroke-linecap="round"/><text x="50%" y="94%" text-anchor="middle" font-family="system-ui, sans-serif" font-size="${fontSize}" font-weight="600" fill="${foreground}">${label}</text></svg>`;
}

async function writeDeterministicPng(filePath, size, label, kind) {
  const svg = neutralSvg(label, size, kind);
  const png = await sharp(Buffer.from(svg, 'utf8'))
    .png({ compressionLevel: 9, adaptiveFiltering: false, effort: 10 })
    .toBuffer();
  writeFileSync(filePath, png);
}

export async function generateNeutralPlaceholders(outputPath, manifest) {
  const placeholderPaths = manifest.restrictedAssets.filter((asset) => asset.action === 'replace').map((asset) => asset.path);
  for (const relativePath of placeholderPaths) {
    const filePath = assertInside(outputPath, join(outputPath, relativePath), 'Placeholder path');
    mkdirSync(dirname(filePath), { recursive: true });
    if (relativePath.endsWith('pwa-192x192.png')) await writeDeterministicPng(filePath, 192, 'POS', 'pwa');
    else if (relativePath.endsWith('pwa-512x512.png')) await writeDeterministicPng(filePath, 512, 'POS', 'pwa');
    else if (relativePath.endsWith('logIcon.svg')) writeFileSync(filePath, neutralSvg('POS', 128, 'logo'), 'utf8');
    else if (relativePath.endsWith('boticon.svg')) writeFileSync(filePath, neutralSvg('AI', 128, 'bot'), 'utf8');
    else throw new Error(`No deterministic placeholder generator for ${relativePath}.`);
  }
  return placeholderPaths.map((relativePath) => ({
    path: relativePath,
    sha256: sha256File(join(outputPath, relativePath)),
    classification: manifest.replacementPolicy.classification
  }));
}

export function writeRebrandingNotice(outputPath, manifest) {
  const notice = `# Rebranding required\n\nThis source-only candidate does not contain the official Lanzo-POS identity.\n\nThe generated icons are neutral export placeholders and are classified as:\n\n\`NEUTRAL EXPORT PLACEHOLDER - NOT OFFICIAL BRAND\`.\n\nDistributors and forks must adopt their own name, identity, logos, icons and visible product labels before redistribution. They must not present this candidate as official Lanzo-POS software.\n\n\`BRAND_ASSETS.md\` continues to describe the reserved official assets and their restricted scope. This candidate does not activate an open-source license for the code, does not create \`LICENSE\`, does not activate AGPL, and does not grant permission over official assets. This notice is not legal advice.\n`;
  writeFileSync(assertInside(outputPath, join(outputPath, 'REBRANDING_REQUIRED.md'), 'Rebranding notice path'), notice, 'utf8');
}

export function writeBoundaryManifest(outputPath, manifest, details) {
  const boundary = {
    schemaVersion: manifest.schemaVersion,
    baseCommit: manifest.baseCommit,
    policy: manifest.policy,
    outputRoot: manifest.outputRoot,
    processVersion: manifest.processVersion,
    officialOmittedAssets: manifest.restrictedAssets.filter((asset) => asset.action === 'omit').map(({ path, sha256 }) => ({ path, sha256 })),
    neutralReplacements: details.placeholders,
    identityTransformations: details.transformations,
    allowlistedReferences: manifest.identityAllowlist,
    tool: 'scripts/oss/prepare-oss-release.mjs',
    audit: { status: 'PENDING' }
  };
  const boundaryPath = assertInside(outputPath, join(outputPath, 'OSS_RELEASE_BOUNDARY.json'), 'Boundary manifest path');
  writeFileSync(boundaryPath, `${JSON.stringify(boundary, null, 2)}\n`, 'utf8');
  return boundaryPath;
}

export function enumerateFiles(rootPath) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in OSS output: ${filePath}`);
      if (entry.isDirectory()) walk(filePath);
      else if (entry.isFile()) files.push(filePath);
      else throw new Error(`Unsupported output filesystem entry: ${filePath}`);
    }
  };
  walk(rootPath);
  return files.sort();
}

export function outputRelativePath(outputPath, filePath) {
  return normalizeRelativePath(relative(outputPath, filePath));
}

export function restrictedAssetBuffers(manifest) {
  return manifest.restrictedAssets.map((asset) => ({
    ...asset,
    bytes: readFileSync(join(REPO_ROOT, asset.path))
  }));
}

export function updateBoundaryAudit(outputPath, report) {
  const boundaryPath = join(outputPath, 'OSS_RELEASE_BOUNDARY.json');
  const boundary = JSON.parse(readFileSync(boundaryPath, 'utf8'));
  boundary.audit = {
    status: report.status,
    omittedPaths: report.omittedPaths,
    replacementPaths: report.replacementPaths,
    officialHashMatches: report.officialHashMatches,
    unknownIdentityReferences: report.unknownIdentityReferences,
    deterministic: report.deterministic
  };
  writeFileSync(boundaryPath, `${JSON.stringify(boundary, null, 2)}\n`, 'utf8');
}

export function classifyIdentityPath(relativePath, manifest) {
  return manifest.identityAllowlist.find((entry) => matchesPathPattern(relativePath, entry.pathPattern)) || null;
}

export function findIdentityTokens(text) {
  const pattern = /Lanzo-POS|Lanzo POS|lanzo-pos|lanzo_pos|LANZO|Lanzo/gu;
  return [...text.matchAll(pattern)].map((match) => match[0]);
}

export function isOfficialProductionPath(relativePath) {
  return relativePath === 'index.html'
    || relativePath === 'vite.config.js'
    || relativePath === 'vite.store.config.js'
    || relativePath === 'vercel.json'
    || relativePath === 'package-lock.json'
    || relativePath === 'LICENSE'
    || relativePath.startsWith('src/')
    || relativePath.startsWith('store/')
    || relativePath.startsWith('supabase/')
    || relativePath.startsWith('.github/');
}
