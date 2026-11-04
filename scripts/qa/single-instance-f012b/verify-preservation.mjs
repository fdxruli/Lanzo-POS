import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const baseline='5bfd0693224d92ae8957684bc85bc61ed6cbab90';
const out='scripts/qa/single-instance-f012b/evidence';
const allowed=new Set(['src/components/common/PosApplicationBootstrap.jsx','src/services/supabase.js',
 'src/store/slices/license/licenseAdminActions.js','src/store/slices/license/licenseBackgroundValidationActions.js',
 'src/store/slices/license/licenseBootstrapActions.js']);
const files=[];
for(const line of execFileSync('git',['ls-tree','-r',baseline],{encoding:'utf8'}).trim().split('\n')) {
 const [meta,path]=line.split('\t');
 if(!/^(src\/|public\/|store\/src\/|\.github\/workflows\/|supabase\/|package(?:-lock)?\.json$|vite)/.test(path))continue;
 files.push({path,baseline:meta.split(' ')[2],current:execFileSync('git',['hash-object',path],{encoding:'utf8'}).trim()});
}
const changed=files.filter(f=>f.baseline!==f.current).map(f=>f.path);
assert.deepEqual(new Set(changed),allowed);
writeFileSync(join(out,'source-preservation.json'),JSON.stringify({baseline,checked:files.length,
 unchanged:files.length-changed.length,changed,new_source:['src/services/bootstrap/bootstrapLifecycle.js'],files},null,2));
const counts={},violations=[];
const walk=dir=>readdirSync(dir).flatMap(name=>{const p=join(dir,name);return statSync(p).isDirectory()?walk(p):[p];});
for(const dir of ['dist','store/dist','.vercel/output','store/.vercel/output']) {
 if(!existsSync(dir))continue;
 const paths=walk(dir).filter(p=>/\.(js|html|json)$/.test(p)); counts[dir]=paths.length;
 for(const path of paths) if(/single-instance-f012b|BG-01 concurrent|synthetic-transport|lanzo-pos-administrative-instance|BOOTSTRAP_LIFECYCLE_QUIESCED/.test(readFileSync(path,'utf8')))violations.push(path);
}
assert.deepEqual(violations,[]);
writeFileSync(join(out,'bundle-fixture-audit.json'),JSON.stringify({checked:counts,violations,
 commercial_gate:'NOT_ACTIVATED',main_and_app_unchanged:true},null,2));
console.log(JSON.stringify({checked:files.length,unchanged:files.length-changed.length,changed,counts,violations}));
