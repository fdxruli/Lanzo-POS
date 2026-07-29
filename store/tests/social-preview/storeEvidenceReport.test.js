import { describe, expect, it } from 'vitest';
import {
  buildEvidenceReport,
} from '../../../scripts/audit-remote-store-deployment.mjs';

const head = 'a'.repeat(40);
const artifact = Object.freeze({
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
  previewHost: 'lanzo-store-git-fixture-team.vercel.app',
  productionModified: false,
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
    canonicalHost: 'lanzo-store-git-fixture-team.vercel.app',
    ogImageHost: 'lanzo-store-git-fixture-team.vercel.app',
  },
  ogImage: { sha256: 'd'.repeat(64) },
  security: { passed: true, scannedResponses: 12, findings: [] },
  failedChecks: [],
});

describe('evidencia controlada de social preview 1.7', () => {
  it('conserva solo campos saneados y bloquea producción', () => {
    const report = buildEvidenceReport({ head, artifact, remote });
    expect(report).toMatchObject({
      schemaVersion: 1,
      phase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.7',
      HEAD: head,
      projectName: 'lanzo-store',
      deploymentType: 'preview',
      deploymentExecuted: true,
      productionModified: false,
      failedChecks: [],
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/<!doctype|<html|authorization|cookie|@example/u);
    expect(serialized).not.toContain('Tienda privada');
    expect(() => buildEvidenceReport({
      head,
      artifact,
      remote: { ...remote, productionModified: true },
    })).toThrow('Production modification');
  });

  it('exige HEAD completo y no incorpora cuerpos remotos aunque se los inyecten', () => {
    expect(() => buildEvidenceReport({ head: 'abc', artifact, remote })).toThrow('full Git HEAD');
    const report = buildEvidenceReport({
      head,
      artifact,
      remote: {
        ...remote,
        requests: [{ ...remote.requests[0], text: '<html>privado</html>' }],
      },
    });
    expect(JSON.stringify(report)).not.toContain('privado');
  });
});
