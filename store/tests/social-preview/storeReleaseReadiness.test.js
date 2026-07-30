// @vitest-environment node
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import {
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildEvidenceReport,
} from '../../../scripts/audit-remote-store-deployment.mjs';
import {
  prepareStoreDeployment,
} from '../../../scripts/prepare-store-deployment.mjs';
import {
  buildReadinessManifest,
  parseJsonEvidence,
  parseReadinessArguments,
  readJsonEvidence,
  scanSensitiveContent,
  validateArtifactEvidence,
  validateRemoteEvidence,
  validateProtectedRepositoryEvidence,
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
    storePrebuiltConfigUnchanged: true,
    storePrebuiltConfigPresent: false,
    administrativeProjectLinkUnchanged: true,
    administrativeProjectLinkPresent: false,
    administrativeVercelUnchanged: true,
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
  evidenceStatus: 'PASS',
  HEAD: head,
  projectName: 'lanzo-store',
  deploymentType: 'preview',
  previewHost,
  deploymentIdHash: deploymentHash,
  artifactHashes: { config: configHash, static: staticHash },
  functions,
  runtimes: bundles.map(({ route, runtime }) => ({ route, runtime })),
  handlers: bundles.map(({ route, handler }) => ({ route, handler })),
  routingChecks: artifact.routing.checks,
  httpStatuses: [{ name: 'store', method: 'GET', status: 200 }],
  headerChecks: [{
    name: 'store',
    headers: {
      contentType: 'text/html; charset=utf-8',
      cacheControl: 'public, max-age=0, s-maxage=300',
      xRobotsTag: 'noindex, nofollow, noarchive',
      locationHost: null,
    },
  }],
  metadataTagCounts,
  canonicalHost: previewHost,
  ogImageHost: previewHost,
  ogImage: { passed: true, width: 1200, height: 630, bytes: 32_768 },
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
  deploymentExecuted: false,
  deploymentCreatedByThisRun: false,
  previewAudited: true,
  productionModified: false,
};
const detailedRemoteChecks = [
  'root:static',
  'tienda:static',
  'store:metadata',
  'store:head',
  'api-store:metadata',
  'store-utm:path-authoritative',
  'hostile-single:path-authoritative',
  'hostile-multiple:path-authoritative',
  'tracking:static-fallback',
  'nested:static-fallback',
  'missing-store:generic',
  'missing-api:generic',
  'invalid-api:safe',
  'og:png',
  'og-versioned:png',
  'og:head',
  'asset:immutable',
  'asset:head',
  'security:no-markers',
];
const realisticRemoteAudit = {
  status: 'PASS',
  previewHost,
  requests: [{
    name: 'store',
    method: 'GET',
    status: 200,
    headers: {
      contentType: 'text/html; charset=utf-8',
      cacheControl: 'public, max-age=0, s-maxage=300',
      xRobotsTag: 'noindex, nofollow, noarchive',
      locationHost: null,
    },
  }],
  metadata: {
    counts: metadataTagCounts,
    canonicalHost: previewHost,
    ogImageHost: previewHost,
    effectiveSlug: 'tienda-fixture',
    canonicalPath: '/tienda/tienda-fixture',
    ogUrlPath: '/tienda/tienda-fixture',
  },
  ogImage: {
    png: true,
    passed: true,
    width: 1200,
    height: 630,
    bytes: 32_768,
    sha256: 'e'.repeat(64),
  },
  security: { passed: true, scannedResponses: 12, findings: [] },
  checks: detailedRemoteChecks.map((name) => ({ name, passed: true })),
  failedChecks: [],
};
const realisticDeploymentEvidence = {
  executed: false,
  type: 'preview',
  projectName: 'lanzo-store',
  production: false,
  deploymentIdHash: deploymentHash,
  previewHost,
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
    ['remote BLOCKED', { ...remote, status: 'BLOCKED', evidenceStatus: 'BLOCKED' }, 'remote-evidence-not-pass'],
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
    ['funciones diferentes', {
      ...remote,
      functions: ['/api/og/store'],
    }, 'evidence-functions-mismatch'],
    ['runtime diferente', {
      ...remote,
      runtimes: remote.runtimes.map((item, index) => (
        index === 0 ? { ...item, runtime: 'nodejs24.x' } : item
      )),
    }, 'evidence-bundles-mismatch'],
    ['handler diferente', {
      ...remote,
      handlers: remote.handlers.map((item, index) => (
        index === 0 ? { ...item, handler: 'store/api/store-page.js' } : item
      )),
    }, 'artifact-handler-invalid'],
    ['routing diferente', {
      ...remote,
      routingChecks: { ...remote.routingChecks, dynamicStoreRoute: false },
    }, 'evidence-routing-mismatch'],
  ])('blocks remote evidence: %s', (_label, value, reason) => {
    const validatedArtifact = validateArtifactEvidence(artifact, head);
    expect(() => validateRemoteEvidence(value, head, validatedArtifact))
      .toThrow(expect.objectContaining({ reason }));
  });

  it.each([
    ['status ausente', { ...remote, status: undefined }, 'remote-status-missing'],
    ['evidenceStatus ausente', { ...remote, evidenceStatus: undefined }, 'remote-status-missing'],
    ['status contradictorio', { ...remote, evidenceStatus: 'BLOCKED' }, 'remote-status-contradictory'],
    ['checks ausentes', { ...remote, checks: undefined }, 'remote-check-failed-invalid'],
    ['OG image ausente', { ...remote, ogImage: undefined }, 'remote-og-image-invalid'],
    ['estado de deployment contradictorio', {
      ...remote,
      deploymentExecuted: true,
    }, 'remote-deployment-state-contradictory'],
    ['statuses HTTP ausentes', { ...remote, httpStatuses: undefined }, 'remote-http-statuses-invalid'],
    ['headers ausentes', { ...remote, headerChecks: undefined }, 'remote-header-checks-invalid'],
  ])('bloquea contratos remotos incompletos: %s', (_label, value, reason) => {
    const validatedArtifact = validateArtifactEvidence(artifact, head);
    expect(() => validateRemoteEvidence(value, head, validatedArtifact))
      .toThrow(expect.objectContaining({ reason }));
  });

  it('acepta directamente la evidencia producida por buildEvidenceReport', () => {
    const realRemoteEvidence = buildEvidenceReport({
      head,
      artifact,
      remote: realisticRemoteAudit,
      deployment: realisticDeploymentEvidence,
      timestamp: '2026-07-29T23:00:00.000Z',
    });
    const validatedArtifact = validateArtifactEvidence(artifact, head);
    expect(validateRemoteEvidence(realRemoteEvidence, head, validatedArtifact))
      .toMatchObject({ previewHost, deploymentIdHash: deploymentHash });
  });

  it('valida estados descriptivos false y bloquea campos protegidos desconocidos', () => {
    expect(validateProtectedRepositoryEvidence(artifact.protectedRepository))
      .toMatchObject({
        storePrebuiltConfigPresent: false,
        administrativeProjectLinkPresent: false,
      });
    expect(() => validateProtectedRepositoryEvidence({
      ...artifact.protectedRepository,
      futureBoolean: true,
    })).toThrow(expect.objectContaining({
      reason: 'artifact-repository-integrity-field-invalid',
    }));
    const missingState = { ...artifact.protectedRepository };
    delete missingState.storePrebuiltConfigPresent;
    expect(() => validateProtectedRepositoryEvidence(missingState))
      .toThrow(expect.objectContaining({ reason: 'artifact-repository-state-invalid' }));
  });

  it.each([
    ['wrapper PASS y audit BLOCKED', {
      ...artifact,
      audit: { ...artifact, status: 'BLOCKED' },
      output: artifact.output,
      projectInspection: { projectName: 'lanzo-store' },
    }, 'artifact-status-contradictory'],
    ['functions contradictorias', {
      ...artifact,
      audit: artifact,
      output: { functions: ['/api/og/store'] },
      projectInspection: { projectName: 'lanzo-store' },
    }, 'artifact-functions-contradictory'],
    ['proyecto distinto', {
      ...artifact,
      audit: artifact,
      output: artifact.output,
      projectInspection: { projectName: 'lanzo-pos' },
    }, 'artifact-project-invalid'],
    ['deployment ejecutado', {
      ...artifact,
      audit: artifact,
      output: artifact.output,
      projectInspection: { projectName: 'lanzo-store' },
      deploymentExecuted: true,
    }, 'artifact-deployment-state-invalid'],
  ])('bloquea contradicciones del wrapper: %s', (_label, value, reason) => {
    expect(() => validateArtifactEvidence(value, head))
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

  it('integra preparador real, reporte 1.7 real y gate 1.8 sin procesos externos', async () => {
    const repositoryRoot = await temporaryRoot();
    await mkdir(path.join(repositoryRoot, 'store', 'api', 'og'), { recursive: true });
    await Promise.all([
      writeFile(path.join(repositoryRoot, 'package.json'), '{"name":"fixture"}\n'),
      writeFile(path.join(repositoryRoot, 'package-lock.json'), '{"lockfileVersion":3}\n'),
      writeFile(path.join(repositoryRoot, 'vercel.json'), '{"project":"administrative"}\n'),
      writeFile(path.join(repositoryRoot, 'store', 'vercel.json'), '{"trailingSlash":false}\n'),
      writeFile(path.join(repositoryRoot, 'store', 'api', 'store-page.js'), 'export default {};\n'),
      writeFile(path.join(repositoryRoot, 'store', 'api', 'og', 'store.js'), 'export default {};\n'),
    ]);
    const realArtifactAudit = structuredClone(artifact);
    for (const name of ['HEAD', 'projectName', 'deploymentExecuted', 'protectedRepository']) {
      delete realArtifactAudit[name];
    }
    const commands = [];
    const prepared = await prepareStoreDeployment({
      repositoryRoot,
      preservePassedWorkspace: false,
      headResolver: async ({ repositoryRoot: resolvedRoot }) => {
        expect(resolvedRoot).toBe(repositoryRoot);
        return head;
      },
      npmInvocation: {
        command: 'node-fixture',
        args: ['npm-cli-fixture.js', 'ci', '--no-audit', '--no-fund'],
        options: { shell: false },
      },
      vercelInvocation: {
        command: 'vercel-fixture',
        argsPrefix: [],
        options: { shell: false },
      },
      projectInspection: {
        projectId: 'prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4',
        projectName: 'lanzo-store',
        configuredRootDirectory: 'store',
      },
      commandRunner(command, args, options) {
        commands.push({ command, args: [...args], shell: options.shell });
        const workspaceRoot = options.cwd;
        if (args.includes('build:store:vercel')) {
          const staticRoot = path.join(workspaceRoot, 'store', 'dist');
          mkdirSync(path.join(staticRoot, 'assets'), { recursive: true });
          writeFileSync(
            path.join(staticRoot, 'index.html'),
            '<!doctype html><div id="root"></div><!-- LANZO_SOCIAL_HEAD_START --><!-- LANZO_SOCIAL_HEAD_END --><link href="/assets/index-AbCd1234.css"><script src="/assets/index-ZyXw9876.js"></script>',
          );
          writeFileSync(path.join(staticRoot, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
          writeFileSync(path.join(staticRoot, 'assets', 'index-AbCd1234.css'), 'body{color:#123456}');
          writeFileSync(path.join(staticRoot, 'assets', 'index-ZyXw9876.js'), 'export const store=true;');
          return {};
        }
        if (args.includes('pull')) {
          mkdirSync(path.join(workspaceRoot, '.vercel'), { recursive: true });
          writeFileSync(path.join(workspaceRoot, '.vercel', '.env.production.local'), 'FIXTURE_ONLY=value\n');
          return {};
        }
        if (args.includes('build')) {
          const outputRoot = path.join(workspaceRoot, '.vercel', 'output');
          const functionsRoot = path.join(outputRoot, 'functions');
          mkdirSync(functionsRoot, { recursive: true });
          writeFileSync(path.join(outputRoot, 'config.json'), JSON.stringify({
            version: 3,
            routes: [{ src: '^/(.*)/$', status: 308, headers: { Location: '/$1' } }],
          }));
          for (const relativeRoute of ['api/store-page', 'api/og/store.js']) {
            const bundleRoot = path.join(functionsRoot, `${relativeRoute}.func`);
            const handler = relativeRoute.includes('/og/')
              ? 'store/api/og/store.js'
              : 'store/api/store-page.js';
            mkdirSync(path.join(bundleRoot, path.dirname(handler)), { recursive: true });
            writeFileSync(path.join(bundleRoot, handler), 'export default {};\n');
            writeFileSync(path.join(bundleRoot, '.vc-config.json'), JSON.stringify({
              runtime: 'nodejs22.x',
              handler,
            }));
          }
          return {};
        }
        return {};
      },
      prebuiltAuditor: async () => structuredClone(realArtifactAudit),
    });
    const validatedArtifact = validateArtifactEvidence(prepared, head);
    const realRemoteEvidence = buildEvidenceReport({
      head,
      artifact: prepared.audit,
      remote: realisticRemoteAudit,
      deployment: realisticDeploymentEvidence,
      timestamp: '2026-07-29T23:00:00.000Z',
    });
    expect(validateRemoteEvidence(realRemoteEvidence, head, validatedArtifact))
      .toMatchObject({ previewHost, deploymentIdHash: deploymentHash });

    const evidenceRoot = await temporaryRoot();
    const artifactAuditPath = path.join(evidenceRoot, 'artifact.json');
    const remoteEvidencePath = path.join(evidenceRoot, 'remote.json');
    const outputPath = path.join(evidenceRoot, 'readiness.json');
    await Promise.all([
      writeFile(artifactAuditPath, JSON.stringify(prepared)),
      writeFile(remoteEvidencePath, JSON.stringify(realRemoteEvidence)),
    ]);
    await expect(verifyReleaseReadiness({
      artifactAuditPath,
      remoteEvidencePath,
      outputPath,
      head,
      ciConclusion: 'success',
      ciRunId: '30497905204',
    }, { timestamp: '2026-07-29T23:00:00.000Z' })).resolves.toMatchObject({
      status: 'READY_FOR_MANUAL_APPROVAL',
      HEAD: head,
    });
    expect(commands.every(({ shell }) => shell === false)).toBe(true);
    expect(JSON.stringify(commands)).not.toMatch(/\b(?:deploy|promote|alias)\b/iu);
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
