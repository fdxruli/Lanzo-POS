-- CLOUD LAYAWAYS READ RPC TRANSACTION MODE R1
--
-- The read RPCs authenticate the caller through
-- private.validate_pos_sync_context(...). That boundary may persist the
-- authenticated session heartbeat, so the public wrappers cannot be
-- declared STABLE. This migration changes only their volatility metadata.
-- Function bodies, security, search_path, signatures, and grants remain
-- unchanged.

begin;

alter function public.pos_get_layaway(text, text, text, text, text)
  volatile;

alter function public.pos_pull_layaway_changes(text, text, text, text, bigint, integer)
  volatile;

commit;
