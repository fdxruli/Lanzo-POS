-- LANZO POS / Farmacia Etapa 3. PREPARADA, NO INSTALADA.
-- DOF 27/05/2010: recetas de antibioticos, sello por surtido, retencion final.
-- Unicamente adiciona tablas privadas y triggers sobre lineas de venta Cloud.
-- Las ventas no farmacéuticas se omiten. I-III siguen bloqueadas por Etapa 1.
--
-- Orden: fusionar el SQL canónico a main, autorizar instalación Production,
-- instalar SQL ANTES de publicar el cliente de Etapa 3, validar Cloud y QA físico.
-- La instalación bloquea ventas legacy de farmacia que requieren receta y omiten
-- pharmacyDispensationV1. No ejecutar db push general.

create table if not exists private.pharmacy_prescriptions_v1 (
  id text primary key default pg_catalog.gen_random_uuid()::text,
  license_id uuid not null references public.licenses(id),
  reference text not null check (length(pg_catalog.btrim(reference)) between 2 and 100),
  reference_key text generated always as (pg_catalog.upper(pg_catalog.btrim(reference))) stored,
  prescriber_name text not null check (length(pg_catalog.btrim(prescriber_name)) between 3 and 180),
  prescriber_license text not null check (length(pg_catalog.btrim(prescriber_license)) between 4 and 40),
  prescriber_address text not null check (length(pg_catalog.btrim(prescriber_address)) between 6 and 240),
  issued_on date not null,
  treatment_until date not null,
  status text not null default 'active' check (status in ('active','retained','void')),
  recorded_by text not null,
  created_at timestamptz not null default pg_catalog.now(),
  unique (license_id,reference_key,prescriber_license,issued_on),
  unique (license_id,id),
  check (treatment_until >= issued_on)
);

create table if not exists private.pharmacy_prescription_items_v1 (
  license_id uuid not null,
  prescription_id text not null,
  product_id text not null,
  prescribed_quantity numeric(14,3) not null check (prescribed_quantity > 0),
  dispensed_quantity numeric(14,3) not null default 0 check (dispensed_quantity >= 0 and dispensed_quantity <= prescribed_quantity),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (license_id,prescription_id,product_id),
  foreign key (license_id,prescription_id) references private.pharmacy_prescriptions_v1(license_id,id) on delete restrict,
  foreign key (product_id) references public.pos_products(id) on delete restrict
);

