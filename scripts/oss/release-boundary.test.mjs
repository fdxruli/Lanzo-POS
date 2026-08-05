import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  MANIFEST_PATH,
  OSS_ROOT,
  REPO_ROOT,
  applyExactTextTransformation,
  assertSafeOutputRoot,
  enumerateFiles,
  generateNeutralPlaceholders,
  loadBoundaryManifest,
  matchesPathPattern,
  outputRelativePath,
  resolveOutputPath,
  sha256File
} from './release-boundary.mjs';
import { auditOssRelease } from './audit-oss-release.mjs';

const manifest = loadBoundaryManifest(MANIFEST_PATH);
const runA = join(OSS_ROOT, 'test-run-a');
const runB = join(OSS_ROOT, 'test-run-b');

function prepare(outputPath) {
  const outputRoot = relative(REPO_ROOT, outputPath).replaceAll('\\', '/');
  execFileSync(process.execPath, ['scripts/oss/prepare-oss-release.mjs', '--output-root', outputRoot], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    timeout: 240_000
  });
}

before(async () => {
  rmSync(runA, { recursive: true, force: true });
  rmSync(runB, { recursive: true, force: true });
  prepare(runA);
  prepare(runB);
  await auditOssRelease({ outputRoot: relative(REPO_ROOT, runA).replaceAll('\\', '/') });
  await auditOssRelease({ outputRoot: relative(REPO_ROOT, runB).replaceAll('\\', '/') });
});

after(() => {
  rmSync(runA, { recursive: true, force: true });
  rmSync(runB, { recursive: true, force: true });
});

describe('release boundary manifest and path security', () => {
  test('validates the single machine-readable manifest', () => {
    assert.equal(manifest.restrictedAssets.length, 9);
    assert.equal(manifest.restrictedAssets.filter((asset) => asset.action === 'omit').length, 5);
    assert.equal(manifest.restrictedAssets.filter((asset) => asset.action === 'replace').length, 4);
    assert.equal(manifest.baseCommit, 'b7c3f2be384d76c9cbb1a2b352aba383de78d718');
  });

  test('confirms the official baseline hashes', () => {
    for (const asset of manifest.restrictedAssets) assert.equal(sha256File(join(REPO_ROOT, asset.path)), asset.sha256, asset.path);
  });

  test('rejects traversal and output outside .oss-release', () => {
    assert.throws(() => assertSafeOutputRoot('.oss-release/../outside'), /inside \.oss-release/u);
    assert.throws(() => assertSafeOutputRoot('../outside'), /inside \.oss-release/u);
    assert.throws(() => assertSafeOutputRoot('C:/outside'), /relative/u);
    assert.throws(() => assertSafeOutputRoot('.'), /inside \.oss-release/u);
  });

  test('recognizes the allowlist glob boundaries', () => {
    assert.equal(matchesPathPattern('src/components/common/__tests__/fixture.test.jsx', '**/__tests__/**'), true);
    assert.equal(matchesPathPattern('docs/OSS-ROADMAP.md', 'docs/**'), true);
    assert.equal(matchesPathPattern('src/App.jsx', '**/__tests__/**'), false);
  });
});

describe('prepared source export', () => {
  test('copies only tracked source files and creates the boundary records', () => {
    assert.equal(existsSync(join(runA, 'OSS_RELEASE_BOUNDARY.json')), true);
    assert.equal(existsSync(join(runA, 'REBRANDING_REQUIRED.md')), true);
    assert.equal(existsSync(join(runA, '.git')), false);
    assert.equal(existsSync(join(runA, 'node_modules')), false);
    assert.equal(enumerateFiles(runA).some((filePath) => outputRelativePath(runA, filePath).startsWith('.env.')), true);
    for (const asset of manifest.restrictedAssets.filter((item) => item.action === 'omit')) assert.equal(existsSync(join(runA, asset.path)), false, asset.path);
  });

  test('replaces all four required consumers with neutral placeholders', () => {
    for (const asset of manifest.restrictedAssets.filter((item) => item.action === 'replace')) {
      const filePath = join(runA, asset.path);
      assert.equal(existsSync(filePath), true, asset.path);
      assert.notEqual(sha256File(filePath), asset.sha256, asset.path);
    }
    assert.match(readFileSync(join(runA, 'REBRANDING_REQUIRED.md'), 'utf8'), /neutral export placeholder/i);
  });

  test('keeps placeholders deterministic and free of C2PA markers', () => {
    for (const asset of manifest.restrictedAssets.filter((item) => item.action === 'replace')) {
      const a = readFileSync(join(runA, asset.path));
      const b = readFileSync(join(runB, asset.path));
      assert.deepEqual(a, b, asset.path);
      assert.equal(a.toString('utf8').toLowerCase().includes('c2pa'), false, asset.path);
    }
  });

  test('neutralizes exact visible identity and retains only classified references', async () => {
    const report = await auditOssRelease({ outputRoot: relative(REPO_ROOT, runA).replaceAll('\\', '/') });
    assert.deepEqual(report.unknownIdentityReferences, []);
    assert.deepEqual(report.officialHashMatches, []);
    assert.equal(report.requiredConsumers.pwaManifest, true);
    assert.equal(report.requiredConsumers.adminFavicon, true);
    assert.equal(report.requiredConsumers.storeFavicon, true);
    assert.equal(report.requiredConsumers.assistantIcon, true);
    assert.deepEqual(report.pr171Matches, []);
  });

  test('fails exact transformations when the expected count changes', () => {
    const rule = { textExpected: 'Lanzo POS', replacement: 'Unbranded POS', mode: 'word' };
    assert.equal(applyExactTextTransformation('Lanzo POS', rule, 1), 'Unbranded POS');
    assert.throws(() => applyExactTextTransformation('Lanzo POS Lanzo POS', rule, 1), /expected 1, got 2/u);
  });

  test('rejects an unknown reference in the candidate output', async () => {
    const target = join(runA, 'unknown-identity.js');
    writeFileSync(target, 'Official Lanzo identity must not be silently introduced.\n', 'utf8');
    await assert.rejects(() => auditOssRelease({ outputRoot: relative(REPO_ROOT, runA).replaceAll('\\', '/') }), /unclassified restricted identity reference/u);
    rmSync(target, { force: true });
  });

  test('resolves PWA, precache source, favicons and AssistantBot paths', () => {
    assert.match(readFileSync(join(runA, 'src/pwa/adminManifest.js'), 'utf8'), /pwa-192x192\.png/u);
    assert.match(readFileSync(join(runA, 'src/pwa/adminManifest.js'), 'utf8'), /pwa-512x512\.png/u);
    assert.match(readFileSync(join(runA, 'index.html'), 'utf8'), /href="\/logIcon\.svg"/u);
    assert.match(readFileSync(join(runA, 'store/index.html'), 'utf8'), /href="\.\.\/public\/logIcon\.svg"/u);
    assert.match(readFileSync(join(runA, 'src/components/common/AssistantBot.jsx'), 'utf8'), /\/boticon\.svg/u);
  });

  test('second prepare execution produces the same complete tree', () => {
    const a = new Map(enumerateFiles(runA).map((filePath) => [outputRelativePath(runA, filePath), sha256File(filePath)]));
    const b = new Map(enumerateFiles(runB).map((filePath) => [outputRelativePath(runB, filePath), sha256File(filePath)]));
    assert.deepEqual([...a.keys()], [...b.keys()]);
    for (const [path, hash] of a) assert.equal(b.get(path), hash, path);
  });
});
