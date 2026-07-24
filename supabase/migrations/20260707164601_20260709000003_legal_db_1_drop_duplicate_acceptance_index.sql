-- LEGAL.DB.1 follow-up: remove duplicated unique index detected by Supabase
-- Performance Advisor. The hardening migration creates the canonical index
-- ux_legal_acceptances_license_term; the pre-existing
-- legal_acceptances_license_term_key covers the same columns and can be removed
-- without touching legal acceptance rows.

drop index if exists public.legal_acceptances_license_term_key;;
