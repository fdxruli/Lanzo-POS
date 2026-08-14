-- CASH PRO FASE 4: make the audited/unverified closure invariant explicit.
-- This is intentionally limited to the administrative closure contract added in
-- Phase 2; local cash and ordinary staff closure contracts remain untouched.
begin;

alter table public.pos_cash_sessions
  drop constraint if exists pos_cash_sessions_admin_closure_integrity_chk,
  add constraint pos_cash_sessions_admin_closure_integrity_chk
    check (
      closing_mode is null
      or (
        status = 'closed'
        and closed_at is not null
        and closed_by_admin_user_id is not null
        and closed_by_device_id is not null
        and closure_reason_code is not null
        and close_detail @> jsonb_build_object('closing_mode', closing_mode)
        and close_detail ? 'expected_cash_total'
        and (
          (
            closing_mode = 'admin_audited'
            and closing_counted_amount is not null
            and closing_counted_amount >= 0
            and cash_difference is not null
            and next_shift_fund >= 0
            and next_shift_fund <= closing_counted_amount
            and reconciliation_status in ('verified', 'verified_with_difference')
          )
          or (
            closing_mode = 'admin_unverified'
            and closing_counted_amount is null
            and cash_difference is null
            and next_shift_fund = 0
            and reconciliation_status = 'unverified'
            and nullif(btrim(audit_comments), '') is not null
          )
        )
      )
    );

comment on constraint pos_cash_sessions_admin_closure_integrity_chk on public.pos_cash_sessions is
  'Administrative closures preserve a physical-count snapshot; unverified closures use NULL, never zero, for count and difference.';

commit;
