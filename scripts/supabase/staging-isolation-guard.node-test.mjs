import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PRODUCTION_SUPABASE_REF,
  assertMigrationTarget,
  assertPreviewIsolation,
  assertStagingTarget,
  projectRefFromSupabaseUrl,
  runGuardCli
} from './staging-isolation-guard.mjs';

const stagingRef = 'aaaaaaaaaaaaaaaaaaaa';
const previewBranch = 'feat/restaurant-admin-supervision-r1';
const previewSha = 'a'.repeat(40);

function validPreview(overrides = {}) {
  return {
    deploymentTarget: 'preview',
    branch: previewBranch,
    expectedBranch: previewBranch,
    deploymentSha: previewSha,
    expectedSha: previewSha,
    authorizedStagingRef: stagingRef,
    previewSupabaseUrl: 'https://' + stagingRef + '.supabase.co',
    realtimeProjectRef: stagingRef,
    edgeFunctionProjectRef: stagingRef,
    externalServicesSandboxed: true,
    variables: [
      {
        name: 'VITE_SUPABASE_URL',
        target: ['preview'],
        gitBranch: previewBranch
      },
      {
        name: 'VITE_SUPABASE_PUBLISHABLE_KEY',
        target: ['preview'],
        gitBranch: previewBranch
      }
    ],
    ...overrides
  };
}

test('accepts a synthetic authorized staging ref that matches the effective URL', () => {
  const result = assertStagingTarget({
    targetEnvironment: 'staging',
    authorizedStagingRef: stagingRef,
    effectiveSupabaseUrl: 'https://' + stagingRef + '.supabase.co'
  });
  assert.equal(result.ok, true);
  assert.equal(result.projectRef, stagingRef);
});

test('rejects the Production ref even when it is supplied as the expected target', () => {
  assert.throws(
    () =>
      assertStagingTarget({
        targetEnvironment: 'staging',
        authorizedStagingRef: PRODUCTION_SUPABASE_REF,
        effectiveSupabaseUrl: 'https://' + PRODUCTION_SUPABASE_REF + '.supabase.co'
      }),
    /Production project/u
  );
});

test('rejects unknown or malformed project refs', () => {
  assert.throws(
    () =>
      assertStagingTarget({
        targetEnvironment: 'staging',
        authorizedStagingRef: stagingRef,
        effectiveSupabaseUrl: 'https://unknown.supabase.co'
      }),
    /does not identify a Supabase project ref/u
  );
});

test('rejects missing environment, ref, or effective URL inputs', () => {
  assert.throws(
    () =>
      assertStagingTarget({
        targetEnvironment: undefined,
        authorizedStagingRef: stagingRef,
        effectiveSupabaseUrl: 'https://' + stagingRef + '.supabase.co'
      }),
    /TARGET_ENVIRONMENT must be staging/u
  );
  assert.throws(
    () =>
      assertStagingTarget({
        targetEnvironment: 'staging',
        authorizedStagingRef: '',
        effectiveSupabaseUrl: 'https://' + stagingRef + '.supabase.co'
      }),
    /AUTHORIZED_STAGING_SUPABASE_REF is missing/u
  );
  assert.throws(
    () =>
      assertStagingTarget({
        targetEnvironment: 'staging',
        authorizedStagingRef: stagingRef,
        effectiveSupabaseUrl: ''
      }),
    /Effective Supabase URL is missing/u
  );
});

test('rejects an environment name that is not staging', () => {
  assert.throws(
    () =>
      runGuardCli(
        ['target'],
        {
          TARGET_ENVIRONMENT: 'production',
          AUTHORIZED_STAGING_SUPABASE_REF: stagingRef,
          SUPABASE_URL: 'https://' + stagingRef + '.supabase.co'
        }
      ),
    /TARGET_ENVIRONMENT must be staging/u
  );
});

test('accepts a migration only when the target matches the authorized staging ref', () => {
  const result = assertMigrationTarget({
    targetEnvironment: 'staging',
    authorizedStagingRef: stagingRef,
    migrationTargetRef: stagingRef
  });
  assert.equal(result.ok, true);
  assert.equal(result.projectRef, stagingRef);
});

