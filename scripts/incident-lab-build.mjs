export const incidentLabEnabled = (env) => env.VERCEL_ENV === 'preview';
export const incidentLabInputs = (env) => incidentLabEnabled(env)
  ? { index: 'index.html', 'incident-qa': 'incident-qa.html' }
  : { index: 'index.html' };

const isQaModule = (id) => /\/src\/(?:qa\/|components\/common\/IncidentRecoveryQaGallery)/.test(id);
export const incidentLabBuildPlugin = (env) => ({
  name: 'incident-lab-isolation',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.split('?')[0] === '/__qa/incident-recovery') req.url = '/incident-qa.html';
      next();
    });
  },
  generateBundle(_options, bundle) {
    if (incidentLabEnabled(env)) {
      const queue = Object.values(bundle).filter((item) => item.type === 'chunk'
        && Object.keys(item.modules).some(isQaModule)).map((item) => item.fileName);
      const visited = new Set();
      while (queue.length) {
        const file = queue.pop();
        if (visited.has(file)) continue;
        visited.add(file);
        const chunk = bundle[file];
        if (chunk?.type !== 'chunk') continue;
        const unsafe = Object.keys(chunk.modules).filter((id) => /\/src\/(?:store\/|services\/(?:db\/|auth\/|sync\/|supabase\.))/.test(id));
        if (unsafe.length) this.error(`QA static bundle closure imports commercial runtime: ${unsafe.join(', ')}`);
        queue.push(...chunk.imports);
      }
      this.emitFile({ type: 'asset', fileName: 'incident-qa-isolation.json', source: JSON.stringify({
        environment: 'preview', staticChunks: [...visited].sort(), commercialRuntimeModules: [],
        transport: 'explicit in-memory adapter; production dynamic transport never invoked'
      }, null, 2) });
      return;
    }
    for (const output of Object.values(bundle)) {
      if (output.type === 'chunk' && Object.keys(output.modules).some(isQaModule)) {
        this.error('Production bundle contains executable incident QA modules');
      }
      if (/incident-qa|IncidentRecoveryQaGallery|incidentLabAdapters|IncidentLabBoot/.test(output.fileName)) {
        this.error('Production bundle contains exclusive incident QA artifacts');
      }
    }
  }
});
