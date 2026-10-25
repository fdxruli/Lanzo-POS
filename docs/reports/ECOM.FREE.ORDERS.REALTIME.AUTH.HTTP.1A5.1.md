# Lanzo E-commerce QA HTTP authentication gate — 1A.5.1

**Estado: `HOLD_USAGE`.** PR #368 stays OPEN / Draft / no merge. This change only corrects and verifies the QA Edge Function HTTP boundary. It does not deploy the function, activate the pilot, create identities or grants, emit `qa_probe`, or change SQL.

## Decision

The browser's `createEcomSignalBrokerClient` sends `POST` with `apikey` and `Content-Type: application/json`; it has no Supabase Auth JWT in `Authorization`. Supabase's current Edge Function authentication documentation has conflicting statements about whether the built-in `verify_jwt` check accepts new API keys. The function-specific guidance says publishable keys belong in `apikey`, the built-in check validates JWTs, and API keys must be authorized in the function. We therefore use option B and do not depend on an ambiguous gateway compatibility path.

`verify_jwt = false` is scoped to `[functions.lanzo-ecom-bridge-qa]` only. The handler accepts only exact matches from this project's `SUPABASE_PUBLISHABLE_KEYS` values or its legacy `SUPABASE_ANON_KEY`. It does not read `SUPABASE_SECRET_KEYS`, `SUPABASE_SERVICE_ROLE_KEY`, or a browser-supplied identity. Missing or malformed key configuration fails closed; missing, invalid, or foreign-project keys receive the same sanitized `401`.

An API key identifies the application component only. Every issue or recovery request still reaches the canonical Lanzo RPC with the license key, device fingerprint, device security token, actor session token, and runtime generations. The database resolves and authorizes the actor, device, license, Ecommerce feature, allowlist and kill switch. Administrative actions still require the dedicated `x-lanzo-qa-control` value. The control token, service role key, password key and Vault keys are not accepted as browser credentials.

## HTTP and security tests

`scripts/supabase/ecom-http-auth-contract.node-test.mjs` starts a local TCP HTTP server around the actual handler and invokes it with the actual browser broker client. The positive fixture sends the browser's real headers, omits `Authorization`, reaches broker issuance and returns only the connection response. That positive path uses synthetic test credentials and a fake RPC transport; it is not hosted issuance or a live authorization grant.

The HTTP tests cover missing, invalid and other-project API keys; a valid app key without Lanzo credentials; wrong content type; payloads above 8 KiB; absent and incorrect admin control; and sanitized server errors. Existing focal tests cover bounded client retries (five retries maximum) and a candidate authorization matrix with source assertions for the database device limit (20 attempts per minute), allowlist and cross-license denial, wrong device token, invalid actor, Staff without Ecommerce, active kill switch, actor/session/device binding, ACL closure, and `qa_probe`-only delivery. These candidate tests are not hosted database execution. The deployment test asserts `verify_jwt = false` appears only under this function.

## Current production snapshot — read only

Verified against project `odlrhijtfyavryeqivaa` on 2026-10-24:

- Project `ACTIVE_HEALTHY`; migration ledger has 332 entries and ends at `20261024130558`.
- Eight QA tables have RLS. Allowlist has zero rows; kill switch is active.
- Zero QA identities, grants, Auth users, Auth sessions, or grants containing Vault ciphertext.
- The six approved shared RPC signatures exist and all have `PUBLIC EXECUTE` revoked; explicit `anon`, `authenticated` and `service_role` privileges are unchanged.
- All 16 QA RPCs are executable by `service_role` and not by `anon` or `authenticated`.
- Auth actor binding resolver, revocation RPC, and three collector RPCs exist. Realtime has the three existing policies plus the QA receiver policy.
- The project lists only `lanzo-ai-agent` v49 and `authorize-image-upload` v31. `lanzo-ecom-bridge-qa` is not deployed, so no effective hosted `verify_jwt` value exists yet. No deployment or SQL write was performed for this gate.

## Usage and secrets

The available Supabase connector can read project metadata, functions and SQL state, but it does not expose the current-cycle Usage panel. Its `get_cost` operation estimates project or branch creation cost and is not Usage. Logs and database connection counts are not substitutes. No Usage values are certified; remain `HOLD_USAGE` until the owner supplies a current dashboard capture showing Edge invocations, Realtime messages, peak concurrent connections, Auth MAU, egress, database, storage, plan limits and residual headroom.

No secret values were read or printed. The connector has no safe secret-presence/format inspection action, and the QA function is not deployed. The owner must install `LANZO_ECOM_QA_CONTROL_TOKEN`, `LANZO_ECOM_VAULT_KEY_ID`, `LANZO_ECOM_VAULT_KEYS`, `LANZO_ECOM_PASSWORD_KEY_ID`, and `LANZO_ECOM_PASSWORD_KEY` through the approved secure channel and confirm only their presence and format; Vault and password-derivation materials must remain distinct.

## Next gate

After current Usage and owner secret confirmation, certify CI for the final SHA and deploy only `lanzo-ecom-bridge-qa`. Verify its effective `verify_jwt = false`, repeat negative HTTP checks while the kill switch is ON and allowlist empty, then pause for the owner's supervised physical-device session. Do not approve the pilot, disable the kill switch, or run Hosted QA autonomously.


## CI results for implementation SHA dd97ceed

The GitHub checks completed on 2026-10-25:

- [Ecommerce Native Bridge QA, run 40162324270](https://github.com/fdxruli/Lanzo-POS/actions/runs/40162324270): **raw workflow FAIL**. Build, store build, Deno check, ESLint, and the focal broker/receiver contract step passed (47/47). The repository-wide Node contract command reported 237/238 passing; its sole failure is the unchanged `license-expired-material-downgrade-r1.node-test.mjs` assertion `phase 2 never mutates financial state`. The regex rejects `ledger`, which appears in a comment in the migration the test reads. The HTTP-auth tests are included among the passing contracts.
- The same run’s regression artifact reports **20 failed suite records / 10 failed tests**. The failed assertions are in unchanged ecommerce catalog, draft, inventory, public checkout and tracking tests, including `ecommercePosDraftService.test.js`, `ecommercePosInventoryResolution.test.js`, `ecommercePublicConfiguredService.test.js`, `ecommercePublicService.test.js` and `ecommercePublicTrackingContract.test.js`. No files in those areas were changed by this gate. [Regression artifact](https://github.com/fdxruli/Lanzo-POS/actions/runs/40162324270/artifacts/12587115609).
- [PR127 Global Comparison, run 40162324258](https://github.com/fdxruli/Lanzo-POS/actions/runs/40162324258): **workflow SUCCESS; differential artifact status=OK**. It reports 99 candidate failures, 100 base failures, 99 shared, 0 raw candidate-only, 0 new and 0 unresolved; one base failure was resolved. [Comparison artifact](https://github.com/fdxruli/Lanzo-POS/actions/runs/40162324258/artifacts/12587261017).
- The PR’s `Vercel – lanzo-pos` check is **success**. No manual Vercel Production deployment or promotion was performed.

The implementation’s local focused suite remains 77/77 PASS, and `deno check` and `git diff --check` pass. The raw repository workflow is not fully green; differential comparison found no new failure from this gate. This does not clear the Usage or owner-secret gates: status remains `HOLD_USAGE`, and no hosted QA step is authorized until the owner supplies current Usage and confirms secret presence/format.
