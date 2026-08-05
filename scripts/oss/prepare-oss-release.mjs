import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  MANIFEST_PATH,
  REPO_ROOT,
  clearSafeOutputRoot,
  copyTrackedFiles,
  generateNeutralPlaceholders,
  loadBoundaryManifest,
  applyIdentityTransformations,
  resolveOutputPath,
  sha256File,
  writeBoundaryManifest,
  writeRebrandingNotice
} from './release-boundary.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function assertBaseCommit(manifest) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', manifest.baseCommit, 'HEAD'], { cwd: REPO_ROOT, stdio: 'ignore' });
  } catch {
    throw new Error(`OSS export must be based on ${manifest.baseCommit}; current HEAD is ${head}.`);
  }
  return head;
}

function assertRestrictedAssetBaseline(manifest) {
  for (const asset of manifest.restrictedAssets) {
    if (!existsSync(`${REPO_ROOT}/${asset.path}`)) throw new Error(`Missing restricted asset: ${asset.path}`);
    const actual = sha256File(`${REPO_ROOT}/${asset.path}`);
    if (actual !== asset.sha256) throw new Error(`BLOCKED - restricted official asset baseline drift: ${asset.path}`);
  }
}

async function main() {
  const manifest = loadBoundaryManifest(MANIFEST_PATH);
  const head = assertBaseCommit(manifest);
  assertRestrictedAssetBaseline(manifest);
  const outputRoot = option('--output-root') || manifest.outputRoot;
  const outputPath = resolveOutputPath(outputRoot);
  clearSafeOutputRoot(outputPath);

  const copy = copyTrackedFiles(outputPath, manifest);
  const transformations = applyIdentityTransformations(outputPath, manifest, copy.copied.map(({ path }) => path));
  const placeholders = await generateNeutralPlaceholders(outputPath, manifest);
  writeRebrandingNotice(outputPath, manifest);
  const boundaryPath = writeBoundaryManifest(outputPath, manifest, { transformations, placeholders });

  const result = {
    status: 'OSS SOURCE EXPORT PREPARED',
    baseCommit: manifest.baseCommit,
    head,
    outputRoot: manifest.outputRoot,
    outputPath,
    trackedFilesCopied: copy.copied.length,
    restrictedFilesOmitted: manifest.restrictedAssets.filter((asset) => asset.action === 'omit').map(({ path }) => path),
    placeholders: placeholders.map(({ path, sha256 }) => ({ path, sha256 })),
    transformations: transformations.length,
    boundaryPath
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
