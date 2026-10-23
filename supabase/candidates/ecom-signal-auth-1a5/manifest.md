# 1A.5 object manifest

`allowlist.sql` is an unapplied candidate overlay. It depends on the reviewed
1A.2, 1A.3, and 1A.4 candidate chain. No production QA objects were installed
for this continuation.

## Created

- `lanzo_ecom_bridge_qa.pilot_allowlist`
- `lanzo_ecom_bridge_qa.pilot_allowlist_one_approved_device` (partial unique index)
- `lanzo_ecom_bridge_qa.pilot_kill_switch` (one singleton row, active by default)
- `lanzo_ecom_bridge_qa.acl_closed()`
- `lanzo_ecom_bridge_qa.pilot_device_eligible(uuid,uuid,uuid)`
- `public.lanzo_ecom_bridge_qa_approve_pilot(uuid,uuid,uuid,timestamptz,uuid,text,text)`
- `public.lanzo_ecom_bridge_qa_set_kill_switch(boolean,text)`
- `public.lanzo_ecom_bridge_qa_revoke_pilot(uuid)`

## Replaced or altered

- Replace `lanzo_ecom_bridge_qa.authority_live(uuid,uuid,text,uuid,uuid)` with
  the combined allowlist, FREE plan, entitlement, device, actor-session,
  kill-switch, and six-RPC ACL guard.
- Replace `public.lanzo_ecom_bridge_qa_prepare(jsonb)` and
  `public.lanzo_ecom_bridge_qa_quarantine(jsonb)` with native-Auth-compatible
  allowlist enforcement and canonical Lanzo actor resolution.
- Change `lanzo_ecom_bridge_qa.identities.license_id` from the synthetic
  `qa_tenants` foreign key to `public.licenses(id)`. Keep `qa_tenants` empty so
  the existing 1A.2 rollback remains available.
- Do not modify the six shared function bodies or their ACLs. Their separate
  proposal and exact rollback are `public-rpc-acl-proposal.sql` and
  `public-rpc-acl-rollback.sql` in this candidate directory.

## Rollback order

1. Apply `rollback.sql` while the broker can still authenticate its server-only
   control request, or run its SQL directly as the authorized operator. This
   turns on the kill switch and revokes/vault-clears grants in one transaction.
2. Stop the QA Edge Function. Run the 1A.4 collector to remove only tagged QA
   Auth users and verify zero sessions, grants, leases, and vaults.
3. Apply the reviewed 1A.4, 1A.3, and 1A.2 object rollbacks in reverse order.
4. Never roll back the shared ACL proposal unless separately approved; it is
   not part of this overlay.

The SQL has source-contract and local authorization-matrix tests. PostgreSQL
syntax, Hosted Auth, and Realtime have not been exercised for this overlay.