create table if not exists private.pharmacy_dispensations_v1 (
  license_id uuid not null references public.licenses(id),
  sale_item_id text not null,
  sale_id text not null references public.pos_sales(id) on delete restrict,
  prescription_id text not null,
  product_id text not null references public.pos_products(id) on delete restrict,
  batch_id text null references public.pos_product_batches(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  stamp_declared boolean not null default false,
  retention_declared boolean not null default false,
  actor_key text not null,
  dispensed_at timestamptz not null default pg_catalog.now(),
  state text not null default 'confirmed' check (state = 'confirmed'),
  primary key (license_id,sale_item_id),
  foreign key (sale_item_id) references public.pos_sale_items(id) on delete restrict,
  foreign key (license_id,prescription_id,product_id)
    references private.pharmacy_prescription_items_v1(license_id,prescription_id,product_id)
    on delete restrict
);

create index if not exists idx_pharmacy_disp_rx_product
  on private.pharmacy_dispensations_v1 (license_id,prescription_id,product_id,dispensed_at);
create index if not exists idx_pharmacy_disp_sale
  on private.pharmacy_dispensations_v1 (license_id,sale_id);

alter table private.pharmacy_prescriptions_v1 enable row level security;
alter table private.pharmacy_prescription_items_v1 enable row level security;
alter table private.pharmacy_dispensations_v1 enable row level security;
revoke all on private.pharmacy_prescriptions_v1 from public,anon,authenticated;
revoke all on private.pharmacy_prescription_items_v1 from public,anon,authenticated;
revoke all on private.pharmacy_dispensations_v1 from public,anon,authenticated;

-- Guardar la dispensacion al insertar la linea del cobro. 6B, 6C y credito
-- invocan la misma INSERT: un RAISE revierte venta, caja, credito e inventario.
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
  v_required := v_antibiotic or v_special='IV'
    or v_product.requires_prescription is true
    or coalesce(v_product.prescription_type,'otc') <> 'otc';
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

drop trigger if exists trg_pharmacy_stage3_dispense_insert on public.pos_sale_items;
create trigger trg_pharmacy_stage3_dispense_insert
after insert on public.pos_sale_items for each row
execute function private.pharmacy_stage3_dispense_on_sale_item();

-- Cloud inventario 6C asigna el lote despues de insertar la linea, en la
-- misma transaccion. Solo esa actualizacion puede completar la traza.
create or replace function private.pharmacy_stage3_track_batch()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.batch_id is distinct from old.batch_id then
    update private.pharmacy_dispensations_v1 d
    set batch_id=new.batch_id
    where d.license_id=new.license_id and d.sale_item_id=new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_pharmacy_stage3_batch_update on public.pos_sale_items;
create trigger trg_pharmacy_stage3_batch_update
after update of batch_id on public.pos_sale_items for each row
execute function private.pharmacy_stage3_track_batch();

-- Diferido: la venta Cloud NO puede confirmar sin lote verificado, aun si
-- la asignacion autoritativa sucede despues del INSERT inicial.
create or replace function private.pharmacy_stage3_require_final_batch()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if exists (
    select 1 from private.pharmacy_dispensations_v1 d
    join public.pos_sale_items si on si.id=d.sale_item_id
    where d.license_id=new.license_id and d.sale_item_id=new.id
      and (d.batch_id is null or si.batch_id is null or d.batch_id<>si.batch_id
           or not exists (
             select 1 from public.pos_product_batches b
             where b.license_id=d.license_id and b.id=d.batch_id and b.product_id=d.product_id
           ))
  ) then
    raise exception 'PHARMACY_DISPENSATION_BATCH_REQUIRED' using errcode='P0001';
  end if;
  return null;
end;
$$;
drop trigger if exists trg_pharmacy_stage3_final_batch on public.pos_sale_items;
create constraint trigger trg_pharmacy_stage3_final_batch
after insert on public.pos_sale_items
deferrable initially deferred for each row
execute function private.pharmacy_stage3_require_final_batch();

-- No borrar ni modificar dispensaciones confirmadas (cancelaciones son
-- eventos independientes; nunca restauran automaticamente saldo de receta).
create or replace function private.pharmacy_stage3_immutable_dispensation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op='UPDATE' and old.batch_id is null and new.batch_id is not null
     and (to_jsonb(new)-'batch_id')=(to_jsonb(old)-'batch_id') then
    return new;
  end if;
  raise exception 'PHARMACY_DISPENSATION_IMMUTABLE' using errcode='P0001';
end;
$$;
drop trigger if exists trg_pharmacy_stage3_disp_immutable on private.pharmacy_dispensations_v1;
create trigger trg_pharmacy_stage3_disp_immutable
before update or delete on private.pharmacy_dispensations_v1 for each row
execute function private.pharmacy_stage3_immutable_dispensation();

-- Lectura puntual autorizada por la misma identidad POS/RBAC que cobra.
-- Sin grants de tablas, no hay lectura directa de datos de prescriptores.
create or replace function public.pos_pharmacy_get_prescription_v1(
  p_license_key text,p_device_fingerprint text,p_security_token text,
  p_staff_session_token text,p_reference text,p_prescriber_license text,
  p_issued_on date,p_product_id text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_rx private.pharmacy_prescriptions_v1%rowtype;
  v_line private.pharmacy_prescription_items_v1%rowtype;
  v_history jsonb;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token
  );
  perform private.assert_pos_permission(v_context,'pos');
  v_license_id := (v_context->>'license_id')::uuid;
  if not exists (
    select 1 from public.business_profiles b where b.license_id=v_license_id
      and 'farmacia'::public.business_category=any(b.business_type)
  ) then raise exception 'PHARMACY_BUSINESS_REQUIRED' using errcode='P0001'; end if;
  if length(pg_catalog.btrim(coalesce(p_reference,'')))<2
    or length(pg_catalog.btrim(coalesce(p_prescriber_license,'')))<4
    or p_issued_on is null or nullif(pg_catalog.btrim(p_product_id),'') is null then
    raise exception 'PHARMACY_PRESCRIPTION_LOOKUP_INVALID' using errcode='P0001';
  end if;
  select * into v_rx from private.pharmacy_prescriptions_v1 r
  where r.license_id=v_license_id
    and r.reference_key=pg_catalog.upper(pg_catalog.btrim(p_reference))
    and r.prescriber_license=pg_catalog.btrim(p_prescriber_license)
    and r.issued_on=p_issued_on;
  if not found then return pg_catalog.jsonb_build_object(
    'success',true,'found',false,'dispensedQuantity',0,'history','[]'::jsonb
  ); end if;
  select * into v_line from private.pharmacy_prescription_items_v1 l
  where l.license_id=v_license_id and l.prescription_id=v_rx.id and l.product_id=p_product_id;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'saleId',d.sale_id,'saleItemId',d.sale_item_id,'batchId',d.batch_id,
      'quantity',d.quantity,'dispensedAt',d.dispensed_at,
      'stampDeclared',d.stamp_declared,'retentionDeclared',d.retention_declared
    ) order by d.dispensed_at desc),'[]'::jsonb)
  into v_history from (
    select * from private.pharmacy_dispensations_v1
    where license_id=v_license_id and prescription_id=v_rx.id and product_id=p_product_id
    order by dispensed_at desc limit 100
  ) d;
  return pg_catalog.jsonb_build_object(
    'success',true,'found',true,'prescriptionId',v_rx.id,
    'reference',v_rx.reference,'prescriberName',v_rx.prescriber_name,
    'prescriberLicense',v_rx.prescriber_license,'prescriberAddress',v_rx.prescriber_address,
    'issuedOn',v_rx.issued_on,'treatmentUntil',v_rx.treatment_until,
    'status',v_rx.status,'prescribedQuantity',v_line.prescribed_quantity,
    'dispensedQuantity',coalesce(v_line.dispensed_quantity,0),
    'remainingQuantity',case when v_line.product_id is not null
      then v_line.prescribed_quantity-v_line.dispensed_quantity else null end,
    'history',v_history
  );
end;
$$;

revoke all on function private.pharmacy_stage3_dispense_on_sale_item() from public,anon,authenticated,service_role;
revoke all on function private.pharmacy_stage3_track_batch() from public,anon,authenticated,service_role;
revoke all on function private.pharmacy_stage3_require_final_batch() from public,anon,authenticated,service_role;
revoke all on function private.pharmacy_stage3_immutable_dispensation() from public,anon,authenticated,service_role;
revoke all on function public.pos_pharmacy_get_prescription_v1(text,text,text,text,text,text,date,text) from public,anon,authenticated,service_role;
grant execute on function public.pos_pharmacy_get_prescription_v1(text,text,text,text,text,text,date,text) to anon,authenticated;
