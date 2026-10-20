import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function auditIncidentLabBuild(directory, environment = 'production') {
  const files = await readdir(directory, { recursive: true });
  if (environment === 'preview') {
    const audit = JSON.parse(await readFile(path.join(directory, 'incident-qa-isolation.json'), 'utf8'));
    if (audit.commercialRuntimeModules.length || !files.includes('incident-qa.html')) throw new Error('QA entry or static isolation audit failed');
    return { environment, staticChunks: audit.staticChunks.length, commercialRuntimeModules: 0 };
  }
  const forbiddenFiles = files.filter((file) => /incident-qa|IncidentRecoveryQaGallery|incidentLabAdapters|IncidentLabBoot|LabLoadBoundary/.test(file));
  if (forbiddenFiles.length) throw new Error(`Production QA artifacts: ${forbiddenFiles.join(', ')}`);
  const executable = files.filter((file) => /\.(?:js|html|css)$/.test(file));
  for (const file of executable) {
    const source = await readFile(path.join(directory, file), 'utf8');
    if (/ENTORNO DE PRUEBAS — DATOS FICTICIOS|Provocar error de componente|QA_SIMULATED_ACK|QA-MEMORY-ONLY/.test(source)) {
      throw new Error(`Production QA capability marker in ${file}`);
    }
  }
  return { environment, executableFilesAudited: executable.length, qaArtifacts: 0 };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.info(JSON.stringify(await auditIncidentLabBuild(path.resolve(process.argv[2] || 'dist'), process.argv[3]), null, 2));
}
