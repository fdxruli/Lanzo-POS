// @vitest-environment node
import {
  chmod,
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildReadinessManifest,
  parseJsonEvidence,
  parseReadinessArguments,
  readJsonEvidence,
  scanSensitiveContent,
  validateArtifactEvidence,
  validateRemoteEvidence,
  verifyReleaseReadiness,
  writeReadinessManifest,
} from '../../../scripts/verify-social-preview-release-readiness.mjs';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const scriptPath = path.join(projectRoot, 'scripts', 'verify-social-preview-release-readiness.mjs');
const runbookPath = path.join(
  projectRoot,
  'docs',
  'runbooks',
  'ECOM.PUBLIC.SOCIAL.PREVIEW.PRODUCTION.md',
);
const head = 'a'.repeat(40);
const configHash = 'b'.repeat(64);
const staticHash = 'c'.repeat(64);
const deploymentHash = 'd'.repeat(64);
const previewHost = 'lanzo-store-git-fixture-team.vercel.app';
const functions = ['/api/og/store', '/api/store-page'];
const bundles = [
  { route: '/api/og/store', runtime: 'nodejs22.x', handler: 'store/api/og/store.js' },
  { route: '/api/store-page', runtime: 'nodejs22.x', handler: 'store/api/store-page.js' },
];
const allTrue = (names) => Object.fromEntries(names.map((name) => [name, true]));
const artifact = {
  phase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.7',
  status: 'PASS',
  target: 'store',
  projectName: 'lanzo-store',
  HEAD: head,
  failedChecks: [],
  deploymentExecuted: false,
  hashes: { outputConfig: configHash, outputStaticTree: staticHash },
  output: { functions },
  functionAudit: { bundles },
  checks: allTrue([
    'artifactMatches',
    'projectLinkMatches',
    'noSecrets',
    'noAdministrativeCode',
    'noPwa',
    'noFonts',
    'noPublicSourceMaps',
    'temporaryWorkspace',
  ]),
  routing: {
    checks: allTrue([
      'dynamicStoreRoute',
      'dynamicDestination',
      'pathSlugExactlyOnce',
      'trackingStatic',
      'assetsNotIntercepted',
      'apiNotIntercepted',
      'immutableAssets',
      'htmlNeverImmutable',
    ]),
  },
  protectedRepository: {
    administrativeConfigUnchanged: true,
    storeConfigUnchanged: true,
    repositoryEnvironmentUnchanged: true,
  },
};
const metadataTagCounts = Object.fromEntries([
  'title',
  'description',
  'canonical',
  'ogTitle',
  'ogDescription',
  'ogUrl',
  'ogImage',
  'ogType',
  'twitterCard',
  'twitterTitle',
  'twitterDescription',
  'twitterImage',
].map((name) => [name, 1]));
const remote = {
  schemaVersion: 1,
  phase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.7',
  status: 'PASS',
  HEAD: head,
  projectName: 'lanzo-store',
  deploymentType: 'preview',
  previewHost,
  deploymentIdHash: deploymentHash,
  artifactHashes: { config: configHash, static: staticHash },
  functions,
  runtimes: bundles.map(({ route, runtime }) => ({ route, runtime })),
  handlers: bundles.map(({ route, handler }) => ({ route, handler })),
  metadataTagCounts,
  canonicalHost: previewHost,
  ogImageHost: previewHost,
  ogImage: { passed: true, width: 1200, height: 630 },
  ogImageSha256: 'e'.repeat(64),
  checks: allTrue([
    'metadataUnique',
    'canonicalConsistent',
    'ogImageConsistent',
    'cachePassed',
    'trackingPassed',
    'hostileQueryPassed',
    'missingStorePassed',
    'invalidSlugPassed',
    'securityPassed',
  ]),
  securityCheckSummary: { passed: true, findings: [] },
  failedChecks: [],
  deploymentCreatedByThisRun: false,
  previewAudited: true,
  productionModified: false,
};

