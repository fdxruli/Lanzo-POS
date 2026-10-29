import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PRODUCTION_SUPABASE_REF = 'odlrhijtfyavryeqivaa';

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REQUIRED_PREVIEW_VARIABLES = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY'
];

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(label + ' is missing.');
  }
  return value.trim();
}

function validateProjectRef(value, label) {
  const projectRef = requiredString(value, label);
  if (!PROJECT_REF_PATTERN.test(projectRef)) {
    throw new Error(label + ' is unknown or malformed.');
  }
  if (projectRef === PRODUCTION_SUPABASE_REF) {
    throw new Error(label + ' resolves to the Production project.');
  }
  return projectRef;
}

export function projectRefFromSupabaseUrl(value, label = 'Supabase URL') {
  const rawUrl = requiredString(value, label);
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(label + ' is invalid.');
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error(label + ' must be an HTTPS Supabase project URL.');
  }

  const match = url.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/u);
  if (!match) {
    throw new Error(label + ' does not identify a Supabase project ref.');
  }
  return match[1];
}

export function assertStagingTarget({
  targetEnvironment,
  authorizedStagingRef,
  effectiveSupabaseUrl
}) {
  if (targetEnvironment !== 'staging') {
    throw new Error('TARGET_ENVIRONMENT must be staging.');
  }

  const authorizedRef = validateProjectRef(
    authorizedStagingRef,
    'AUTHORIZED_STAGING_SUPABASE_REF'
  );
  const effectiveRef = projectRefFromSupabaseUrl(
    effectiveSupabaseUrl,
    'Effective Supabase URL'
  );
  if (effectiveRef === PRODUCTION_SUPABASE_REF) {
    throw new Error('Effective Supabase URL resolves to Production.');
  }
  if (effectiveRef !== authorizedRef) {
    throw new Error('Effective Supabase URL does not match the authorized staging ref.');
  }
  return { ok: true, projectRef: effectiveRef };
}

export function assertMigrationTarget({
  targetEnvironment,
  authorizedStagingRef,
  migrationTargetRef
}) {
  if (targetEnvironment !== 'staging') {
    throw new Error('TARGET_ENVIRONMENT must be staging.');
  }

  const authorizedRef = validateProjectRef(
    authorizedStagingRef,
    'AUTHORIZED_STAGING_SUPABASE_REF'
  );
  const targetRef = validateProjectRef(migrationTargetRef, 'Migration target ref');
  if (targetRef !== authorizedRef) {
    throw new Error('Migration target does not match the authorized staging ref.');
  }
  return { ok: true, projectRef: targetRef };
}

