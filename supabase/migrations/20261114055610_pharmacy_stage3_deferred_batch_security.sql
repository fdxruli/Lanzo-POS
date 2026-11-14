-- P0: deferred triggers run after the SECURITY DEFINER financial RPC returns.
-- Prepared only: installation requires separate Production authorization.
-- Fail closed on drift; do not replace the installed validation body or ACL.
begin;
do $preconditions$
declare
  f pg_catalog.pg_proc%rowtype;
begin
  select * into strict f from pg_catalog.pg_proc
  where oid = 'private.pharmacy_stage3_require_final_batch()'::pg_catalog.regprocedure;
  if pg_catalog.pg_get_userbyid(f.proowner) <> 'postgres'
     or f.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype
     or f.pronargs <> 0
     or f.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.md5(f.prosrc) <> '7e42cfb86755add1f81755bc3a87ee94'
     or exists (
       select 1 from pg_catalog.aclexplode(coalesce(f.proacl,
         pg_catalog.acldefault('f',f.proowner))) a
       where a.grantee <> f.proowner
     ) then
    raise exception 'PHARMACY_STAGE3_FINAL_BATCH_SECURITY_PRECONDITION_FAILED';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.pos_sale_items'::pg_catalog.regclass
      and t.tgname = 'trg_pharmacy_stage3_final_batch'
      and t.tgfoid = f.oid and t.tgenabled = 'O'
      and t.tgdeferrable and t.tginitdeferred and t.tgtype = 5
      and t.tgqual is null and t.tgnargs = 0
  ) then
    raise exception 'PHARMACY_STAGE3_FINAL_BATCH_TRIGGER_PRECONDITION_FAILED';
  end if;
end;
$preconditions$;

alter function private.pharmacy_stage3_require_final_batch() security definer;

-- Explicitly authorized extension: absent optional classification must not
-- turn an ordinary pharmacy product into a prescription-required product.
do $dispense_preconditions$
declare f pg_catalog.pg_proc%rowtype;
begin
  select * into strict f from pg_catalog.pg_proc
  where oid = 'private.pharmacy_stage3_dispense_on_sale_item()'::pg_catalog.regprocedure;
  if pg_catalog.pg_get_userbyid(f.proowner) <> 'postgres' or f.prosecdef
     or f.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.md5(f.prosrc) not in (
       '67b260c087b0633795bc623a013663a3', -- installed original
       '36467d89c7fdda240a6b0fe39d09a2c2' -- this idempotent correction
     )
     or exists (
       select 1 from pg_catalog.aclexplode(coalesce(f.proacl,
         pg_catalog.acldefault('f',f.proowner))) a where a.grantee <> f.proowner
     ) then
    raise exception 'PHARMACY_STAGE3_DISPENSE_PRECONDITION_FAILED';
  end if;
end;
$dispense_preconditions$;

create or replace function private.pharmacy_stage3_dispense_on_sale_item()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_product public.pos_products%rowtype;
  v_sale public.pos_sales%rowtype;
  v_pharmacy jsonb;
  v_rx jsonb := new.metadata->'pharmacyDispensationV1';
  v_required boolean;
  v_antibiotic boolean;
  v_special text;
  v_ref text;
  v_doctor text;
  v_license text;
  v_address text;
  v_issue date;
  v_treatment date;
  v_prescribed numeric;
  v_rx_row private.pharmacy_prescriptions_v1%rowtype;
  v_line private.pharmacy_prescription_items_v1%rowtype;
  v_retained boolean;
  v_today date := (pg_catalog.now() at time zone 'America/Merida')::date;
