-- CANDIDATA NO CERTIFICADA. Construida contra el snapshot versionado en
-- docs/reports/fin01-r22/extra-functions.sql; no prueba el cuerpo instalado hoy.
-- Aplicar solo después de PAY-N01 pre-fix en el laboratorio PostgreSQL 17.11.
-- La ejecución aborta ante cualquier drift; no crear/activar un gate comercial.
-- Forward-only. El bloque DO es transaccional: cualquier pre/postcondición que
-- falle aborta la sustitución y PostgreSQL conserva la definición anterior.
-- Recuperación de laboratorio: conservar los reportes, descartar solo la DB
-- sintética fallida y reconstruirla desde raw-evidence.zip antes de reintentar.
-- Tras un commit, no restaurar automáticamente el cuerpo antiguo: reintroduce
-- el defecto. Una reversión de emergencia exige revisión separada, suspensión
-- controlada de la ruta afectada y conciliación de los efectos observados.

do $pay_n01$
declare
  v_proc regprocedure := to_regprocedure(
    'public.pos_record_customer_payment_unlimited(text,text,text,text,text,numeric,text,text,text,jsonb,text)'
  );
  v_definition text;
  v_after_definition text;
  v_initial_marker constant text := $marker$  select exists(
    select 1 from public.pos_customer_ledger l
    where l.license_id = v_license_id
      and l.customer_id = p_customer_id
      and l.deleted_at is null
  ) into v_initial_exists;
$marker$;
  v_debt_marker constant text := $marker$  select coalesce(sum(l.amount), 0)$marker$;
  v_target_marker constant text := $marker$  v_allocations := private.validate_customer_payment_allocations(coalesce(p_allocations, '[]'::jsonb), v_amount);$marker$;
  v_start integer;
  v_debt_start integer;
  v_target integer;
  v_debt_offset integer;
  v_initial_block text;
  v_owner oid;
  v_acl aclitem[];
  v_config text[];
  v_security_definer boolean;
  v_result_type text;
  v_old_owner oid;
  v_old_acl aclitem[];
  v_old_config text[];
  v_old_security_definer boolean;
  v_old_result_type text;
  v_before_sha256 constant text := '73ce2f73f985eada337800b1ed18b9242c1f57948a23c48a57542f522ead8bf4';
  v_after_sha256 constant text := 'b978efa200c134a9754cd30568d6e1a824b5b07fa01c5c3ad0eaf475d84e5d1b';
begin
  if v_proc is null then
    raise exception 'PAY_N01_FUNCTION_SIGNATURE_MISSING';
  end if;

  select p.proowner, p.proacl, p.proconfig, p.prosecdef, pg_get_function_result(p.oid)
    into v_old_owner, v_old_acl, v_old_config, v_old_security_definer, v_old_result_type
  from pg_catalog.pg_proc p
  where p.oid = v_proc;

  if v_old_security_definer is not true
     or v_old_result_type <> 'jsonb'
     or not exists (
       select 1 from unnest(coalesce(v_old_config, array[]::text[])) setting
       where setting = 'search_path=""'
     ) then
    raise exception 'PAY_N01_FUNCTION_SECURITY_OR_RESULT_DRIFT';
  end if;

  v_definition := replace(pg_get_functiondef(v_proc), chr(13), '');
  if encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex') <> v_before_sha256 then
    raise exception 'PAY_N01_FUNCTION_DEFINITION_DRIFT';
  end if;

  if length(v_definition) - length(replace(v_definition, v_initial_marker, '')) <> length(v_initial_marker)
     or length(v_definition) - length(replace(v_definition, v_debt_marker, '')) <> length(v_debt_marker)
     or length(v_definition) - length(replace(v_definition, v_target_marker, '')) <> length(v_target_marker) then
    raise exception 'PAY_N01_REWRITE_ANCHOR_DRIFT';
  end if;

  v_start := strpos(v_definition, v_initial_marker);
  v_debt_offset := strpos(substr(v_definition, v_start), v_debt_marker);
  if v_start <= 0 or v_debt_offset <= 0 then
    raise exception 'PAY_N01_INITIAL_BALANCE_BLOCK_MISSING';
  end if;
  v_debt_start := v_start + v_debt_offset - 1;
  v_initial_block := substr(v_definition, v_start, v_debt_start - v_start);

  -- Keep debt fallback/read and rejection before any INITIAL_BALANCE write.
  v_definition := substr(v_definition, 1, v_start - 1) || substr(v_definition, v_debt_start);
  v_target := strpos(v_definition, v_target_marker);
  if v_target <= 0 then
    raise exception 'PAY_N01_POST_VALIDATION_INSERTION_POINT_MISSING';
  end if;
  v_definition := substr(v_definition, 1, v_target - 1) || v_initial_block || substr(v_definition, v_target);

  if encode(extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'), 'hex') <> v_after_sha256
     or not (
       strpos(v_definition, 'PAYMENT_EXCEEDS_DEBT') < strpos(v_definition, 'auto_initial_balance_before_payment')
       and strpos(v_definition, 'CASH_SESSION_REQUIRED') < strpos(v_definition, 'auto_initial_balance_before_payment')
       and strpos(v_definition, 'CASH_SESSION_CLOSED') < strpos(v_definition, 'auto_initial_balance_before_payment')
       and strpos(v_definition, 'CASH_SESSION_NOT_OWNED_BY_ACTOR') < strpos(v_definition, 'auto_initial_balance_before_payment')
     ) then
    raise exception 'PAY_N01_REWRITE_POSTCONDITION_FAILED';
  end if;

  execute v_definition;

  select p.proowner, p.proacl, p.proconfig, p.prosecdef, pg_get_function_result(p.oid)
    into v_owner, v_acl, v_config, v_security_definer, v_result_type
  from pg_catalog.pg_proc p
  where p.oid = v_proc;

  if v_owner is distinct from v_old_owner
     or v_acl is distinct from v_old_acl
     or v_config is distinct from v_old_config
     or v_security_definer is distinct from v_old_security_definer
     or v_result_type is distinct from v_old_result_type then
    raise exception 'PAY_N01_FUNCTION_SECURITY_OR_ACL_CHANGED';
  end if;

  v_after_definition := replace(pg_get_functiondef(v_proc), chr(13), '');
  if encode(extensions.digest(convert_to(v_after_definition, 'UTF8'), 'sha256'), 'hex') <> v_after_sha256 then
    raise exception 'PAY_N01_INSTALLED_DEFINITION_POSTCONDITION_FAILED';
  end if;
end;
$pay_n01$;