function assertNoClientSecretExposure(variableNames, bundleTexts) {
  for (const variableName of variableNames) {
    if (
      typeof variableName === 'string' &&
      variableName.startsWith('VITE_') &&
      /service.?role|secret|private.?key/iu.test(variableName)
    ) {
      throw new Error('A secret-looking VITE variable is configured for the client.');
    }
  }

  const secretNamePattern =
    /(?:SUPABASE_)?SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|sb_secret_[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/iu;
  const jwtPattern = /eyJ[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/gu;

  for (const bundleText of bundleTexts) {
    if (secretNamePattern.test(bundleText)) {
      throw new Error('A service-role, secret API key, or private key marker was found in a client bundle.');
    }
    for (const match of bundleText.matchAll(jwtPattern)) {
      try {
        const payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
        if (payload?.role === 'service_role') {
          throw new Error('A service-role JWT was found in a client bundle.');
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'A service-role JWT was found in a client bundle.') {
          throw error;
        }
      }
    }
  }
}

export function assertPreviewIsolation(snapshot, bundleTexts = []) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Preview snapshot is missing or invalid.');
  }
  if (snapshot.deploymentTarget !== 'preview') {
    throw new Error('Deployment target must be explicitly verified as preview.');
  }

  const branch = requiredString(snapshot.branch, 'Preview branch');
  const expectedBranch = requiredString(snapshot.expectedBranch, 'Expected Preview branch');
  if (branch !== expectedBranch) {
    throw new Error('Preview branch does not match the expected branch.');
  }

  const sha = requiredString(snapshot.deploymentSha, 'Preview deployment SHA');
  const expectedSha = requiredString(snapshot.expectedSha, 'Expected frontend SHA');
  if (!SHA_PATTERN.test(sha) || !SHA_PATTERN.test(expectedSha) || sha !== expectedSha) {
    throw new Error('Preview deployment SHA does not match the expected frontend SHA.');
  }

  const authorizedRef = validateProjectRef(
    snapshot.authorizedStagingRef,
    'Authorized staging ref'
  );
  const previewRef = projectRefFromSupabaseUrl(
    snapshot.previewSupabaseUrl,
    'Preview Supabase URL'
  );
  if (previewRef === PRODUCTION_SUPABASE_REF) {
    throw new Error('Preview Supabase URL resolves to Production.');
  }
  if (previewRef !== authorizedRef) {
    throw new Error('Preview Supabase URL does not match the authorized staging ref.');
  }

  if (snapshot.realtimeProjectRef !== authorizedRef) {
    throw new Error('Realtime project ref does not match the authorized staging ref.');
  }
  if (snapshot.edgeFunctionProjectRef !== authorizedRef) {
    throw new Error('Edge Function project ref does not match the authorized staging ref.');
  }
  if (snapshot.externalServicesSandboxed !== true) {
    throw new Error('External services are not verified as sandboxed.');
  }

  const variables = Array.isArray(snapshot.variables) ? snapshot.variables : [];
  for (const variableName of REQUIRED_PREVIEW_VARIABLES) {
    const matches = variables.filter((item) => item?.name === variableName);
    if (matches.length !== 1) {
      throw new Error(variableName + ' must have exactly one Preview branch override.');
    }
    const variable = matches[0];
    if (
      !Array.isArray(variable.target) ||
      variable.target.length !== 1 ||
      variable.target[0] !== 'preview'
    ) {
      throw new Error(variableName + ' must be scoped only to Preview.');
    }
    if (variable.gitBranch !== expectedBranch) {
      throw new Error(variableName + ' is not scoped to the expected Git branch.');
    }
  }

  const variableNames = variables.map((variable) => variable?.name);
  const allBundleText = bundleTexts.join('\n');
  if (allBundleText.includes(PRODUCTION_SUPABASE_REF)) {
    throw new Error('A client bundle contains the Production Supabase ref.');
  }
  assertNoClientSecretExposure(variableNames, bundleTexts);

  return { ok: true, projectRef: previewRef, branch, sha };
}

function printUsage() {
  process.stderr.write(
    'Usage: node scripts/supabase/staging-isolation-guard.mjs target\n' +
      '   or: node scripts/supabase/staging-isolation-guard.mjs migration <target-project-ref>\n' +
      '   or: node scripts/supabase/staging-isolation-guard.mjs preview <snapshot.json> <bundle.js>...\n'
  );
}

export function runGuardCli(args, env = process.env) {
  const [mode, ...rest] = args;
  if (mode === 'target' && rest.length === 0) {
    return assertStagingTarget({
      targetEnvironment: env.TARGET_ENVIRONMENT,
      authorizedStagingRef: env.AUTHORIZED_STAGING_SUPABASE_REF,
      effectiveSupabaseUrl: env.SUPABASE_URL
    });
  }

  if (mode === 'migration' && rest.length === 1) {
    return assertMigrationTarget({
      targetEnvironment: env.TARGET_ENVIRONMENT,
      authorizedStagingRef: env.AUTHORIZED_STAGING_SUPABASE_REF,
      migrationTargetRef: rest[0]
    });
  }

  if (mode === 'preview' && rest.length >= 1) {
    const snapshot = JSON.parse(readFileSync(rest[0], 'utf8'));
    const bundleTexts = rest.slice(1).map((path) => readFileSync(path, 'utf8'));
    return assertPreviewIsolation(snapshot, bundleTexts);
  }

  printUsage();
  throw new Error('Invalid guard command.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runGuardCli(process.argv.slice(2));
    process.stdout.write(
      'STAGING_ISOLATION_GUARD PASS: target identity and supplied non-secret evidence match. No database connection was opened.\n'
    );
  } catch (error) {
    process.stderr.write(
      'STAGING_ISOLATION_GUARD REJECT: ' + error.message + '\n'
    );
    process.exitCode = 1;
  }
}
