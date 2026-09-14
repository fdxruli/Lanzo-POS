import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const [migration, portalAccess, orderCapabilities, profileSlice] = await Promise.all([
  readFile(new URL('../../supabase/migrations/20260914092514_license_effective_features_creation_contract_r1.sql', import.meta.url), 'utf8'),
  readFile(new URL('../../src/pages/settingsPageAccess.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/services/ecommerce/ecommerceOrderCapabilities.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/store/slices/createProfileSlice.js', import.meta.url), 'utf8')
]);

test('creation returns the plan/license merge in both response locations', () => {
  assert.match(migration, /coalesce\(p\.features, '\{\}'::jsonb\) \|\| coalesce\(l\.features, '\{\}'::jsonb\)/u);
  assert.equal((migration.match(/'features', v_effective_features/gu) || []).length, 2);
  assert.match(migration, /select[\s\S]+into v_effective_features[\s\S]+from public\.licenses/u);
});

test('portal and order navigation use effective features and keep staff permission checks', () => {
  assert.match(portalAccess, /isEcommercePortalEnabled\(licenseDetails\)/u);
  assert.match(orderCapabilities, /getStaffPermissions\(staffSession\)\.ecommerce === true/u);
  assert.match(orderCapabilities, /isTrue\(getEcommerceOrderFeatures\(licenseDetails\)\.ecommerce_portal_enabled\)/u);
});

test('first-time setup revalidates before publishing ready state', () => {
  const setupStart = profileSlice.indexOf('handleSetup: async');
  const setupBody = profileSlice.slice(setupStart);
  assert.ok(setupStart >= 0);
  assert.ok(setupBody.indexOf('refreshLicenseBeforeReady') < setupBody.indexOf("appStatus: 'ready'"));
  assert.match(profileSlice, /validation\?\.reason !== 'offline_grace'/u);
});
