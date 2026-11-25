import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error('POS_SYNC_593_OVERLAY: '+message); };
const FILE = /^(\d{14})_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/;
export const SPEC = Object.freeze({
  count: 366,
  last: '20261123193853',
  versionHash: 'a0f995174d7525828f7ab2bd5596988934756b2bf0f3055f644780d89f64748e',
  remoteOnly: ['20261006224032','20261008030859','20261021045416','20261021061233','20261021061734','20261021062854','20261022062731','20261022063527','20261022070244','20261022135736','20261022181812','20261022182500','20261022183458','20261022184218'],
  excluded: {
    '20261006181758_restaurant_atomic_settlement_3d1.sql': '16de1c605926cf858ca96f9c9b442b8998043053',
    '20261008013643_restaurant_origin_cancel_contract_3d13.sql': 'db9bb67b4e63baaf481adc7ef83415939dc4c57e',
    '20261008180000_create_legal_policy_previews.sql': 'a1c57273ec636582cde933ee9a519e4e539e4349'
  },
  candidates: {
    '20261124183143_pos_sync_transactional_frontier_v1.sql': '5762cfa725c06f45328abfcfe94638a59e93749fe7e456c2faf3638ac5de9da6',
    '20261124220046_pos_consistent_snapshots_v1.sql': 'b9f01c1d63eab86e581ce4f6be5d58670f0bd1eaf63ef6276e577e9b86a6c86b',
    '20261125001528_pos_snapshot_contract_discovery_v1.sql': '0792347ee92995b7631338b166d74cc46482a04602184fa27572284817dc9376'
  }
});
const own = (object, key) => Object.hasOwn(object, key);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const version = name => name.match(FILE)?.[1];
function inventory(directory) {
  const rows = fs.readdirSync(directory, { withFileTypes: true }).map(entry => {
    if (!entry.isFile() || !version(entry.name)) fail('invalid migration entry: '+entry.name);
    return { name: entry.name, version: version(entry.name), sha256: sha(fs.readFileSync(path.join(directory, entry.name))) };
  }).sort((a,b) => a.version.localeCompare(b.version));
  if (new Set(rows.map(r=>r.version)).size !== rows.length) fail('duplicate migration version');
  return rows;
}
export function validate({ historical, canonical, expected, spec = SPEC, gitBlob }) {
  const names = Object.keys(spec.candidates);
  const candidateVersions = names.map(version).sort();
  if (expected !== candidateVersions.join(',')) fail('expected_versions must match the three reviewed versions exactly');
  const versions = historical.map(r=>r.version);
  if (versions.length !== spec.count || versions.at(-1) !== spec.last || sha(versions.join('\n')+'\n') !== spec.versionHash) fail('remote baseline version set changed');
  const remoteSet = new Set(versions), localSet = new Set(canonical.map(r=>r.version));
  if (!same(versions.filter(v=>!localSet.has(v)), spec.remoteOnly)) fail('historical remote-only set changed');
  const pending = canonical.filter(r=>!remoteSet.has(r.version));
  const expectedNames = [...Object.keys(spec.excluded), ...names].sort();
  if (!same(pending.map(r=>r.name).sort(), expectedNames)) fail('canonical pending/excluded set changed');
  for (const row of pending) {
    if (own(spec.candidates,row.name)) {
      if (row.sha256 !== spec.candidates[row.name]) fail('candidate hash mismatch: '+row.name);
    } else if (gitBlob(row.name) !== spec.excluded[row.name]) fail('excluded file changed: '+row.name);
  }
  return names;
}
export function run(command, fetchedDirectory, canonicalDirectory, snapshotPath, expected, spec = SPEC) {
  const fetched = fs.realpathSync(fetchedDirectory), canonical = fs.realpathSync(canonicalDirectory);
  if (fetched === canonical || !path.relative(canonical, fetched).startsWith('..'+path.sep)) fail('overlay must be outside canonical directory');
  const gitBlob = name => execFileSync('git', ['-C',path.resolve(canonical,'../..'),'hash-object','--stdin','--path=supabase/migrations/'+name], { input: fs.readFileSync(path.join(canonical,name)), encoding:'utf8' }).trim();
  const source = inventory(canonical);
  if (command === 'prepare') {
    const historical = inventory(fetched);
    const names = validate({ historical, canonical: source, expected, spec, gitBlob });
    for (const name of names) fs.copyFileSync(path.join(canonical,name),path.join(fetched,name),fs.constants.COPYFILE_EXCL);
    const files = inventory(fetched);
    if (!same(files.filter(r=>!own(spec.candidates,r.name)),historical) || files.length !== historical.length+names.length || names.some(name=>files.find(r=>r.name===name)?.sha256!==spec.candidates[name])) fail('overlay bytes changed');
    fs.writeFileSync(snapshotPath, JSON.stringify({ fetched,canonical,files })+'\n',{flag:'wx',mode:0o600});
    return { historicalCount: historical.length, pending: names };
  }
  if (command !== 'verify') fail('invalid command');
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath,'utf8'));
  const files = inventory(fetched);
  if (snapshot.fetched !== fetched || snapshot.canonical !== canonical || !same(snapshot.files,files)) fail('overlay changed after prepare');
  validate({ historical: files.filter(r=>!own(spec.candidates,r.name)),canonical:source,expected,spec,gitBlob });
  for (const [name,hash] of Object.entries(spec.candidates)) if (files.find(r=>r.name===name)?.sha256!==hash) fail('overlay candidate hash mismatch');
  return { snapshotUnchanged:true,pending:Object.keys(spec.candidates) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(run(...process.argv.slice(2))));
}
