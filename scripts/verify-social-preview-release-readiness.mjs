/**
 * Read-only release-readiness gate for ECOM.PUBLIC.SOCIAL.PREVIEW.1.8.
 *
 * This module only reads two local JSON evidence files and creates one local,
 * sanitized readiness manifest. It never invokes external processes or APIs.
 */
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_STRING_LENGTH = 16_384;
const MAX_DEPTH = 40;
const MAX_NODES = 50_000;
const EXPECTED_FUNCTIONS = Object.freeze(['/api/og/store', '/api/store-page']);
const EXPECTED_METADATA = Object.freeze([
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
]);
const REQUIRED_ARTIFACT_CHECKS = Object.freeze([
  'artifactMatches',
  'projectLinkMatches',
  'noSecrets',
  'noAdministrativeCode',
  'noPwa',
  'noFonts',
  'noPublicSourceMaps',
  'temporaryWorkspace',
]);
const REQUIRED_ROUTING_CHECKS = Object.freeze([
  'dynamicStoreRoute',
  'dynamicDestination',
  'pathSlugExactlyOnce',
  'trackingStatic',
  'assetsNotIntercepted',
  'apiNotIntercepted',
  'immutableAssets',
  'htmlNeverImmutable',
]);
const REQUIRED_REMOTE_CHECKS = Object.freeze([
  'metadataUnique',
  'canonicalConsistent',
  'ogImageConsistent',
  'cachePassed',
  'trackingPassed',
  'hostileQueryPassed',
  'missingStorePassed',
  'invalidSlugPassed',
  'securityPassed',
]);
const FORBIDDEN_KEYS = new Set([
  'authorization',
  'cookie',
  'setcookie',
  'token',
  'accesstoken',
  'refreshtoken',
  'servicerole',
  'secret',
  'password',
  'privatekey',
  'html',
  'body',
  'rawbytes',
  'environment',
  'env',
]);
const ALLOWED_SANITIZED_KEYS = new Set([
  'deploymentidhash',
  'bodysha256',
  'ogimagesha256',
  'valuehashes',
  'trackingpassed',
  'hostilequerypassed',
  'trackingstatic',
]);
const PRODUCTION_HOSTS = new Set(['lanzo-store.vercel.app']);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const normalizeKey = (value) => value.replace(/[^a-z0-9]/giu, '').toLowerCase();
const isPlainObject = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
);
const isSha40 = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
const isSha64 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

export class ReadinessError extends Error {
  constructor(reason, gate, message = reason) {
    super(message);
    this.name = 'ReadinessError';
    this.reason = reason;
    this.gate = gate;
  }
}

function fail(reason, gate, message) {
  throw new ReadinessError(reason, gate, message);
}

function assertPlainObject(value, label, gate) {
  if (!isPlainObject(value)) fail(`${label}-invalid`, gate, `${label} must be an object.`);
  return value;
}

function sensitiveValueClassification(value) {
  const lower = value.toLowerCase();
  if (lower.includes('<!doctype') || /<(?:html|head|body)\b/iu.test(value)) return 'html-document';
  if (value.includes('-----BEGIN PRIVATE KEY-----')) return 'private-key';
  if (/\bsb_secret_[a-z0-9_-]+/iu.test(value)) return 'supabase-secret';
  if (/\bghp_[a-z0-9]+/iu.test(value)) return 'github-token';
  if (/\bgithub_pat_[a-z0-9_]+/iu.test(value)) return 'github-token';
  if (/\bvcp_[a-z0-9_-]+/iu.test(value)) return 'vercel-token';
  if (/SUPABASE_SERVICE_ROLE\s*=/iu.test(value)) return 'service-role-assignment';
  for (const candidate of value.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu) || []) {
    try {
      const payload = JSON.parse(Buffer.from(candidate.split('.')[1], 'base64url').toString('utf8'));
      if (payload?.role === 'service_role') return 'service-role-jwt';
    } catch {
      // A malformed token-shaped value is handled by the other scanners.
    }
  }
  return null;
}

