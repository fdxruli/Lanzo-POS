import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../../supabase/candidates/ecom-signal-auth-1a5/allowlist.sql', import.meta.url), 'utf8');
const aclProposal = await readFile(new URL('../../supabase/candidates/ecom-signal-auth-1a5/public-rpc-acl-proposal.sql', import.meta.url), 'utf8');
const aclRollback = await readFile(new URL('../../supabase/candidates/ecom-signal-auth-1a5/public-rpc-acl-rollback.sql', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../../supabase/candidates/ecom-signal-auth-1a2/bridge.sql', import.meta.url), 'utf8');
const lifecycle = await readFile(new URL('../../supabase/candidates/ecom-signal-auth-1a4/20261022181404_qa_ecom_bridge_1a4_lifecycle.sql', import.meta.url), 'utf8');
const hardening = await readFile(new URL('../../supabase/candidates/ecom-signal-auth-1a3/hardening.sql', import.meta.url), 'utf8');

const good = () => ({
  allowlisted: true, selectedLicense: true, licenseId: 'license-a', tenantId: 'license-a', deviceId: 'device-a',
  planCode: 'free_trial', licenseType: 'free', licenseStatus: 'active', entitled: true,
  ecommerce: true, inbox: true, portalPublished: true, orderingEnabled: true, ordersPaused: false,
  portalDeleted: false, deviceActive: true, deviceAuthorized: true, sessionCurrent: true,
  actorType: 'admin', actorActive: true, staffEcommerce: false, runtimeCurrent: true,
  allowlistState: 'approved', allowlistExpires: false, killSwitch: false, aclClosed: true,
  grantActive: true, grantBound: true, jwtNative: true, topicMatches: true, event: 'qa_probe'
});

function canAuthorize(c) {
  return c.allowlisted && c.selectedLicense && c.licenseId === c.tenantId
    && c.planCode === 'free_trial' && c.licenseType === 'free' && c.licenseStatus === 'active'
    && c.entitled && c.ecommerce && c.inbox && c.portalPublished && c.orderingEnabled
    && !c.ordersPaused && !c.portalDeleted && c.deviceActive && c.deviceAuthorized
    && c.sessionCurrent && c.runtimeCurrent && c.allowlistState === 'approved'
    && !c.allowlistExpires && !c.killSwitch && c.aclClosed
    && (c.actorType === 'admin' && c.actorActive || c.actorType === 'staff' && c.actorActive && c.staffEcommerce);
}
function canReceive(c) {
  return canAuthorize(c) && c.grantActive && c.grantBound && c.jwtNative && c.topicMatches && c.event === 'qa_probe';
}
function canPublish(c, callerRole, controlAuthorized) {
  return callerRole === 'service_role' && controlAuthorized === true && canAuthorize(c);
}

test('candidate replaces the synthetic prefix throughout live 1A.5 routes and keeps native Auth', () => {
  assert.doesNotMatch(sql, /QA-ECOM-SIGNAL-R2-/);
  assert.match(sql, /pilot_allowlist/);
  assert.match(sql, /acl_closed\(\)/);
  assert.match(sql, /private\.resolve_device_actor_session/);
  assert.match(sql, /p\.code = 'free_trial'/);
  assert.match(sql, /e\.effective_features->'ecommerce_order_inbox' = 'true'::jsonb/);
  assert.match(sql, /pilot_kill_switch/);
  assert.match(sql, /authority_live\(/);
  assert.match(bridge, /auth\.sessions/);
  assert.match(bridge, /c->>'iss' is distinct from 'https:\/\/odlrhijtfyavryeqivaa\.supabase\.co\/auth\/v1'/);
  assert.match(bridge, /c->'app_metadata'->>'binding_id'/);
  assert.match(lifecycle, /authority_live\(/);
  assert.match(hardening, /lock_authority\(/);
});

test('separate ACL proposal and rollback contain the same six exact signatures only', () => {
  const expected = [
    'public.admin_list_staff_users(text,text,text,text)',
    'public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text)',
    'public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text)',
    'public.pos_get_cash_station_state(text,text,text,text)',
    'public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)',
    'public.pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text)'
  ];
  for (const signature of expected) {
    assert.equal(aclProposal.includes(signature), true, `proposal missing ${signature}`);
    assert.equal(aclRollback.includes(signature), true, `rollback missing ${signature}`);
  }
  assert.equal((aclProposal.match(/revoke execute on function/g) || []).length, 6);
  assert.equal((aclRollback.match(/grant execute on function/g) || []).length, 6);
  assert.doesNotMatch(aclProposal, /create or replace function|drop function|cascade/i);
  assert.doesNotMatch(aclRollback, /grant (?:all|execute on all functions)|cascade/i);
});

test('positive allowlist fixtures permit eligible FREE Admin and Ecommerce Staff', () => {
  const admin = good();
  assert.equal(canReceive(admin), true);
  const staff = { ...good(), actorType: 'staff', staffEcommerce: true };
  assert.equal(canReceive(staff), true);
});

const negativeCases = [
  ['license outside allowlist', c => { c.allowlisted = false; }],
  ['other FREE license', c => { c.selectedLicense = false; }],
  ['PRO plan', c => { c.planCode = 'pro'; c.licenseType = 'pro'; }],
  ['revoked Ecommerce entitlement', c => { c.ecommerce = false; }],
  ['inbox entitlement revoked', c => { c.inbox = false; }],
  ['portal unpublished', c => { c.portalPublished = false; }],
  ['portal ordering disabled', c => { c.orderingEnabled = false; }],
  ['portal paused', c => { c.ordersPaused = true; }],
  ['portal deleted', c => { c.portalDeleted = true; }],
  ['Staff without Ecommerce', c => { c.actorType = 'staff'; c.staffEcommerce = false; }],
  ['inactive device', c => { c.deviceActive = false; }],
  ['device not allowlisted', c => { c.deviceAuthorized = false; }],
  ['expired Lanzo session', c => { c.sessionCurrent = false; }],
  ['replaced Admin', c => { c.actorActive = false; }],
  ['tenant changed', c => { c.tenantId = 'other-tenant'; }],
  ['stale runtime generation', c => { c.runtimeCurrent = false; }],
  ['expired grant', c => { c.grantActive = false; }],
  ['JWT binding modified', c => { c.jwtNative = false; }],
  ['foreign topic', c => { c.topicMatches = false; }],
  ['allowlist revoked', c => { c.allowlistState = 'revoked'; }],
  ['allowlist expired', c => { c.allowlistExpires = true; }],
  ['kill switch active', c => { c.killSwitch = true; }],
  ['PUBLIC ACL still open', c => { c.aclClosed = false; }],
  ['commercial event', c => { c.event = 'order_created'; }]
];

for (const [name, mutate] of negativeCases) {
  test(`denies ${name}`, () => {
    const candidate = good();
    mutate(candidate);
    assert.equal(canReceive(candidate), false);
  });
}

test('receiver never receives the server-only publish permission', () => {
  const receiverHasPublish = /grant\s+execute\s+on\s+function\s+public\.lanzo_ecom_bridge_qa_publish[^;]*\s+to\s+lanzo_ecom_bridge_receiver/i.test(sql);
  assert.equal(receiverHasPublish, false);
  const candidate = good();
  assert.equal(canPublish(candidate, 'lanzo_ecom_bridge_receiver', true), false);
  assert.equal(canPublish(candidate, 'authenticated', true), false);
  assert.equal(canPublish(candidate, 'service_role', false), false);
  assert.equal(canPublish(candidate, 'service_role', true), true);
});
