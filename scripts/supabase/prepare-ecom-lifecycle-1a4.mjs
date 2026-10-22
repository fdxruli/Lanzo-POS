// Produces an explicit QA-only candidate; never connects or applies SQL.
import { readFileSync, writeFileSync } from 'node:fs';
const file = 'supabase/candidates/ecom-signal-auth-1a3/20261022063248_qa_ecom_native_bridge_1a3_hardening.sql';
let sql = readFileSync(file, 'utf8').split('-- QA only. Append')[0];
function replace(before, after) {
  if (sql.split(before).length !== 2) throw Error('CANDIDATE_SOURCE_CHANGED');
  sql = sql.replace(before, after);
}
replace("if g.revoked_at is not null or g.expires_at<=clock_timestamp() or g.actor_generation<>ag or g.tenant_generation<>tg then\n   return jsonb_build_object('code','DENIED'); end if;",
 "if g.revoked_at is not null or g.actor_generation<>ag or g.tenant_generation<>tg then\n   return jsonb_build_object('code','DENIED'); end if;\n  if g.expires_at<=clock_timestamp() then return jsonb_build_object('code','EXPIRED'); end if;");
replace("select least(clock_timestamp()+interval '120 seconds',session_expiry,coalesce(e.grace_period_ends,'infinity'::timestamptz)) into expiry",
 "select least(clock_timestamp()+make_interval(secs=>(select grant_seconds from lanzo_ecom_bridge_qa.lifecycle_policy where singleton)),session_expiry,coalesce(e.grace_period_ends,'infinity'::timestamptz)) into expiry");
// Fail closed at the next authorized broker operation if Auth self-service has
// created unbound sessions/MFA. Does not claim to rate-limit Auth endpoints.
replace("select * into g from lanzo_ecom_bridge_qa.grants where identity_id=i.id and runtime_id=runtime for update;",
 "if lanzo_ecom_bridge_qa.quarantine_anomaly(i.id) then return jsonb_build_object('code','DENIED'); end if;\n select * into g from lanzo_ecom_bridge_qa.grants where identity_id=i.id and runtime_id=runtime for update;");
const policy = `-- Synthetic-only policy. 600s is a candidate, not commercial enablement.
create table lanzo_ecom_bridge_qa.lifecycle_policy(singleton boolean primary key check(singleton),grant_seconds integer not null check(grant_seconds in (120,300,600,900)));
insert into lanzo_ecom_bridge_qa.lifecycle_policy values(true,600);
alter table lanzo_ecom_bridge_qa.lifecycle_policy enable row level security;
revoke all on lanzo_ecom_bridge_qa.lifecycle_policy from public,anon,authenticated,service_role,lanzo_ecom_bridge_receiver;
create function lanzo_ecom_bridge_qa.quarantine_anomaly(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare i lanzo_ecom_bridge_qa.identities;
begin
 select * into i from lanzo_ecom_bridge_qa.identities where id=p_id for update;
 if i.auth_user_id is null then return false; end if;
 if exists(select 1 from auth.sessions s where s.user_id=i.auth_user_id and not exists(
  select 1 from lanzo_ecom_bridge_qa.grants g where g.identity_id=i.id and g.auth_session_id=s.id))
 or exists(select 1 from auth.mfa_factors f where f.user_id=i.auth_user_id) then
  update lanzo_ecom_bridge_qa.grants set revoked_at=coalesce(revoked_at,clock_timestamp()),vault=null,lease_id=null,lease_until=null where identity_id=i.id;
  update lanzo_ecom_bridge_qa.identities set retired_at=coalesce(retired_at,clock_timestamp()) where id=i.id;
  return true;
 end if;
 return false;
end $$;
revoke all on function lanzo_ecom_bridge_qa.quarantine_anomaly(uuid) from public,anon,authenticated,service_role,lanzo_ecom_bridge_receiver;
`;
const target = 'supabase/candidates/ecom-signal-auth-1a4/20261022181404_qa_ecom_bridge_1a4_lifecycle.sql';
writeFileSync(target, policy + sql + readFileSync('supabase/candidates/ecom-signal-auth-1a4/collection.sql','utf8'));
console.log(JSON.stringify({ target, executed: false }));