test('rejects Production, unknown, mismatched, or unverified migration targets', () => {
  for (const migrationTargetRef of [
    PRODUCTION_SUPABASE_REF,
    'unknown',
    'bbbbbbbbbbbbbbbbbbbb'
  ]) {
    assert.throws(
      () =>
        assertMigrationTarget({
          targetEnvironment: 'staging',
          authorizedStagingRef: stagingRef,
          migrationTargetRef
        }),
      /Production project|malformed|does not match/u
    );
  }
  assert.throws(
    () =>
      assertMigrationTarget({
        targetEnvironment: undefined,
        authorizedStagingRef: stagingRef,
        migrationTargetRef: stagingRef
      }),
    /TARGET_ENVIRONMENT must be staging/u
  );
});

test('accepts a Preview snapshot scoped to the authorized branch and SHA', () => {
  const result = assertPreviewIsolation(validPreview(), [
    'const backend = "https://' + stagingRef + '.supabase.co";'
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.projectRef, stagingRef);
});

test('rejects Preview configuration that points to Production', () => {
  assert.throws(
    () =>
      assertPreviewIsolation(
        validPreview({
          previewSupabaseUrl: 'https://' + PRODUCTION_SUPABASE_REF + '.supabase.co'
        })
      ),
    /Preview Supabase URL resolves to Production/u
  );
});

test('rejects an unverified Preview target or mismatched frontend SHA', () => {
  assert.throws(
    () => assertPreviewIsolation(validPreview({ deploymentTarget: null })),
    /explicitly verified as preview/u
  );
  assert.throws(
    () => assertPreviewIsolation(validPreview({ deploymentSha: 'b'.repeat(40) })),
    /does not match the expected frontend SHA/u
  );
});

test('rejects missing branch-specific Supabase Preview overrides', () => {
  const snapshot = validPreview({
    variables: validPreview().variables.map((item) => ({
      ...item,
      gitBranch: null
    }))
  });
  assert.throws(
    () => assertPreviewIsolation(snapshot),
    /not scoped to the expected Git branch/u
  );
});

test('rejects Supabase Preview variables also scoped to Production', () => {
  const snapshot = validPreview({
    variables: validPreview().variables.map((item, index) => ({
      ...item,
      target: index === 0 ? ['preview', 'production'] : item.target
    }))
  });
  assert.throws(
    () => assertPreviewIsolation(snapshot),
    /must be scoped only to Preview/u
  );
});

test('rejects service-role and secret variables exposed through VITE', () => {
  const snapshot = validPreview({
    variables: [
      ...validPreview().variables,
      {
        name: 'VITE_SUPABASE_SERVICE_ROLE_KEY',
        target: ['preview'],
        gitBranch: previewBranch
      }
    ]
  });
  assert.throws(
    () => assertPreviewIsolation(snapshot),
    /secret-looking VITE variable/u
  );
});

test('rejects service-role keys, JWTs, and production refs in compiled bundles', () => {
  const serviceRoleJwt =
    'eyJhbGciOiJub25lIn0.' +
    Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') +
    '.signature-value';
  assert.throws(
    () => assertPreviewIsolation(validPreview(), [serviceRoleJwt]),
    /service-role JWT/u
  );
  assert.throws(
    () =>
      assertPreviewIsolation(validPreview(), [
        'const project = "' + PRODUCTION_SUPABASE_REF + '";'
      ]),
    /contains the Production Supabase ref/u
  );
});

test('requires Realtime, Edge Functions, and external services to be stage isolated', () => {
  assert.throws(
    () => assertPreviewIsolation(validPreview({ realtimeProjectRef: PRODUCTION_SUPABASE_REF })),
    /Realtime project ref/u
  );
  assert.throws(
    () => assertPreviewIsolation(validPreview({ edgeFunctionProjectRef: PRODUCTION_SUPABASE_REF })),
    /Edge Function project ref/u
  );
  assert.throws(
    () => assertPreviewIsolation(validPreview({ externalServicesSandboxed: false })),
    /not verified as sandboxed/u
  );
});

test('extracts only an HTTPS Supabase project ref from the URL host', () => {
  assert.equal(
    projectRefFromSupabaseUrl('https://' + stagingRef + '.supabase.co'),
    stagingRef
  );
  assert.throws(
    () => projectRefFromSupabaseUrl('http://' + stagingRef + '.supabase.co'),
    /must be an HTTPS Supabase project URL/u
  );
});
