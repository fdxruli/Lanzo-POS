// Release packaging derived from the existing R5 fetched-ledger overlay.
// Fetched historical SQL is private, already applied, and never copied to Git.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = /^(\d{14})_([A-Za-z0-9][A-Za-z0-9_-]*)\.sql$/;
const SHA = /^[0-9a-f]{64}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(`PR352_LEDGER_OVERLAY_GUARD: ${message}`); };

// Same individual file fingerprints as R5, compacted into one pinned digest.
export function metadataFingerprint(rows) {
  return sha(rows.slice().sort((a,b)=>a.version.localeCompare(b.version))
    .map(r=>[r.version,r.name,r.bytes,r.sha256].join('|')).join('\n')+'\n');
}

async function regularBytes(file) {
  const s=await lstat(file);
  if (!s.isFile() || s.isSymbolicLink()) fail(`not a regular file: ${path.basename(file)}`);
  return readFile(file);
}

async function inventory(directory) {
  const rows=[];
  for (const item of await readdir(directory,{withFileTypes:true})) {
    const match=item.name.match(FILE);
    if (!item.isFile() || !match) fail(`unexpected fetched entry: ${item.name}`);
    const bytes=await regularBytes(path.join(directory,item.name));
    rows.push({version:match[1],name:match[2],file:item.name,bytes:bytes.length,sha256:sha(bytes)});
  }
  rows.sort((a,b)=>a.version.localeCompare(b.version));
  if (new Set(rows.map(r=>r.version)).size!==rows.length) fail('duplicate fetched version');
  return rows;
}

async function loadManifest(file) {
  const bytes=await regularBytes(file), m=JSON.parse(bytes);
  if (m.schemaVersion!==2 || m.projectRef!=='odlrhijtfyavryeqivaa' || m.cliVersion!=='2.79.0'
    || m.rawSqlIncluded!==false || m.sensitiveValuesIncluded!==false) fail('invalid release manifest');
  if (!Number.isSafeInteger(m.baseline?.count) || m.baseline.count<1 || !SHA.test(m.baseline.metadataSha256)
    || m.baseline.lastVersion!=='20261026214837') fail('invalid pinned baseline');
  if (!Array.isArray(m.candidates) || m.candidates.length!==2
    || m.candidates[0].role!=='archive' || m.candidates[1].role!=='bridge_v1_admin_off') fail('only archive and bridge v1 are allowed');
  const versions=m.candidates.map(c=>c.file.match(FILE)?.[1]);
  if (versions.some(v=>!v || v<=m.baseline.lastVersion) || versions[0]>=versions[1]) fail('candidates must follow 3D.14 in archive/bridge order');
  for (const c of m.candidates) if (!SHA.test(c.sha256) || !Number.isSafeInteger(c.bytes) || c.bytes<1) fail('invalid candidate fingerprint');
  if (!Array.isArray(m.excludedCanonicalFiles) || !Array.isArray(m.historicalRemoteOnly)) fail('missing historical disposition');
  return {m,manifestSha256:sha(bytes)};
}

function assertBaseline(m, rows) {
  if (rows.length!==m.baseline.count || rows.at(-1)?.version!==m.baseline.lastVersion
    || metadataFingerprint(rows)!==m.baseline.metadataSha256) fail('fetched ledger fingerprint/count/head differs from reviewed Production baseline');
}

function assertCandidates(m, rows) {
  const actual=rows.slice(m.baseline.count);
  const expected=m.candidates.map(c=>({file:c.file,bytes:c.bytes,sha256:c.sha256}));
  assert.deepEqual(actual.map(({file,bytes,sha256})=>({file,bytes,sha256})),expected,
    'copied candidates must retain the reviewed bytes');
}