export function scanSensitiveContent(value) {
  const findings = [];
  let nodes = 0;
  const visit = (current, currentPath, depth) => {
    nodes += 1;
    if (nodes > MAX_NODES || depth > MAX_DEPTH) {
      fail('evidence-structure-too-large', 'privacy', 'Evidence structure exceeds safety limits.');
    }
    if (typeof current === 'string') {
      if (current.length > MAX_STRING_LENGTH) {
        findings.push({ path: currentPath, classification: 'oversized-string', valueLength: current.length });
        return;
      }
      const classification = sensitiveValueClassification(current);
      if (classification) findings.push({ path: currentPath, classification, valueLength: current.length });
      return;
    }
    if (typeof current === 'number' && !Number.isFinite(current)) {
      findings.push({ path: currentPath, classification: 'non-finite-number', valueLength: 0 });
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${currentPath}[${index}]`, depth + 1));
      return;
    }
    if (current && typeof current === 'object') {
      for (const [key, item] of Object.entries(current)) {
        const normalized = normalizeKey(key);
        const itemPath = currentPath ? `${currentPath}.${key}` : key;
        if (
          ['__proto__', 'prototype', 'constructor'].includes(key)
          || (FORBIDDEN_KEYS.has(normalized) && !ALLOWED_SANITIZED_KEYS.has(normalized))
        ) {
          findings.push({
            path: itemPath,
            classification: 'sensitive-key',
            valueLength: typeof item === 'string' ? item.length : 0,
          });
        } else {
          visit(item, itemPath, depth + 1);
        }
      }
    }
  };
  visit(value, '$', 0);
  return Object.freeze(findings);
}

export function parseJsonEvidence(source, label = 'evidence') {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail(`${label}-json-invalid`, label, `${label} JSON is invalid.`);
  }
  assertPlainObject(parsed, label, label);
  const findings = scanSensitiveContent(parsed);
  if (findings.length > 0) {
    const first = findings[0];
    const error = new ReadinessError(`${label}-sensitive-content`, 'privacy', 'Sensitive content detected.');
    error.finding = first;
    throw error;
  }
  return parsed;
}

export async function readJsonEvidence(filePath, label) {
  let metadata;
  try {
    metadata = await stat(filePath);
  } catch {
    fail(`${label}-missing`, label, `${label} is missing.`);
  }
  if (!metadata.isFile()) fail(`${label}-invalid`, label, `${label} must be a file.`);
  if (metadata.size > MAX_JSON_BYTES) fail(`${label}-too-large`, label, `${label} exceeds 2 MiB.`);
  const bytes = await readFile(filePath);
  return Object.freeze({
    bytes,
    sha256: sha256(bytes),
    value: parseJsonEvidence(bytes.toString('utf8'), label),
  });
}

export function parseReadinessArguments(argv = process.argv.slice(2)) {
  const allowed = new Set([
    '--artifact-audit',
    '--remote-evidence',
    '--head',
    '--ci-conclusion',
    '--ci-run-id',
    '--output',
  ]);
  if (argv.length % 2 !== 0) fail('arguments-invalid', 'arguments', 'Arguments must be flag/value pairs.');
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || typeof value !== 'string' || value.startsWith('--')) {
      fail('arguments-invalid', 'arguments', 'Unknown argument or missing value.');
    }
    if (Object.hasOwn(values, flag)) fail('argument-duplicate', 'arguments', 'Duplicate argument.');
    values[flag] = value;
  }
  for (const flag of allowed) {
    if (!values[flag]) fail('argument-missing', 'arguments', 'All readiness arguments are required.');
  }
  if (!isSha40(values['--head'])) fail('head-invalid', 'head', 'A full lowercase Git HEAD is required.');
  if (!/^\d+$/u.test(values['--ci-run-id'])) fail('ci-run-id-invalid', 'ci', 'CI run ID must be numeric.');
  return Object.freeze({
    artifactAuditPath: path.resolve(values['--artifact-audit']),
    remoteEvidencePath: path.resolve(values['--remote-evidence']),
    head: values['--head'],
    ciConclusion: values['--ci-conclusion'],
    ciRunId: values['--ci-run-id'],
    outputPath: path.resolve(values['--output']),
  });
}

function normalizedArtifact(raw) {
  if (isPlainObject(raw.audit)) {
    return {
      ...raw.audit,
      HEAD: raw.HEAD,
      deploymentExecuted: raw.deploymentExecuted,
      protectedRepository: raw.protectedRepository,
      projectName: raw.projectInspection?.projectName,
    };
  }
  return raw;
}

function assertAllTrue(object, required, reason, gate) {
  assertPlainObject(object, reason, gate);
  for (const name of required) {
    if (object[name] !== true) fail(reason, gate, `${gate} check did not pass.`);
  }
  for (const passed of Object.values(object)) {
    if (typeof passed === 'boolean' && !passed) fail(reason, gate, `${gate} contains a failed check.`);
  }
}

function canonicalBundles(artifact) {
  const bundles = artifact.functionAudit?.bundles;
  if (!Array.isArray(bundles) || bundles.length !== EXPECTED_FUNCTIONS.length) {
    fail('artifact-functions-invalid', 'functions', 'Exactly two function bundles are required.');
  }
  return bundles.map((bundle) => {
    assertPlainObject(bundle, 'function-bundle', 'functions');
    const route = bundle.route;
    const runtime = bundle.runtime;
    const handler = String(bundle.handler || '').replaceAll('\\', '/');
    if (!EXPECTED_FUNCTIONS.includes(route)) fail('artifact-functions-invalid', 'functions', 'Unexpected function route.');
    if (!/^nodejs(?:20|22|24)\.x$/u.test(runtime || '')) {
      fail('artifact-runtime-invalid', 'functions', 'Function runtime is invalid.');
    }
    const expectedHandler = route === '/api/og/store'
      ? /(?:^|\/)store\/api\/og\/store\.js$/u
      : /(?:^|\/)store\/api\/store-page\.js$/u;
    if (!expectedHandler.test(handler)) fail('artifact-handler-invalid', 'functions', 'Function handler is invalid.');
    if (/(?:^|\/)_.*\.js$/u.test(handler) || /admin/iu.test(handler)) {
      fail('artifact-handler-invalid', 'functions', 'Helper or administrative handler is forbidden.');
    }
    return Object.freeze({ route, runtime, handler });
  }).sort((left, right) => left.route.localeCompare(right.route));
}

export function validateArtifactEvidence(raw, expectedHead) {
  const artifact = normalizedArtifact(assertPlainObject(raw, 'artifact-evidence', 'artifact'));
  if (artifact.status !== 'PASS' || artifact.target !== 'store') {
    fail('artifact-audit-not-pass', 'artifact', 'Artifact audit must be PASS for store.');
  }
  if (artifact.projectName !== 'lanzo-store') {
    fail('artifact-project-invalid', 'artifact', 'Artifact audit must target lanzo-store.');
  }
  if (!Array.isArray(artifact.failedChecks) || artifact.failedChecks.length !== 0) {
    fail('artifact-failed-checks', 'artifact', 'Artifact audit contains failed checks.');
  }
  if (artifact.deploymentExecuted !== false) {
    fail('artifact-deployment-state-invalid', 'production', 'Artifact evidence must prove no deployment executed.');
  }
  if (!isSha40(artifact.HEAD) || artifact.HEAD !== expectedHead) {
    fail('artifact-head-mismatch', 'head', 'Artifact HEAD does not match.');
  }
  if (!isSha64(artifact.hashes?.outputConfig) || !isSha64(artifact.hashes?.outputStaticTree)) {
    fail('artifact-hash-invalid', 'artifact', 'Artifact hashes are invalid.');
  }
  if (
    !Array.isArray(artifact.output?.functions)
    || artifact.output.functions.length !== EXPECTED_FUNCTIONS.length
    || JSON.stringify([...artifact.output.functions].sort()) !== JSON.stringify([...EXPECTED_FUNCTIONS].sort())
    || new Set(artifact.output.functions).size !== EXPECTED_FUNCTIONS.length
  ) {
    fail('artifact-functions-invalid', 'functions', 'Artifact functions must match the exact inventory.');
  }
  const bundles = canonicalBundles(artifact);
  assertAllTrue(artifact.checks, REQUIRED_ARTIFACT_CHECKS, 'artifact-check-failed', 'artifact');
  assertAllTrue(artifact.routing?.checks, REQUIRED_ROUTING_CHECKS, 'artifact-routing-failed', 'routing');
  assertAllTrue(
    artifact.protectedRepository,
    Object.keys(artifact.protectedRepository || {}),
    'artifact-repository-integrity-failed',
    'artifact',
  );
  if (Object.keys(artifact.protectedRepository || {}).length === 0) {
    fail('artifact-repository-integrity-missing', 'artifact', 'Protected repository evidence is required.');
  }
  return Object.freeze({
    HEAD: artifact.HEAD,
    projectName: artifact.projectName,
    configSha256: artifact.hashes.outputConfig,
    staticSha256: artifact.hashes.outputStaticTree,
    functions: Object.freeze([...artifact.output.functions].sort()),
    bundles: Object.freeze(bundles),
  });
}

function validatePreviewHost(value) {
  let url;
  try {
    url = new URL(`https://${value}`);
  } catch {
    fail('remote-preview-host-invalid', 'remote', 'Preview host is invalid.');
  }
  if (
    typeof value !== 'string'
    || value !== url.hostname
    || !url.hostname.endsWith('.vercel.app')
    || url.hostname === 'vercel.app'
    || url.username
    || url.password
    || url.port
    || url.pathname !== '/'
    || url.search
    || url.hash
    || PRODUCTION_HOSTS.has(url.hostname)
  ) {
    fail('remote-preview-host-invalid', 'remote', 'Only a non-production Vercel preview host is accepted.');
  }
  return url.hostname;
}

function normalizedEvidenceStatus(remote) {
  if (remote.status && remote.evidenceStatus && remote.status !== remote.evidenceStatus) {
    fail('remote-status-contradictory', 'remote', 'Remote status fields contradict each other.');
  }
  return remote.status || remote.evidenceStatus;
}

function sameBundles(left, right) {
  return JSON.stringify(left.map(({ route, runtime, handler }) => ({ route, runtime, handler })))
    === JSON.stringify(right.map(({ route, runtime, handler }) => ({ route, runtime, handler })));
}

export function validateRemoteEvidence(remote, expectedHead, artifact) {
  assertPlainObject(remote, 'remote-evidence', 'remote');
  if (remote.phase !== 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.7' || normalizedEvidenceStatus(remote) !== 'PASS') {
    fail('remote-evidence-not-pass', 'remote', 'Remote evidence 1.7 must be PASS.');
  }
  if (!Array.isArray(remote.failedChecks) || remote.failedChecks.length !== 0) {
    fail('remote-failed-checks', 'remote', 'Remote evidence contains failed checks.');
  }
  if (!isSha40(remote.HEAD) || remote.HEAD !== expectedHead || remote.HEAD !== artifact.HEAD) {
    fail('remote-head-mismatch', 'head', 'Remote HEAD does not match.');
  }
  if (remote.projectName !== 'lanzo-store' || remote.deploymentType !== 'preview') {
    fail('remote-project-invalid', 'remote', 'Remote evidence must target a lanzo-store preview.');
  }
  if (remote.previewAudited !== true) fail('remote-preview-not-audited', 'remote', 'Preview audit is required.');
  if (remote.productionModified !== false) fail('remote-production-modified', 'production', 'Production must be unchanged.');
  if (typeof remote.deploymentCreatedByThisRun !== 'boolean') {
    fail('remote-deployment-origin-invalid', 'remote', 'Deployment origin must be explicit.');
  }
  const previewHost = validatePreviewHost(remote.previewHost);
  if (!isSha64(remote.deploymentIdHash)) {
    fail('remote-deployment-hash-invalid', 'remote', 'Deployment hash is required.');
  }
  if (
    remote.artifactHashes?.config !== artifact.configSha256
    || remote.artifactHashes?.static !== artifact.staticSha256
  ) {
    fail('evidence-artifact-hash-mismatch', 'head', 'Artifact hashes do not match remote evidence.');
  }
  if (
    !Array.isArray(remote.functions)
    || JSON.stringify([...remote.functions].sort()) !== JSON.stringify(artifact.functions)
  ) {
    fail('evidence-functions-mismatch', 'functions', 'Function inventories do not match.');
  }
  const remoteBundles = canonicalBundles({
    functionAudit: {
      bundles: (remote.runtimes || []).map((item) => ({
        ...item,
        handler: remote.handlers?.find((candidate) => candidate.route === item.route)?.handler,
      })),
    },
  });
  if (!sameBundles(remoteBundles, artifact.bundles)) {
    fail('evidence-bundles-mismatch', 'functions', 'Function runtimes or handlers do not match.');
  }
  assertPlainObject(remote.metadataTagCounts, 'metadata-counts', 'metadata');
  for (const name of EXPECTED_METADATA) {
    if (remote.metadataTagCounts[name] !== 1) {
      fail('remote-metadata-invalid', 'metadata', 'Remote metadata must be unique.');
    }
  }
  if (remote.canonicalHost !== previewHost || remote.ogImageHost !== previewHost) {
    fail('remote-host-consistency-failed', 'metadata', 'Canonical and OG image hosts must match the preview.');
  }
  if (
    remote.ogImage?.passed !== true
    || remote.ogImage?.width !== 1200
    || remote.ogImage?.height !== 630
    || !isSha64(remote.ogImageSha256)
  ) {
    fail('remote-og-image-invalid', 'metadata', 'Remote OG image evidence is invalid.');
  }
  assertAllTrue(remote.checks, REQUIRED_REMOTE_CHECKS, 'remote-check-failed', 'remote');
  if (remote.securityCheckSummary?.passed !== true || (remote.securityCheckSummary.findings || []).length !== 0) {
    fail('remote-security-failed', 'privacy', 'Remote security evidence failed.');
  }
  return Object.freeze({
    previewHost,
    deploymentIdHash: remote.deploymentIdHash,
    metadataPassed: true,
    ogImagePassed: true,
    securityPassed: true,
  });
}

export function buildReadinessManifest({
  head,
  artifact,
  remote,
  artifactEvidenceSha256,
  remoteEvidenceSha256,
  ciConclusion,
  ciRunId,
  timestamp = new Date().toISOString(),
}) {
  if (ciConclusion !== 'success') fail('ci-not-success', 'ci', 'Global CI must conclude success.');
  if (!/^\d+$/u.test(String(ciRunId))) fail('ci-run-id-invalid', 'ci', 'CI run ID must be numeric.');
  return Object.freeze({
    schemaVersion: 1,
    phase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.8',
    status: 'READY_FOR_MANUAL_APPROVAL',
    timestamp,
    HEAD: head,
    projectName: 'lanzo-store',
    artifactEvidenceSha256,
    remoteEvidenceSha256,
    artifactConfigSha256: artifact.configSha256,
    artifactStaticSha256: artifact.staticSha256,
    deploymentIdHash: remote.deploymentIdHash,
    previewHost: remote.previewHost,
    functions: artifact.functions,
    runtimes: artifact.bundles.map(({ route, runtime }) => ({ route, runtime })),
    handlers: artifact.bundles.map(({ route, handler }) => ({ route, handler })),
    routingPassed: true,
    metadataPassed: remote.metadataPassed,
    ogImagePassed: remote.ogImagePassed,
    securityPassed: remote.securityPassed,
    ciWorkflow: 'PR127 Global Comparison',
    ciRunId: String(ciRunId),
    ciConclusion,
    productionDeploymentAuthorized: false,
    productionDeploymentExecuted: false,
    readyForManualApproval: true,
    nextPhase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.9',
  });
}

export async function writeReadinessManifest(filePath, manifest) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
  return filePath;
}

