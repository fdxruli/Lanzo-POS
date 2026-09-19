import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const schedulerUrl = new URL(
  '../../supabase/migrations/20260919195822_customer_messaging_phase5_license_entitlement_scheduler_r1.sql',
  import.meta.url
);
const automationUrl = new URL(
  '../../supabase/migrations/20260919044030_customer_messaging_phase5_automation.sql',
  import.meta.url
);

const [scheduler, automation] = await Promise.all([
  readFile(schedulerUrl, 'utf8'),
  readFile(automationUrl, 'utf8')
]);

test('scheduler reads canonical entitlement and processes overdue reminders explicitly', () => {
  assert.match(scheduler, /private\.license_entitlement_state_v1\(l\.id\)/u);
  assert.match(scheduler, /entitlement\.lifecycle_state/u);
  assert.match(scheduler, /entitlement\.is_entitled/u);
  assert.match(scheduler, /entitlement\.plan_code/u);
  assert.match(scheduler, /entitlement\.effective_features/u);
  assert.match(scheduler, /where r\.status = 'programado'/u);
  assert.match(scheduler, /r\.scheduled_for <= now\(\)/u);
  assert.match(scheduler, /or entitlement\.is_entitled is not true/u);
  assert.match(scheduler, /or coalesce\(c\.debt, 0\) <= 0/u);
  assert.match(scheduler, /return v_processed/u);
  assert.doesNotMatch(scheduler, /l\.expires_at/u);
  assert.doesNotMatch(scheduler, /update public\.licenses/u);
});

test('scheduler keeps eligible grace reminders and marks ineligible rows with honest codes', () => {
  assert.match(scheduler, /v_row\.is_entitled/u);
  assert.match(scheduler, /v_cloud_enabled/u);
  assert.match(scheduler, /v_row\.config_enabled/u);
  assert.match(scheduler, /then 'listo_para_preparar'/u);
  assert.match(scheduler, /when 'expired' then 'LICENSE_EXPIRED'/u);
  assert.match(scheduler, /when 'administratively_blocked' then 'LICENSE_NOT_ACTIVE'/u);
  assert.match(scheduler, /'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE'/u);
  assert.match(scheduler, /'REMINDER_CONFIG_DISABLED'/u);
  assert.match(scheduler, /'REMINDER_CUSTOMER_NOT_PENDING'/u);
  assert.match(scheduler, /else 'cancelado'/u);
});

test('explicit scheduling remains idempotent and never claims provider delivery', () => {
  assert.match(automation, /where license_id = v_license_id and customer_id = v_customer\.id/u);
  assert.match(automation, /and event_type = 'debt_reminder' and window_key = v_window_key/u);
  assert.match(automation, /return jsonb_build_object\('success', true, 'duplicate', true/u);
  assert.match(automation, /status = 'programado'/u);
  assert.doesNotMatch(scheduler, /provider/u);
  assert.doesNotMatch(scheduler, /'Enviado'/u);
});
