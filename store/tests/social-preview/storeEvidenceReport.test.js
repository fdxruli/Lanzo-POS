import { describe, expect, it } from 'vitest';
import {
  buildEvidenceReport,
} from '../../../scripts/audit-remote-store-deployment.mjs';

const head = 'a'.repeat(40);
const previewHost = 'lanzo-store-git-fixture-team.vercel.app';
const artifact = Object.freeze({
  status: 'PASS',
  target: 'store',
  failedChecks: [],
  hashes: {
    outputConfig: 'b'.repeat(64),
    outputStaticTree: 'c'.repeat(64),
  },
  output: { functions: ['/api/og/store', '/api/store-page'] },
  functionAudit: {
    bundles: [
      { route: '/api/og/store', runtime: 'nodejs24.x', handler: 'store/api/og/store.js' },
      { route: '/api/store-page', runtime: 'nodejs24.x', handler: 'store/api/store-page.js' },
    ],
  },
  routing: { checks: { compiledStorePage: true, compiledTracking: true } },
});
const remote = Object.freeze({
  status: 'PASS',
  previewHost,
  requests: [
    {
      name: 'store',
      method: 'GET',
      status: 200,
      headers: {
        contentType: 'text/html; charset=utf-8',
        cacheControl: 'public, max-age=0, s-maxage=300',
        xRobotsTag: 'noindex, nofollow, noarchive',
        locationHost: null,
      },
    },
  ],
  metadata: {
    counts: {
      title: 1,
      description: 1,
      canonical: 1,
      ogTitle: 1,
      ogDescription: 1,
      ogUrl: 1,
      ogImage: 1,
      ogType: 1,
      twitterCard: 1,
      twitterTitle: 1,
      twitterDescription: 1,
      twitterImage: 1,
    },
    canonicalHost: previewHost,
    ogImageHost: previewHost,
  },
  ogImage: { sha256: 'd'.repeat(64) },
  security: { passed: true, scannedResponses: 12, findings: [] },
  failedChecks: [],
});

const deployment = Object.freeze({
  executed: true,
  type: 'preview',
  projectName: 'lanzo-store',
  production: false,
  deploymentIdHash: 'e'.repeat(64),
  previewHost,
});

describe('evidencia controlada de social preview 1.7', () => {
  it.each([
    ['artifact BLOCKED', { artifact: { ...artifact, status: 'BLOCKED' } }, 'Artifact audit must be PASS'],
    ['artifact con fallos', { artifact: { ...artifact, failedChecks: ['routing'] } }, 'no failed checks'],
    ['target administrativo', { artifact: { ...artifact, target: 'admin' } }, 'target must be store'],
    ['remote BLOCKED', { remote: { ...remote, status: 'BLOCKED' } }, 'Remote audit must be PASS'],
    ['remote con fallos', { remote: { ...remote, failedChecks: ['cache'] } }, 'no failed checks'],
    ['proyecto distinto', { deployment: { ...deployment, projectName: 'lanzo-pos' } }, 'project must be lanzo-store'],
    ['producción true', { deployment: { ...deployment, production: true } }, 'non-production preview'],
    ['sin evidencia deployment', { deployment: undefined }, 'Deployment evidence is required'],
    ['host productivo', { deployment: { ...deployment, previewHost: 'lanzo-store.vercel.app' } }, 'Production deployments'],
    ['deployment inventado en remote', { remote: { ...remote, deploymentExecuted: true } }, 'must come from deployment evidence'],
  ])('rechaza evidencia no respaldada: %s', (_label, override, message) => {
    expect(() => buildEvidenceReport({
      head,
      artifact: override.artifact ?? artifact,
      remote: override.remote ?? remote,
      deployment: Object.hasOwn(override, 'deployment') ? override.deployment : deployment,
    })).toThrow(message);
  });

  it.each([
    ['preview creada por esta ejecución', true],
    ['preview proporcionada para auditoría', false],
  ])('distingue %s', (_label, executed) => {
    const report = buildEvidenceReport({
      head,
      artifact,
      remote,
      deployment: { ...deployment, executed },
    });
    expect(report).toMatchObject({
      schemaVersion: 1,
      phase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.7',
      evidenceStatus: 'PASS',
      HEAD: head,
      projectName: 'lanzo-store',
      deploymentType: 'preview',
      deploymentExecuted: executed,
      deploymentCreatedByThisRun: executed,
      previewAudited: true,
      productionModified: false,
      failedChecks: [],
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/<!doctype|<html|authorization|cookie|@example/u);
    expect(serialized).not.toContain('Tienda privada');
  });

  it('exige HEAD completo y no incorpora cuerpos remotos', () => {
    expect(() => buildEvidenceReport({
      head: 'abc',
      artifact,
      remote,
      deployment,
    })).toThrow('full Git HEAD');
    const report = buildEvidenceReport({
      head,
      artifact,
      remote: {
        ...remote,
        requests: [{ ...remote.requests[0], text: '<html>privado</html>' }],
      },
      deployment,
    });
    expect(JSON.stringify(report)).not.toContain('privado');
  });
});
