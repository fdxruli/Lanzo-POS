import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
export const SUPABASE_ROOT = join(REPO_ROOT, 'supabase');
export const SOURCE_MIGRATIONS_DIR = join(SUPABASE_ROOT, 'migrations');
export const SOURCE_CONFIG_PATH = join(SUPABASE_ROOT, 'config.toml');
export const BOOTSTRAP_FILENAME = '20260621000000_oss_bootstrap_license_period_schema.sql';
export const BOOTSTRAP_SOURCE_PATH = join(SUPABASE_ROOT, 'bootstrap', 'oss_bootstrap_license_period_schema.sql');
export const PRODUCTION_BOOTSTRAP_MIGRATION_PATH = join(SOURCE_MIGRATIONS_DIR, BOOTSTRAP_FILENAME);

const OVERLAY_PREFIX = 'lanzo-pos-oss-bootstrap-';
const managedOverlayRoots = new Set();
const MIGRATION_FILENAME = /^\d{14}_.+\.sql$/u;
const REMOTE_OPTIONS = new Set([
  '--linked',
  '--db-url',
  '--password',
  '--project-ref',
  '--project',
  '--profile',
  '--access-token',
  '--token',
  '--remote'
]);

function assertRegularFile(filePath, label) {
  if (!existsSync(filePath)) throw new Error(`${label} is missing: ${filePath}`);
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file: ${filePath}`);
}

function assertDirectory(directoryPath, label) {
  if (!existsSync(directoryPath)) throw new Error(`${label} is missing: ${directoryPath}`);
  const stat = lstatSync(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a real directory: ${directoryPath}`);
}

function assertInside(parentPath, childPath, label) {
  const parent = resolve(parentPath);
  const child = resolve(childPath);
  const childRelative = relative(parent, child);
  if (!childRelative || childRelative === '..' || childRelative.startsWith('..\\') || childRelative.startsWith('../') || isAbsolute(childRelative)) {
    throw new Error(`${label} escapes its authorized temporary directory.`);
  }
  return child;
}

function assertTemporaryDirectory(temporaryDirectory) {
  const systemTemp = resolve(tmpdir());
  const requested = resolve(temporaryDirectory);
  if (requested !== systemTemp) assertInside(systemTemp, requested, 'Overlay parent');
  assertDirectory(requested, 'Overlay parent');
  return requested;
}

function assertManagedOverlay(overlayRoot) {
  const root = resolve(overlayRoot);
  assertInside(resolve(tmpdir()), root, 'Overlay');
  if (!managedOverlayRoots.has(root)) throw new Error('Refusing to clean an overlay that was not created by this runner.');
  const stat = lstatSync(root, { throwIfNoEntry: false });
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Refusing to clean an overlay that is missing, not a directory, or a symbolic link/junction.');
  }
  return root;
}

function copyRegularFile(sourcePath, destinationPath, label) {
  assertRegularFile(sourcePath, label);
  mkdirSync(dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
}

export function listSourceMigrationFiles() {
  assertDirectory(SOURCE_MIGRATIONS_DIR, 'Source migrations directory');
  const migrationFiles = [];
  for (const entry of readdirSync(SOURCE_MIGRATIONS_DIR, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`Migration source must contain only regular files: ${entry.name}`);
    if (!MIGRATION_FILENAME.test(entry.name)) throw new Error(`Unexpected migration filename: ${entry.name}`);
    migrationFiles.push(entry.name);
  }
  if (!migrationFiles.length) throw new Error('No source migrations were found for the local overlay.');
  if (migrationFiles.includes(BOOTSTRAP_FILENAME)) {
    throw new Error(`Bootstrap migration must not remain in the production migration sequence: ${BOOTSTRAP_FILENAME}`);
  }
  return migrationFiles.sort();
}

export function createLocalBootstrapOverlay({ temporaryDirectory = tmpdir() } = {}) {
  const overlayParent = assertTemporaryDirectory(temporaryDirectory);
  const overlayRoot = resolve(mkdtempSync(join(overlayParent, OVERLAY_PREFIX)));
  managedOverlayRoots.add(overlayRoot);
  try {
    const overlaySupabase = join(overlayRoot, 'supabase');
    const overlayMigrations = join(overlaySupabase, 'migrations');
    mkdirSync(overlayMigrations, { recursive: true });
    copyRegularFile(SOURCE_CONFIG_PATH, join(overlaySupabase, 'config.toml'), 'Supabase config');
    for (const filename of listSourceMigrationFiles()) {
      copyRegularFile(join(SOURCE_MIGRATIONS_DIR, filename), join(overlayMigrations, filename), `Migration ${filename}`);
    }
    copyRegularFile(BOOTSTRAP_SOURCE_PATH, join(overlayMigrations, BOOTSTRAP_FILENAME), 'OSS bootstrap migration');
    return {
      root: overlayRoot,
      supabaseRoot: overlaySupabase,
      migrationsRoot: overlayMigrations,
      migrationCount: listSourceMigrationFiles().length + 1
    };
  } catch (error) {
    cleanupLocalBootstrapOverlay(overlayRoot);
    throw error;
  }
}

export function cleanupLocalBootstrapOverlay(overlayRoot) {
  const root = assertManagedOverlay(overlayRoot);
  rmSync(root, { recursive: true, force: false });
  managedOverlayRoots.delete(root);
}

function optionName(argument) {
  return String(argument).split('=', 1)[0];
}

export function parseRunnerArguments(argv) {
  if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== 'string')) {
    throw new Error('Runner arguments must be a string array.');
  }
  if (!argv.length) return { help: false };
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true };
  const remoteOption = argv.find((argument) => REMOTE_OPTIONS.has(optionName(argument)));
  if (remoteOption) {
    throw new Error(`Remote or linked Supabase option is forbidden: ${remoteOption}. This runner only invokes supabase db reset --local.`);
  }
  throw new Error(`This runner accepts no arguments. Received: ${argv.join(' ')}. It only invokes supabase db reset --local.`);
}

export function localResetCommand(overlayRoot) {
  assertManagedOverlay(overlayRoot);
  return ['db', 'reset', '--local', '--workdir', overlayRoot];
}

export function resetLocalWithBootstrap({ execute = execFileSync, temporaryDirectory = tmpdir() } = {}) {
  if (typeof execute !== 'function') throw new Error('The Supabase command executor must be a function.');
  const overlay = createLocalBootstrapOverlay({ temporaryDirectory });
  try {
    execute('supabase', localResetCommand(overlay.root), {
      cwd: overlay.root,
      stdio: 'inherit',
      windowsHide: true
    });
    return { migrationCount: overlay.migrationCount };
  } finally {
    cleanupLocalBootstrapOverlay(overlay.root);
  }
}

export function printUsage() {
  console.log('Usage: npm run oss:db:reset-local');
  console.log('Creates a temporary local-only Supabase overlay, injects the OSS bootstrap migration, and runs supabase db reset --local.');
}

export function main(argv = process.argv.slice(2)) {
  const options = parseRunnerArguments(argv);
  if (options.help) {
    printUsage();
    return;
  }
  const result = resetLocalWithBootstrap();
  console.log(`Local OSS bootstrap reset completed with ${result.migrationCount} migrations.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
