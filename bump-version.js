#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const packagePath = path.join(rootDir, 'package.json');
const lockPath = path.join(rootDir, 'package-lock.json');
const validBumps = new Set(['major', 'minor', 'patch']);

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const writeJson = (filePath, data) => {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
};

const parseVersion = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) {
    throw new Error(`Version invalida: ${version}. Usa semver, por ejemplo 4.1.0.`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || ''
  };
};

const formatVersion = ({ major, minor, patch, prerelease }) => (
  `${major}.${minor}.${patch}${prerelease ? `-${prerelease}` : ''}`
);

const bumpVersion = (current, type) => {
  const next = parseVersion(current);

  if (type === 'major') {
    next.major += 1;
    next.minor = 0;
    next.patch = 0;
  }

  if (type === 'minor') {
    next.minor += 1;
    next.patch = 0;
  }

  if (type === 'patch') {
    next.patch += 1;
  }

  next.prerelease = '';
  return formatVersion(next);
};

const updateLockVersion = (nextVersion) => {
  if (!fs.existsSync(lockPath)) return;

  const lock = readJson(lockPath);
  lock.version = nextVersion;

  if (lock.packages?.['']) {
    lock.packages[''].version = nextVersion;
  }

  writeJson(lockPath, lock);
};

const setVersion = (nextVersion) => {
  parseVersion(nextVersion);

  const pkg = readJson(packagePath);
  const previousVersion = pkg.version;
  pkg.version = nextVersion;
  writeJson(packagePath, pkg);
  updateLockVersion(nextVersion);

  console.log(`Lanzo POS ${previousVersion} -> ${nextVersion}`);
};

const printStatus = () => {
  const pkg = readJson(packagePath);
  console.log(`Lanzo POS v${pkg.version}`);
  console.log('Fuente de verdad: package.json');
  console.log('Build expone: VITE_APP_VERSION, VITE_BUILD_DATE, VITE_BUILD_COMMIT');
};

const [command = 'status', value] = process.argv.slice(2);
const pkg = readJson(packagePath);

if (command === 'status') {
  printStatus();
} else if (validBumps.has(command)) {
  setVersion(bumpVersion(pkg.version, command));
} else if (command === 'set') {
  if (!value) {
    throw new Error('Indica la version: npm run version:set -- 4.1.0');
  }
  setVersion(value);
} else {
  throw new Error(`Comando desconocido: ${command}. Usa status, patch, minor, major o set.`);
}