begin
  if not exists (
    select 1 from public.business_profiles b
    where b.license_id=new.license_id
      and 'farmacia'::public.business_category=any(b.business_type)
  ) then return new; end if;

  select * into v_product from public.pos_products p
  where p.id=new.product_id and p.license_id=new.license_id for share;
  if not found then
    raise exception 'PHARMACY_DISPENSATION_PRODUCT_UNVERIFIED' using errcode='P0001';
  end if;
  v_pharmacy := v_product.metadata->'pharmacy';
  v_special := v_pharmacy->>'fraction';
  v_antibiotic := coalesce((v_pharmacy->>'antibiotic')::boolean,false)
     or v_product.prescription_type='antibiotic';
  if v_special in ('I','II','III') then
    raise exception 'PHARMACY_SPECIAL_FRACTION_SALE_FORBIDDEN' using errcode='P0001';
  end if;
  if v_pharmacy->>'kind'='medicine' and v_pharmacy->>'status' is distinct from 'confirmed' then
    raise exception 'PHARMACY_CLASSIFICATION_PENDING' using errcode='P0001';
  end if;
  v_required := coalesce(v_antibiotic or v_special='IV'
    or v_product.requires_prescription is true
    or coalesce(v_product.prescription_type,'otc') <> 'otc', false);
  if not v_required then return new; end if;

  if pg_catalog.jsonb_typeof(v_rx) is distinct from 'object'
     or v_rx->>'version' is distinct from '1' then
    raise exception 'PHARMACY_PRESCRIPTION_REQUIRED' using errcode='P0001';
  end if;

  v_ref := nullif(pg_catalog.btrim(v_rx->>'reference'),'');
  v_doctor := nullif(pg_catalog.btrim(v_rx->>'prescriberName'),'');
  v_license := nullif(pg_catalog.btrim(v_rx->>'prescriberLicense'),'');
  v_address := nullif(pg_catalog.btrim(v_rx->>'prescriberAddress'),'');
  if v_ref is null or v_doctor is null or v_license is null or v_address is null
    or pg_catalog.length(v_ref) not between 2 and 100
    or pg_catalog.length(v_doctor) not between 3 and 180
    or pg_catalog.length(v_license) not between 4 and 40
    or pg_catalog.length(v_address) not between 6 and 240
    or coalesce(v_rx->>'issuedOn','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(v_rx->>'treatmentUntil','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(v_rx->>'prescribedQuantity','') !~ '^\d{1,11}(\.\d{1,3})?$'
  then
    raise exception 'PHARMACY_PRESCRIPTION_FIELDS_INVALID' using errcode='P0001';
  end if;
  v_issue := (v_rx->>'issuedOn')::date;
  v_treatment := (v_rx->>'treatmentUntil')::date;
  v_prescribed := (v_rx->>'prescribedQuantity')::numeric;
  if v_issue>v_today or v_treatment<v_today or v_treatment<v_issue
     or v_prescribed<=0 or new.quantity<=0 then
    raise exception 'PHARMACY_PRESCRIPTION_EXPIRED_OR_QUANTITY_INVALID' using errcode='P0001';
  end if;

  select * into v_sale from public.pos_sales s
  where s.id=new.sale_id and s.license_id=new.license_id for share;
  if not found or v_sale.status <> 'closed' or v_sale.actor_key is null then
    raise exception 'PHARMACY_DISPENSATION_SALE_UNVERIFIED' using errcode='P0001';
  end if;

  insert into private.pharmacy_prescriptions_v1 (
    license_id,reference,prescriber_name,prescriber_license,prescriber_address,
    issued_on,treatment_until,recorded_by
  ) values (
    new.license_id,v_ref,v_doctor,v_license,v_address,
    v_issue,v_treatment,v_sale.actor_key
  ) on conflict (license_id,reference_key,prescriber_license,issued_on) do nothing;

  select * into v_rx_row from private.pharmacy_prescriptions_v1 r
  where r.license_id=new.license_id
    and r.reference_key=pg_catalog.upper(v_ref)
    and r.prescriber_license=v_license and r.issued_on=v_issue
  for update;

  if not found or v_rx_row.prescriber_name is distinct from v_doctor
     or v_rx_row.prescriber_address is distinct from v_address
     or v_rx_row.treatment_until is distinct from v_treatment
     or v_rx_row.status='void' then
    raise exception 'PHARMACY_PRESCRIPTION_DOCUMENT_CONFLICT' using errcode='P0001';
  end if;

  -- Una receta retenida no se reusa en otra venta. Permitir otras lineas
  -- de la MISMA venta que declararon su retencion conjuntamente.
  if v_rx_row.status='retained' and not exists (
    select 1 from private.pharmacy_dispensations_v1 d
    where d.license_id=new.license_id
      and d.prescription_id=v_rx_row.id and d.sale_id=new.sale_id
  ) then
    raise exception 'PHARMACY_PRESCRIPTION_ALREADY_RETAINED' using errcode='P0001';
  end if;

  insert into private.pharmacy_prescription_items_v1
    (license_id,prescription_id,product_id,prescribed_quantity)
  values (new.license_id,v_rx_row.id,new.product_id,v_prescribed)
  on conflict (license_id,prescription_id,product_id) do nothing;

  select * into v_line from private.pharmacy_prescription_items_v1 l
  where l.license_id=new.license_id
    and l.prescription_id=v_rx_row.id and l.product_id=new.product_id
  for update;
  if not found or v_line.prescribed_quantity is distinct from v_prescribed then
    raise exception 'PHARMACY_PRESCRIPTION_QUANTITY_CONFLICT' using errcode='P0001';
  end if;
  if v_line.dispensed_quantity+new.quantity>v_line.prescribed_quantity then
    raise exception 'PHARMACY_PRESCRIPTION_BALANCE_EXCEEDED' using errcode='P0001';
  end if;

  if v_antibiotic and v_rx->>'stampDeclared' is distinct from 'true' then
    raise exception 'PHARMACY_PRESCRIPTION_STAMP_REQUIRED' using errcode='P0001';
  end if;
  if v_antibiotic
     and v_line.dispensed_quantity+new.quantity=v_line.prescribed_quantity
     and v_rx->>'retentionDeclared' is distinct from 'true' then
    raise exception 'PHARMACY_PRESCRIPTION_RETENTION_REQUIRED' using errcode='P0001';
  end if;

  -- La llave unica de sale_item impide consumir dos veces la misma linea.
  insert into private.pharmacy_dispensations_v1
    (license_id,sale_item_id,sale_id,prescription_id,product_id,batch_id,quantity,
     stamp_declared,retention_declared,actor_key)
  values
    (new.license_id,new.id,new.sale_id,v_rx_row.id,new.product_id,new.batch_id,
     new.quantity,coalesce((v_rx->>'stampDeclared')::boolean,false),
     coalesce((v_rx->>'retentionDeclared')::boolean,false),v_sale.actor_key);

  update private.pharmacy_prescription_items_v1 l
  set dispensed_quantity=l.dispensed_quantity+new.quantity
  where l.license_id=new.license_id
    and l.prescription_id=v_rx_row.id and l.product_id=new.product_id;

  if v_rx->>'retentionDeclared'='true' then
    update private.pharmacy_prescriptions_v1
    set status='retained' where license_id=new.license_id and id=v_rx_row.id;
  end if;
  return new;
end;
$$;
commit;
