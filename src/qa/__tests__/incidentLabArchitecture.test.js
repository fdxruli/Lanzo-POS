// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { incidentLabBuildPlugin, incidentLabEnabled, incidentLabInputs } from '../../../scripts/incident-lab-build.mjs';
import { auditIncidentLabBuild } from '../../../scripts/audit-incident-lab-build.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('QA-SAFE build policy with negative controls', () => {
  it.each(['production', 'development', undefined])('cannot enable production injection using VITE flags (%s)', (environment) => {
    const env = { VERCEL_ENV: environment, VITE_INCIDENT_QA_PREVIEW: 'true' };
    expect(incidentLabEnabled(env)).toBe(false);
    expect(incidentLabInputs(env)).toEqual({ index: 'index.html' });
  });
  it('adds a standalone HTML entry only to Preview, and scopes dev middleware to the exact path', () => {
    expect(incidentLabInputs({ VERCEL_ENV: 'preview' })).toHaveProperty('incident-qa', 'incident-qa.html');
    let middleware;
    incidentLabBuildPlugin({}).configureServer({ middlewares: { use: (fn) => { middleware = fn; } } });
    const req = { url: '/__qa/incident-recovery?scenario=financial' };
    const next = vi.fn(); middleware(req, {}, next);
    expect(req.url).toBe('/incident-qa.html'); expect(next).toHaveBeenCalledOnce();
    const regular = { url: '/ventas?qa=true' }; middleware(regular, {}, next);
    expect(regular.url).toBe('/ventas?qa=true');
  });
  it('rejects executable QA modules from a production bundle, even if the route was hidden', () => {
    const plugin = incidentLabBuildPlugin({ VERCEL_ENV: 'production' });
    const context = { error: (message) => { throw new Error(message); } };
    expect(() => plugin.generateBundle.call(context, {}, {
      'innocent.js': { type: 'chunk', fileName: 'innocent.js', modules: { '/project/src/qa/incidentLabAdapters.js': {} } }
    })).toThrow('executable incident QA modules');
  });
  it('rejects a commercial module anywhere in the QA static chunk closure', () => {
    const plugin = incidentLabBuildPlugin({ VERCEL_ENV: 'preview' });
    const context = { error: (message) => { throw new Error(message); }, emitFile: vi.fn() };
    expect(() => plugin.generateBundle.call(context, {}, {
      'qa.js': { type: 'chunk', fileName: 'qa.js', modules: { '/project/src/qa/IncidentLabBoot.jsx': {} }, imports: ['bad.js'] },
      'bad.js': { type: 'chunk', modules: { '/project/src/store/useAppStore.js': {} }, imports: [] }
    })).toThrow('commercial runtime');
    expect(context.emitFile).not.toHaveBeenCalled();
  });
  it('scans actual emitted files, rejecting disguised QA injection markers', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'incident-lab-audit-'));
    try {
      await mkdir(path.join(temp, 'assets'));
      await writeFile(path.join(temp, 'assets/runtime.js'), 'const dangerous="QA_SIMULATED_ACK";');
      await expect(auditIncidentLabBuild(temp)).rejects.toThrow('capability marker');
      await writeFile(path.join(temp, 'assets/runtime.js'), 'const safe=true;');
      expect(await auditIncidentLabBuild(temp)).toMatchObject({ qaArtifacts: 0 });
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
});
