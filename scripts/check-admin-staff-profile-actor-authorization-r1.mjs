import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');

const migration = read('supabase/migrations/20260824165820_admin_staff_profile_actor_authorization_r1.sql');
const sqlTest = read('supabase/tests/admin_staff_profile_actor_authorization_r1_test.sql');
const supabaseClient = read('src/services/supabase.js');
const profileSlice = read('src/store/slices/createProfileSlice.js');
const activationActions = read('src/store/slices/license/licenseActivationActions.js');
const actorController = read('src/services/auth/actorRuntimeController.js');
const actorBridge = read('src/services/auth/actorSessionRuntimeBridge.js');
const latestSharedTerminal = read('supabase/migrations/20260818164207_shared_terminal_device_actor_auth.sql');
const latestAdminCutover = read('supabase/migrations/20260723180000_license_admin_auth_1_cutover.sql');

const requireFragments = (label, source, fragments) => {
  for (const fragment of fragments) {
    if (!source.includes(fragment)) {
      throw new Error(`${label} is missing required contract: ${fragment}`);
    }
  }
};

requireFragments('profile migration', migration, [
  'save_business_profile_secure_legacy(text,text,text,jsonb)',
  'save_business_profile_secure(text,text,text,text,jsonb)',
  'private.validate_pos_sync_context',
  "private.has_pos_permission(v_context, 'settings')",
  "'SETTINGS_PERMISSION_DENIED'",
  "'ACTOR_SESSION_REQUIRED'",
  "'PROFILE'",
  '30,',
  '600,',
  'save_business_profile_secure_unlimited',
  "set search_path = ''",
  'from public, anon, authenticated, service_role',
  'grant execute on function public.save_business_profile_secure(text,text,text,text,jsonb)',
  'notify pgrst'
]);

if (/create\s+(?:or\s+replace\s+)?function\s+public\.save_business_profile_secure\s*\(\s*license_key_param\s+text\s*,\s*device_fingerprint_param\s+text\s*,\s*security_token_param\s+text\s*,\s*profile_data\s+jsonb/is.test(migration)) {
  throw new Error('migration recreates the retired four-argument public profile RPC');
}
if (migration.includes('return public.activate_license_on_device_legacy_free(')) {
  throw new Error('free-trial activation still delegates to the device-only legacy path');
}

requireFragments('profile client', supabaseClient, [
  'getActorSessionCredentialForHandle(actorHandle)',
  "actorHandle.assertCurrent('settings')",
  'actor_session_token_param: actorSessionToken',
  "'save_business_profile_secure'"
]);
if (/save_business_profile_secure[\s\S]{0,800}(?:retry|legacy)/i.test(supabaseClient)) {
  throw new Error('profile client contains a legacy/retry downgrade near the secure RPC');
}

requireFragments('profile slice', profileSlice, [
  "actorRuntimeController.capture('settings')",
  'saveBusinessProfile(licenseKey, profileData, { actorHandle })',
  'saveBusinessProfile(licenseKey, nextCompanyData, { actorHandle })',
  "beforeWrite: () => actorHandle.assertCurrent('settings')"
]);

requireFragments('free-trial onboarding', activationActions, [
  "appStatus: 'admin_enrollment_required'",
  'adminEnrollmentRequired: true',
  "device_role: 'admin'"
]);
if (/handleFreeTrial[\s\S]*?appStatus:\s*'setup_required'/.test(activationActions)) {
  throw new Error('free trial can still enter Setup before Admin enrollment');
}

for (const [label, source] of [
  ['actor controller', actorController],
  ['actor session bridge', actorBridge]
]) {
  requireFragments(label, source, [
    'Object.entries(permissions || {})',
    '.filter(([, granted]) => granted === true)'
  ]);
}

requireFragments('transactional SQL test', sqlTest, [
  'PROFILE_R1_ADMIN_EXPECTED_ALLOW',
  'PROFILE_R1_STAFF_SETTINGS_EXPECTED_ALLOW',
  'PROFILE_R1_STAFF_SETTINGS_EXPECTED_DENY',
  'PROFILE_R1_MISSING_ACTOR_NOT_REJECTED',
  'PROFILE_R1_CROSS_LICENSE_NOT_REJECTED',
  'PROFILE_R1_CROSS_DEVICE_NOT_REJECTED',
  'PROFILE_R1_FREE_ENROLLMENT_FAILED',
  'PROFILE_R1_FREE_RESTART_DID_NOT_REQUIRE_ACTOR',
  'rollback;'
]);

const extractFunction = (source, functionName) => {
  const marker = `create or replace function public.${functionName}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`cannot find function definition: ${functionName}`);
  const declaration = source.slice(start);
  const tagMatch = declaration.match(/\bas\s+(\$[a-zA-Z_]*\$)/i);
  if (!tagMatch) throw new Error(`cannot find dollar quote for: ${functionName}`);
  const bodyStart = tagMatch.index + tagMatch[0].length;
  const end = declaration.indexOf(`${tagMatch[1]};`, bodyStart);
  if (end < 0) throw new Error(`cannot find function terminator: ${functionName}`);
  return declaration.slice(0, end + tagMatch[1].length + 1);
};

const canonicalSql = (sql) => {
  const withoutComments = sql.replace(/--[^\r\n]*/g, '');
  let result = '';
  let inString = false;
  for (let index = 0; index < withoutComments.length; index += 1) {
    const char = withoutComments[index];
    if (char === "'") {
      result += char;
      if (inString && withoutComments[index + 1] === "'") {
        result += withoutComments[index + 1];
        index += 1;
      } else {
        inString = !inString;
      }
    } else if (inString || !/\s/.test(char)) {
      result += char;
    }
  }
  return result.replace(/\$[a-zA-Z_]*\$/g, '');
};

const freeActivationBypass = "iflower(coalesce(v_license.plan_code,''))='free_trial'thenreturnpublic.activate_license_on_device_legacy_free(license_key_param,device_fingerprint_param,device_name_param,device_info_param);endif;";
const freeAdminPlanDenial = "iflower(coalesce(v_license.plan_code,''))='free_trial'thenreturnjsonb_build_object('success',false,'code','ADMIN_PLAN_REQUIRED');endif;";

for (const { name, baseline, removedGuard } of [
  {
    name: 'activate_license_on_device_unlimited',
    baseline: latestAdminCutover,
    removedGuard: freeActivationBypass
  },
  {
    name: 'admin_login_on_device',
    baseline: latestSharedTerminal,
    removedGuard: freeAdminPlanDenial
  },
  {
    name: 'admin_enroll_owner_on_device',
    baseline: latestSharedTerminal,
    removedGuard: freeAdminPlanDenial
  }
]) {
  const expected = canonicalSql(extractFunction(baseline, name)).replace(removedGuard, '');
  const actual = canonicalSql(extractFunction(migration, name));
  if (expected === canonicalSql(extractFunction(baseline, name))) {
    throw new Error(`latest ${name} does not contain the expected free-plan guard`);
  }
  if (actual !== expected) {
    throw new Error(`${name} changed beyond removal of its free-plan guard`);
  }
}

console.log('ADMIN.STAFF.SECTION.ISOLATION.R1 profile actor authorization contract: PASS');