async function verifySource(m, canonicalDirectory, baseline) {
  const baselineVersions=new Set(baseline.map(r=>r.version));
  const candidates=new Map(m.candidates.map(c=>[c.file,c]));
  const excluded=new Map(m.excludedCanonicalFiles.map(c=>[c.file,c]));
  if (candidates.size!==2 || excluded.size!==m.excludedCanonicalFiles.length) fail('duplicate source disposition');
  const seen=new Set(), sourceVersions=new Set();
  const repoRoot=path.resolve(canonicalDirectory,'../..');
  const gitBlob=(file,bytes)=>execFileSync('git',['-C',repoRoot,'hash-object','--stdin',
    '--path=supabase/migrations/'+file],{input:bytes,encoding:'utf8',windowsHide:true}).trim();
  for (const item of await readdir(canonicalDirectory,{withFileTypes:true})) {
    if (!item.name.endsWith('.sql')) continue;
    const match=item.name.match(FILE);
    if (!item.isFile() || !match || sourceVersions.has(match[1])) fail('invalid/duplicate canonical migration');
    sourceVersions.add(match[1]); seen.add(item.name);
    const bytes=await regularBytes(path.join(canonicalDirectory,item.name));
    if (candidates.has(item.name)) {
      const expected=candidates.get(item.name);
      if (bytes.length!==expected.bytes || sha(bytes)!==expected.sha256) fail(`candidate fingerprint mismatch: ${item.name}`);
    } else if (excluded.has(item.name)) {
      // Git applies the repository's existing EOL filter; no SQL is rewritten.
      if (gitBlob(item.name,bytes)!==excluded.get(item.name).gitBlob) fail(`excluded historical file changed: ${item.name}`);
    } else if (!baselineVersions.has(match[1])) fail(`unexpected canonical pending migration: ${item.name}`);
    if (match[1]===m.baseline.lastVersion && gitBlob(item.name,bytes)!==m.threeD14GitBlob) fail('historical 3D.14 changed');
  }
  for (const name of [...candidates.keys(),...excluded.keys()]) if (!seen.has(name)) fail(`missing reviewed source: ${name}`);
  const missing=baseline.filter(r=>!sourceVersions.has(r.version));
  const expected=m.historicalRemoteOnly;
  if (new Set(expected.map(r=>r.version)).size!==expected.length) fail('duplicate historical exception');
  assert.deepEqual(missing.map(r=>({version:r.version,name:r.name,fetchSqlSha256:r.sha256})),expected,
    'only the explicitly verified historical remote-only versions are allowed');
}

export async function validateAndOverlay({manifestPath,fetchedDirectory,canonicalDirectory,snapshotPath,expectedVersions}) {
  const {m,manifestSha256}=await loadManifest(manifestPath);
  const expected=m.candidates.map(c=>c.file.slice(0,14)).join(',');
  if (expectedVersions!==expected) fail(`expected_versions must be exactly ${expected}`);
  const fetchedReal=await realpath(fetchedDirectory), sourceReal=await realpath(canonicalDirectory);
  if (fetchedReal===sourceReal || !path.relative(sourceReal,fetchedReal).startsWith('..')) fail('fetched SQL must be outside canonical migrations');
  const before=await inventory(fetchedDirectory); assertBaseline(m,before);
  await verifySource(m,canonicalDirectory,before);
  for (const c of m.candidates) await copyFile(path.join(canonicalDirectory,c.file),path.join(fetchedDirectory,c.file),constants.COPYFILE_EXCL);
  const files=await inventory(fetchedDirectory);
  assertCandidates(m,files);
  const snapshot={schemaVersion:1,manifestSha256,fetchedReal,sourceReal,files};
  await writeFile(snapshotPath,JSON.stringify(snapshot)+'\n',{flag:'wx',mode:0o600});
  return {historicalFiles:before.length,pending:m.candidates.map(c=>c.file),historicalSqlExecuted:false};
}

export async function verifySnapshot({manifestPath,fetchedDirectory,canonicalDirectory,snapshotPath}) {
  const {m,manifestSha256}=await loadManifest(manifestPath);
  const snapshot=JSON.parse(await regularBytes(snapshotPath));
  assert.equal(snapshot.schemaVersion,1); assert.equal(snapshot.manifestSha256,manifestSha256,'manifest changed after validation');
  assert.equal(await realpath(fetchedDirectory),snapshot.fetchedReal);
  assert.equal(await realpath(canonicalDirectory),snapshot.sourceReal);
  const files=await inventory(fetchedDirectory);
  assert.deepEqual(files,snapshot.files,'overlay changed after validation');
  assertBaseline(m,files.slice(0,m.baseline.count));
  assertCandidates(m,files);
  await verifySource(m,canonicalDirectory,files.slice(0,m.baseline.count));
  return {snapshotUnchanged:true,pendingFiles:m.candidates.length};
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [command,manifestPath,fetchedDirectory,canonicalDirectory,snapshotPath,expectedVersions]=process.argv.slice(2);
  const args={manifestPath,fetchedDirectory,canonicalDirectory,snapshotPath,expectedVersions};
  if (!['prepare','verify'].includes(command) || !manifestPath || !snapshotPath || !canonicalDirectory || !fetchedDirectory) fail('usage: prepare|verify manifest fetched canonical snapshot [expected_versions]');
  const result=await (command==='prepare'?validateAndOverlay(args):verifySnapshot(args));
  process.stdout.write(JSON.stringify(result)+'\n');
}