const roots = [];
async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'social-preview-readiness-'));
  roots.push(root);
  return root;
}

async function fixture(overrides = {}) {
  const root = await temporaryRoot();
  const artifactPath = path.join(root, 'artifact.json');
  const remotePath = path.join(root, 'remote.json');
  const outputPath = path.join(root, 'readiness.json');
  await writeFile(artifactPath, JSON.stringify(overrides.artifact || artifact));
  if (overrides.remote !== null) {
    await writeFile(remotePath, JSON.stringify(overrides.remote || remote));
  }
  return {
    artifactAuditPath: artifactPath,
    remoteEvidencePath: remotePath,
    outputPath,
    head,
    ciConclusion: overrides.ciConclusion || 'success',
    ciRunId: '30495443216',
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => {
    await chmod(root, 0o700).catch(() => {});
    const { rm } = await import('node:fs/promises');
    await rm(root, { recursive: true, force: true });
  }));
});

describe('ECOM.PUBLIC.SOCIAL.PREVIEW.1.8 release readiness', () => {
  it('accepts complete, matching evidence', () => {
    const validatedArtifact = validateArtifactEvidence(artifact, head);
    expect(validateRemoteEvidence(remote, head, validatedArtifact)).toMatchObject({
      previewHost,
      deploymentIdHash: deploymentHash,
    });
  });

  it.each([
    ['different artifact HEAD', { ...artifact, HEAD: 'f'.repeat(40) }, 'artifact-head-mismatch'],
    ['artifact BLOCKED', { ...artifact, status: 'BLOCKED' }, 'artifact-audit-not-pass'],
    ['artifact failedChecks', { ...artifact, failedChecks: ['routing'] }, 'artifact-failed-checks'],
    ['missing function', { ...artifact, output: { functions: ['/api/og/store'] } }, 'artifact-functions-invalid'],
    ['additional function', { ...artifact, output: { functions: [...functions, '/api/admin'] } }, 'artifact-functions-invalid'],
    ['duplicated function', { ...artifact, output: { functions: ['/api/og/store', '/api/og/store'] } }, 'artifact-functions-invalid'],
    ['helper function', {
      ...artifact,
      output: { functions: ['/api/_publicPortal', '/api/store-page'] },
    }, 'artifact-functions-invalid'],
    ['invalid runtime', {
      ...artifact,
      functionAudit: { bundles: [{ ...bundles[0], runtime: 'python3.12' }, bundles[1]] },
    }, 'artifact-runtime-invalid'],
    ['missing handler', {
      ...artifact,
      functionAudit: { bundles: [{ ...bundles[0], handler: '' }, bundles[1]] },
    }, 'artifact-handler-invalid'],
    ['invalid config hash', {
      ...artifact,
      hashes: { ...artifact.hashes, outputConfig: 'bad' },
    }, 'artifact-hash-invalid'],
  ])('blocks artifact evidence: %s', (_label, value, reason) => {
    expect(() => validateArtifactEvidence(value, head)).toThrow(expect.objectContaining({ reason }));
  });

  it.each([
    ['remote BLOCKED', { ...remote, status: 'BLOCKED' }, 'remote-evidence-not-pass'],
    ['remote failedChecks', { ...remote, failedChecks: ['cache'] }, 'remote-failed-checks'],
    ['different HEAD', { ...remote, HEAD: 'f'.repeat(40) }, 'remote-head-mismatch'],
    ['different project', { ...remote, projectName: 'lanzo-pos' }, 'remote-project-invalid'],
    ['production host', { ...remote, previewHost: 'lanzo-store.vercel.app' }, 'remote-preview-host-invalid'],
    ['non-Vercel host', { ...remote, previewHost: 'store.example.test' }, 'remote-preview-host-invalid'],
    ['production modified', { ...remote, productionModified: true }, 'remote-production-modified'],
    ['preview not audited', { ...remote, previewAudited: false }, 'remote-preview-not-audited'],
    ['deployment hash absent', { ...remote, deploymentIdHash: null }, 'remote-deployment-hash-invalid'],
    ['metadata failed', {
      ...remote,
      metadataTagCounts: { ...remote.metadataTagCounts, canonical: 2 },
    }, 'remote-metadata-invalid'],
    ['OG image failed', {
      ...remote,
      ogImage: { ...remote.ogImage, width: 1199 },
    }, 'remote-og-image-invalid'],
    ['security failed', {
      ...remote,
      securityCheckSummary: { passed: false, findings: [] },
    }, 'remote-security-failed'],
    ['artifact hash mismatch', {
      ...remote,
      artifactHashes: { ...remote.artifactHashes, static: 'f'.repeat(64) },
    }, 'evidence-artifact-hash-mismatch'],
  ])('blocks remote evidence: %s', (_label, value, reason) => {
    const validatedArtifact = validateArtifactEvidence(artifact, head);
    expect(() => validateRemoteEvidence(value, head, validatedArtifact))
      .toThrow(expect.objectContaining({ reason }));
  });

  it('blocks CI conclusions other than success', () => {
    expect(() => buildReadinessManifest({
      head,
      artifact: validateArtifactEvidence(artifact, head),
      remote: { previewHost, deploymentIdHash: deploymentHash, metadataPassed: true, ogImagePassed: true, securityPassed: true },
      artifactEvidenceSha256: '1'.repeat(64),
      remoteEvidenceSha256: '2'.repeat(64),
      ciConclusion: 'failure',
      ciRunId: '123',
    })).toThrow(expect.objectContaining({ reason: 'ci-not-success' }));
  });

  it('rejects JSON larger than 2 MiB before parsing', async () => {
    const root = await temporaryRoot();
    const filePath = path.join(root, 'large.json');
    await writeFile(filePath, `{"padding":"${'x'.repeat((2 * 1024 * 1024) + 1)}"}`);
    await expect(readJsonEvidence(filePath, 'artifact-audit'))
      .rejects.toMatchObject({ reason: 'artifact-audit-too-large' });
  });

  it('rejects malformed JSON and top-level arrays', () => {
    expect(() => parseJsonEvidence('{', 'artifact-audit'))
      .toThrow(expect.objectContaining({ reason: 'artifact-audit-json-invalid' }));
    expect(() => parseJsonEvidence('[]', 'artifact-audit'))
      .toThrow(expect.objectContaining({ reason: 'artifact-audit-invalid' }));
  });

  it.each([
    ['HTML', { response: '<!doctype html><html>' }, 'html-document'],
    ['synthetic token', { access_token: 'fixture-only' }, 'sensitive-key'],
    ['private key', { note: '-----BEGIN PRIVATE KEY-----' }, 'private-key'],
    ['service role assignment', { note: 'SUPABASE_SERVICE_ROLE=fixture' }, 'service-role-assignment'],
    ['nested sensitive key', { nested: { authorization: 'fixture' } }, 'sensitive-key'],
    ['remote body', { requests: [{ body: 'fixture' }] }, 'sensitive-key'],
  ])('detects sanitized privacy violation: %s', (_label, value, classification) => {
    const [finding] = scanSensitiveContent(value);
    expect(finding).toMatchObject({ classification });
    expect(finding).toHaveProperty('path');
    expect(finding).toHaveProperty('valueLength');
    expect(JSON.stringify(finding)).not.toContain('fixture-only');
  });

  it('allows explicitly sanitized hash and tracking fields', () => {
    expect(scanSensitiveContent({
      deploymentIdHash: 'a'.repeat(64),
      bodySha256: 'b'.repeat(64),
      ogImageSha256: 'c'.repeat(64),
      valueHashes: { title: 'd'.repeat(64) },
      trackingPassed: true,
    })).toEqual([]);
  });

  it('rejects duplicate and unknown CLI arguments', () => {
    expect(() => parseReadinessArguments([
      '--head', head,
      '--head', head,
    ])).toThrow(expect.objectContaining({ reason: 'argument-duplicate' }));
    expect(() => parseReadinessArguments(['--unknown', 'value']))
      .toThrow(expect.objectContaining({ reason: 'arguments-invalid' }));
  });

  it('refuses to overwrite an existing readiness manifest', async () => {
    const root = await temporaryRoot();
    const outputPath = path.join(root, 'readiness.json');
    await writeFile(outputPath, 'existing');
    await expect(writeReadinessManifest(outputPath, { status: 'READY' }))
      .rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(outputPath, 'utf8')).toBe('existing');
  });

  it('uses restrictive file permissions where supported', async () => {
    const root = await temporaryRoot();
    const outputPath = path.join(root, 'readiness.json');
    await writeReadinessManifest(outputPath, { status: 'READY' });
    if (process.platform !== 'win32') expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
  });

  it('creates only the expected sanitized READY manifest fields', async () => {
    const input = await fixture();
    const manifest = await verifyReleaseReadiness(input, { timestamp: '2026-07-29T23:00:00.000Z' });
    expect(manifest).toEqual({
      schemaVersion: 1,
      phase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.8',
      status: 'READY_FOR_MANUAL_APPROVAL',
      timestamp: '2026-07-29T23:00:00.000Z',
      HEAD: head,
      projectName: 'lanzo-store',
      artifactEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      remoteEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      artifactConfigSha256: configHash,
      artifactStaticSha256: staticHash,
      deploymentIdHash: deploymentHash,
      previewHost,
      functions: [...functions].sort(),
      runtimes: expect.any(Array),
      handlers: expect.any(Array),
      routingPassed: true,
      metadataPassed: true,
      ogImagePassed: true,
      securityPassed: true,
      ciWorkflow: 'PR127 Global Comparison',
      ciRunId: '30495443216',
      ciConclusion: 'success',
      productionDeploymentAuthorized: false,
      productionDeploymentExecuted: false,
      readyForManualApproval: true,
      nextPhase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.9',
    });
    const serialized = await readFile(input.outputPath, 'utf8');
    expect(serialized).not.toMatch(/slug|business|title|description|supabase|authorization|cookie/iu);
  });

  it('returns BLOCKED without creating a manifest when remote evidence is absent', async () => {
    const input = await fixture({ remote: null });
    await expect(verifyReleaseReadiness(input))
      .rejects.toMatchObject({ reason: 'remote-evidence-missing' });
    await expect(stat(input.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the verifier process-free and unable to publish', async () => {
    const source = await readFile(scriptPath, 'utf8');
    expect(source).not.toMatch(/node:child_process|child_process|\.spawn\s*\(|\.exec(?:Sync)?\s*\(/u);
    expect(source).not.toMatch(/\bvercel\s+(?:deploy|promote|alias)\b/iu);
    expect(source).not.toMatch(/api\.github\.com|supabase\.co|fetch\s*\(/iu);
    expect(source).not.toMatch(/package(?:-lock)?\.json/iu);
  });

  it('reserves production for 1.9 and requires a new artifact from main', async () => {
    const runbook = await readFile(runbookPath, 'utf8');
    expect(runbook).toMatch(/únicamente en\s+`ECOM\.PUBLIC\.SOCIAL\.PREVIEW\.1\.9`/u);
    expect(runbook).toContain('La minifase 1.8 sólo prepara');
    expect(runbook).toContain('desde `main` después del merge');
    expect(runbook).toMatch(/No se\s+reutiliza el prebuilt de la rama/u);
    expect(runbook).toContain('`lanzo-pos` es un proyecto separado');
    expect(runbook).toMatch(/requieren la\s+instrucción explícita del usuario/u);
  });
});
