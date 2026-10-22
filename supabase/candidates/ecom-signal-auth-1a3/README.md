# Phase 1A.3 QA candidate — HOLD

Continues 1A.2 without enabling `order_created` or mounting a global receiver.
The six shared PUBLIC ACL changes remain a separate, unapproved proposal in
`../ecom-signal-auth-r2/public-rpc-acl-proposal.sql`; its rollback is beside it.

The timestamped files are exact, additive QA migrations generated with the CLI.
They stay outside `supabase/migrations` to prevent a general `db push` from
replaying restaurant aliases or installing legal previews. Remote ledger versions
are recorded in the evidence: Supabase assigns an execution timestamp, which can
differ from the local preparation timestamp. Never repair/delete that history.

`hardening.sql` adds explicit Lanzo-authorized recovery, transactional publish
receipts and vault compare-and-swap. The timestamped hardening migration also
replaces only this bridge's prepare/finish functions: live Auth session check on
cached responses, active grant capacity, and a common broker lifecycle lock.
It never changes the six shared administrative function bodies or grants.

## Dedicated secrets and rotation

Server only: `LANZO_ECOM_VAULT_KEYS` is a JSON object of at most three key IDs to
independent random 32-byte base64 AES keys. `LANZO_ECOM_VAULT_KEY_ID` selects the
writer. `LANZO_ECOM_PASSWORD_KEY` is a different random 32-byte base64 HMAC key;
`LANZO_ECOM_PASSWORD_KEY_ID` versions its purpose string. Missing, malformed,
short or purpose-reused keys fail closed. There is no service_role fallback.
The HTTP service key authenticates backend operations only.

Vault v2 authenticates version, key ID and grant ID as AAD. To rotate: provision
a new dedicated AES key alongside the old one, switch the current key ID, run
the administrative `rotate_vault` operation and inspect its counts. It uses a
bounded private batch and compares the exact old ciphertext under the grant
row lock; a concurrent renewal/revoke is a conflict, never overwritten.
Retry conflicts/failures after resolving their cause. Keep the old key until
no retained vault references it and every active instance has the new ring.
Expired/revoked grants must be collected, rather than left to retain old keys.
Never retire a key based only on one batch result. QA has at most 40 active
grants; a commercial collector/rotation cursor and retention policy remain HOLD.

v1 service-key-derived vaults are deliberately not silently decrypted. The prior
QA resources were already removed. Any future v1 import requires an explicit
server-only migration/drain, not a shared credential rotation. Changing the
password derivation key affects new sign-ins: existing bound JWTs remain usable
for valid grants; perform canonical owner recovery before the next new runtime.
No existing production secret was rotated in this phase.

## Recovery and lifecycle

`action: recover` uses the same canonical Lanzo credential fields as issuance.
It locks and revokes all grants of that identity before deleting its exact Auth
user by immutable inventory ID + app_metadata + technical role. Mutable email
and user_metadata are never cleanup authority. Auth deletion removes all of
that technical user's sessions and MFA factors; it does not cryptographically
invalidate JWTs or promise immediate socket eviction. Old topics remain revoked.
Reset is permitted only after the exact old Auth user is absent and all grants
are revoked. Partial failure remains quarantined and is retryable. A successful
recovery requires a fresh runtime ID and produces a different Auth sub.
This can interrupt that identity's other QA tabs; it is explicit owner recovery.

The JWT still exposes Supabase Auth self-service. New unbound sessions cannot
obtain a Lanzo grant/topic without Lanzo credentials. Their independent Auth
resource consumption is not bounded by the bridge grant cap. Acceptance and an
operational abuse/cleanup policy remain security/scale gates.

`collect` first retires identities and clears their vaults under the lifecycle
lock, then removes exact inventoried Auth IDs. A bounded scan also reconciles
tagged timed-out createUser orphans. No commercial scheduled job is installed.
The global cap of 10 identities and four active grants per identity is a QA
safety bound, not a scalable commercial deployment configuration.

## Reproduction and rollback

1. Inspect current catalog, ledger, advisors and exact candidate/rollback files.
2. Install only the three reviewed timestamped QA SQL files, explicitly.
3. `node scripts/supabase/prepare-ecom-native-qa.mjs --out=.tmp/ecom-native-1a3`;
   install only its synthetic fixtures. Preserve prior inventories.
4. Run `ecom-hardening-hosted-1a3.mjs` (local server broker, real Auth/Realtime),
   `prepare-ecom-acl-1a3.mjs` (execute generated SQL with ROLLBACK), and
   `ecom-edge-race-1a3.mjs` (temporary Edge + independent HTTP transactions).
5. `ecom-native-expiry-1a3.mjs` runs a separate transport-only allowlist for a
   full native JWT lifetime. It never changes global TTL and saves incremental
   redacted evidence. It must finish/stop and delete its Auth identity before
   removing the expiry instrumentation. It does not extend a Lanzo grant.
6. Stop clients, collect/delete only this inventory's Auth users, remove the
   temporary Edge endpoint and its four dedicated secrets. Delete bridge grants
   and identities before the generated `fixture-cleanup.sql`. Remove receipt
   rows before grants. Apply this folder's `rollback.sql`, then the 1A.2 rollback
   in one explicit cleanup migration. Preserve every audit ledger entry.
7. Compare catalog, six ACLs/bodies, original three policies, synthetic-row counts,
   Auth IDs/sessions/factors, Edge functions and secret names with preflight.

The QA React adapter/hook is OFF by default and has no App/Layout import.
Local GRANTED/offline state cannot authorize cloud: credentials are captured
against the exact Actor Runtime handle and every issue/renewal is verified by
SQL. Duplicate mounts share only a runtime ID, never tokens or credentials;
authoritative denial stays latched for that actor generation. POS offline state
and financial/storage controllers are not modified.