export async function verifyReleaseReadiness(input, options = {}) {
  if (input.ciConclusion !== 'success') fail('ci-not-success', 'ci', 'Global CI must conclude success.');
  const [artifactInput, remoteInput] = await Promise.all([
    readJsonEvidence(input.artifactAuditPath, 'artifact-audit'),
    readJsonEvidence(input.remoteEvidencePath, 'remote-evidence'),
  ]);
  const artifact = validateArtifactEvidence(artifactInput.value, input.head);
  const remote = validateRemoteEvidence(remoteInput.value, input.head, artifact);
  const manifest = buildReadinessManifest({
    head: input.head,
    artifact,
    remote,
    artifactEvidenceSha256: artifactInput.sha256,
    remoteEvidenceSha256: remoteInput.sha256,
    ciConclusion: input.ciConclusion,
    ciRunId: input.ciRunId,
    timestamp: options.timestamp,
  });
  await writeReadinessManifest(input.outputPath, manifest);
  return manifest;
}

function sanitizedFailure(error) {
  const output = {
    phase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.8',
    status: 'BLOCKED',
    reason: error instanceof ReadinessError ? error.reason : 'readiness-gate-failed',
    gate: error instanceof ReadinessError ? error.gate : 'internal',
    productionDeploymentAuthorized: false,
    productionDeploymentExecuted: false,
  };
  if (error?.finding) output.finding = error.finding;
  return output;
}

async function main() {
  try {
    const input = parseReadinessArguments();
    const manifest = await verifyReleaseReadiness(input);
    process.stdout.write(`${JSON.stringify({
      phase: manifest.phase,
      status: manifest.status,
      HEAD: manifest.HEAD,
      projectName: manifest.projectName,
      functions: manifest.functions,
      ciWorkflow: manifest.ciWorkflow,
      ciRunId: manifest.ciRunId,
      ciConclusion: manifest.ciConclusion,
      productionDeploymentAuthorized: false,
      productionDeploymentExecuted: false,
      readyForManualApproval: true,
      nextPhase: manifest.nextPhase,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(sanitizedFailure(error), null, 2)}\n`);
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) await main();
