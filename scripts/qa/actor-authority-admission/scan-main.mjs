// Static evidence only. Does not import or execute application modules.
import { parse } from '@babel/parser';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const sha = 'f48aab53634663438a06dc5187fa7e6d17b74fb3';
const files = execFileSync('git', ['ls-tree','-r','--name-only',sha,'--','src'], {encoding:'utf8'})
  .trim().split('\n').filter(p=>/\.(js|jsx)$/.test(p)&&!/(?:__tests__|__test__|\/test\/|\.test\.)/.test(p));
const functions = []; const candidates = []; const parseErrors = [];
const methods = new Set(['transaction','put','add','update','bulkPut','bulkAdd','bulkDelete','delete','clear','modify','rpc','saveData','saveDataSafe']);
for (const path of files) {
  const source = execFileSync('git',['show',`${sha}:${path}`],{encoding:'utf8',maxBuffer:8e6});
  let ast; try { ast=parse(source,{sourceType:'module',plugins:['jsx'],errorRecovery:false}); } catch(e) {parseErrors.push({path,error:e.message});continue;}
  const walk = (node, owner = '<module>', parent = null) => {
    if (!node || typeof node !== 'object') return;
    if (['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression','ObjectMethod','ClassMethod'].includes(node.type)) {
      const name=node.id?.name || node.key?.name || parent?.id?.name || parent?.key?.name || `<callback:${node.loc.start.line}>`;
      owner=name; functions.push({path,name,start:node.loc.start.line,end:node.loc.end.line});
    }
    if (node.type==='CallExpression'||node.type==='OptionalCallExpression') {
      const c=node.callee; const name=c?.property?.name||c?.name;
      if(methods.has(name))candidates.push({path,line:node.loc.start.line,owner,method:name,expression:source.slice(node.start,Math.min(node.end,node.start+200)).replace(/\s+/g,' '),classification:'STATIC_CANDIDATE_NOT_RUNTIME_COVERAGE'});
    }
    for(const [k,v]of Object.entries(node)) if(!['loc','start','end','tokens','comments','errors'].includes(k)) {
      if(Array.isArray(v))for(const child of v)walk(child,owner,node);else if(v&&typeof v==='object')walk(v,owner,node);
    }
  };walk(ast);
}
const out='scripts/qa/actor-authority-admission/evidence';mkdirSync(out,{recursive:true});
writeFileSync(`${out}/main-write-candidates.json`,JSON.stringify({sha,files:files.length,parseErrors,candidates},null,2)+'\n');
if (process.env.AUTHORITY_QA_SOURCE_INDEX) writeFileSync(process.env.AUTHORITY_QA_SOURCE_INDEX,JSON.stringify({sha,functions},null,2)+'\n');
console.log(JSON.stringify({sha,files:files.length,functions:functions.length,candidates:candidates.length,parseErrors}));
