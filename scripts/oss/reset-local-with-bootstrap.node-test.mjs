import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, test } from 'node:test';
import {
  BOOTSTRAP_FILENAME,
  BOOTSTRAP_SOURCE_PATH,
  PRODUCTION_BOOTSTRAP_MIGRATION_PATH,
  cleanupLocalBootstrapOverlay,
  createLocalBootstrapOverlay,
  listSourceMigrationFiles,
  parseRunnerArguments,
  resetLocalWithBootstrap
} from './reset-local-with-bootstrap.mjs';

function createTestParent() {
  return mkdtempSync(join(tmpdir(), 'lanzo-pos-oss-bootstrap-test-'));
}

function cleanupTestParent(testParent) {
  rmSync(testParent, { recursive: true, force: true });
}

describe('OSS local bootstrap reset runner', () => {
  test('rejects every caller-supplied flag, including remote and linked flags', () => {
    assert.deepEqual(parseRunnerArguments([]), { help: false });
    assert.deepEqual(parseRunnerArguments(['--help']), { help: true });
    for (const argv of [
      ['--linked'],
      ['--db-url', 'postgres://example'],
      ['--db-url=postgres://example'],
      ['--password', 'secret'],
      ['--project-ref', 'odlrhijtfyavryeqivaa'],
      ['--project-ref=odlrhijtfyavryeqivaa'],
      ['--profile', 'production'],
      ['--remote'],
      ['--local']
    ]) {
      assert.throws(() => parseRunnerArguments(argv), /forbidden|accepts no arguments/u, argv.join(' '));
    }
  });

  test('creates an isolated overlay and injects the bootstrap at its historical timestamp', () => {
    const testParent = createTestParent();
    let overlay;
    try {
      overlay = createLocalBootstrapOverlay({ temporaryDirectory: testParent });
      const overlayMigrations = readdirSync(overlay.migrationsRoot).sort();
      const bootstrapIndex = overlayMigrations.indexOf(BOOTSTRAP_FILENAME);
      assert.equal(existsSync(PRODUCTION_BOOTSTRAP_MIGRATION_PATH), false);
      assert.equal(bootstrapIndex >= 0, true);
      assert.deepEqual(readFileSync(join(overlay.migrationsRoot, BOOTSTRAP_FILENAME)), readFileSync(BOOTSTRAP_SOURCE_PATH));
      assert.equal(overlayMigrations[bootstrapIndex - 1] < BOOTSTRAP_FILENAME, true);
      assert.equal(overlayMigrations[bootstrapIndex + 1] > BOOTSTRAP_FILENAME, true);
      assert.equal(overlayMigrations.length, listSourceMigrationFiles().length + 1);
      assert.deepEqual(readdirSync(overlay.supabaseRoot).sort(), ['config.toml', 'migrations']);
    } finally {
      if (overlay) cleanupLocalBootstrapOverlay(overlay.root);
      cleanupTestParent(testParent);
    }
  });

  test('executes only a local reset and cleans up the overlay after success', () => {
    let overlayRoot;
    const result = resetLocalWithBootstrap({
      execute(command, args, options) {
        overlayRoot = args.at(-1);
        assert.equal(command, 'supabase');
        assert.deepEqual(args, ['db', 'reset', '--local', '--workdir', overlayRoot]);
        assert.equal(options.cwd, overlayRoot);
        assert.equal(existsSync(join(overlayRoot, 'supabase', 'migrations', BOOTSTRAP_FILENAME)), true);
      }
    });
    assert.match(basename(overlayRoot), /^lanzo-pos-oss-bootstrap-/u);
    assert.equal(result.migrationCount, listSourceMigrationFiles().length + 1);
    assert.equal(existsSync(overlayRoot), false);
  });

  test('cleans up the overlay when the local reset command fails', () => {
    let overlayRoot;
    assert.throws(() => resetLocalWithBootstrap({
      execute(_command, args) {
        overlayRoot = args.at(-1);
        throw new Error('simulated local reset failure');
      }
    }), /simulated local reset failure/u);
    assert.equal(existsSync(overlayRoot), false);
  });

  test('refuses to clean a forged prefixed temporary directory', () => {
    const forgedOverlay = mkdtempSync(join(tmpdir(), 'lanzo-pos-oss-bootstrap-forged-'));
    try {
      assert.throws(() => cleanupLocalBootstrapOverlay(forgedOverlay), /not created by this runner/u);
      assert.equal(existsSync(forgedOverlay), true);
    } finally {
      cleanupTestParent(forgedOverlay);
    }
  });
});
