-- Cloud cash sessions are always manual/audited.
-- Auto-opening remains a local/FREE feature and must not be part of the Supabase contract.

ALTER TABLE IF EXISTS public.pos_cash_sessions
  DROP COLUMN IF EXISTS opening_policy,
  DROP COLUMN IF EXISTS is_auto_opening;

CREATE OR REPLACE FUNCTION private.pos_cash_session_to_jsonb(p_session public.pos_cash_sessions)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT to_jsonb(p_session) - 'opening_policy' - 'is_auto_opening';
$$;

COMMENT ON FUNCTION private.pos_cash_session_to_jsonb(public.pos_cash_sessions)
IS 'Serializes cloud cash sessions without local-only auto-opening fields. Cloud openings are always manual/audited.';

CREATE OR REPLACE FUNCTION private.enforce_manual_cash_opening_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.opening_amount IS NULL THEN
    RAISE EXCEPTION 'El fondo confirmado es obligatorio.'
      USING ERRCODE = '22023',
            HINT = 'OPENING_AMOUNT_REQUIRED';
  END IF;

  IF NEW.opening_counted_amount IS NULL THEN
    RAISE EXCEPTION 'El efectivo contado es obligatorio.'
      USING ERRCODE = '22023',
            HINT = 'OPENING_COUNTED_AMOUNT_REQUIRED';
  END IF;

  IF NEW.opening_amount < 0
    OR NEW.opening_counted_amount < 0
    OR COALESCE(NEW.opening_suggested_amount, 0) < 0
  THEN
    RAISE EXCEPTION 'Los montos de apertura no pueden ser negativos.'
      USING ERRCODE = '22023',
            HINT = 'OPENING_AMOUNT_INVALID';
  END IF;

  IF NEW.opening_amount IS DISTINCT FROM NEW.opening_counted_amount THEN
    RAISE EXCEPTION 'El fondo confirmado debe coincidir con el efectivo contado.'
      USING ERRCODE = '22023',
            HINT = 'OPENING_COUNT_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.enforce_manual_cash_opening_contract()
IS 'Enforces audited/manual opening amounts for cloud cash sessions.';

DROP TRIGGER IF EXISTS trg_pos_cash_sessions_manual_opening_contract
  ON public.pos_cash_sessions;

CREATE TRIGGER trg_pos_cash_sessions_manual_opening_contract
BEFORE INSERT OR UPDATE OF opening_amount, opening_counted_amount, opening_suggested_amount
ON public.pos_cash_sessions
FOR EACH ROW
EXECUTE FUNCTION private.enforce_manual_cash_opening_contract();

DO $$
BEGIN
  IF to_regprocedure('public.pos_open_cash_session(text,text,text,text,jsonb,text)') IS NOT NULL THEN
    COMMENT ON FUNCTION public.pos_open_cash_session(text,text,text,text,jsonb,text)
    IS 'Cloud cash opening is manual/audited. Do not accept or emit opening_policy or is_auto_opening.';
  END IF;

  IF to_regprocedure('public.pos_open_cash_session_unlimited(text,text,text,text,jsonb,text)') IS NOT NULL THEN
    COMMENT ON FUNCTION public.pos_open_cash_session_unlimited(text,text,text,text,jsonb,text)
    IS 'Cloud cash opening is manual/audited. Do not accept or emit opening_policy or is_auto_opening.';
  END IF;
END;
$$;
