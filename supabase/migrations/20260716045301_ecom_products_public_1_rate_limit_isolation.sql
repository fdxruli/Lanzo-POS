create table if not exists private.ecommerce_public_rate_limit_secret(singleton boolean primary key default true check(singleton),secret bytea not null check(octet_length(secret)>=32),created_at timestamptz not null default now());
insert into private.ecommerce_public_rate_limit_secret(singleton,secret) values(true,extensions.gen_random_bytes(32)) on conflict(singleton) do nothing;
revoke all on table private.ecommerce_public_rate_limit_secret from public,anon,authenticated,service_role;
create or replace function private.ecommerce_public_configuration_client_fingerprint(p_portal_id uuid,p_product_id uuid)
returns text language plpgsql stable security definer set search_path=''
as $f$
declare v_headers jsonb:='{}'::jsonb;v_headers_raw text;v_candidate text;v_normalized_ip text;v_secret bytea;v_identity_material text;
begin
if p_portal_id is null or p_product_id is null then raise exception 'ECOMMERCE_RATE_LIMIT_CONTEXT_REQUIRED';end if;
begin v_headers_raw:=nullif(current_setting('request.headers',true),'');if v_headers_raw is not null then v_headers:=v_headers_raw::jsonb;end if;exception when others then v_headers:='{}'::jsonb;end;
foreach v_candidate in array array[nullif(btrim(coalesce(v_headers->>'cf-connecting-ip','')),''),nullif(btrim(coalesce(v_headers->>'x-real-ip','')),''),nullif(btrim(split_part(coalesce(v_headers->>'x-forwarded-for',''),',',1)),'')] loop
 if v_candidate is null then continue;end if;begin v_normalized_ip:=host(v_candidate::inet);exit when v_normalized_ip is not null;exception when invalid_text_representation then v_normalized_ip:=null;when others then v_normalized_ip:=null;end;end loop;
select secret into v_secret from private.ecommerce_public_rate_limit_secret where singleton is true;if v_secret is null then raise exception 'ECOMMERCE_RATE_LIMIT_SECRET_MISSING';end if;
v_identity_material:=coalesce(v_normalized_ip,'anonymous')||':'||p_portal_id::text||':'||p_product_id::text;
return 'public-store-client:'||encode(extensions.hmac(convert_to(v_identity_material,'UTF8'),v_secret,'sha256'),'hex');end;$f$;
create or replace function private.ecommerce_enforce_product_configuration_rate_limit(p_portal_id uuid,p_license_id uuid,p_product_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $f$
declare v_client_fingerprint text;v_client_result jsonb;v_global_result jsonb;
begin
if p_portal_id is null or p_license_id is null or p_product_id is null then raise exception 'ECOMMERCE_RATE_LIMIT_CONTEXT_REQUIRED';end if;
v_client_fingerprint:=private.ecommerce_public_configuration_client_fingerprint(p_portal_id,p_product_id);
v_client_result:=public.enforce_pos_rpc_rate_limit_v2('ecommerce-license:'||p_license_id::text,v_client_fingerprint,null,'ecommerce_get_product_configuration','ECOMMERCE_PRODUCT_CONFIGURATION_CLIENT',60,600,900,'ECOMMERCE_RATE_LIMITED',jsonb_build_object('source','ecommerce_public_store','tier','client','phase','ECOM.PRODUCTS.PUBLIC.1.1'));
if coalesce((v_client_result->>'allowed')::boolean,true)is not true then return jsonb_build_object('allowed',false,'code','ECOMMERCE_RATE_LIMITED');end if;
v_global_result:=public.enforce_pos_rpc_rate_limit_v2('ecommerce-license:'||p_license_id::text,'public-store-global:'||p_portal_id::text||':'||p_product_id::text,null,'ecommerce_get_product_configuration','ECOMMERCE_PRODUCT_CONFIGURATION_GLOBAL',1200,600,900,'ECOMMERCE_RATE_LIMITED',jsonb_build_object('source','ecommerce_public_store','tier','global','phase','ECOM.PRODUCTS.PUBLIC.1.1'));
if coalesce((v_global_result->>'allowed')::boolean,true)is not true then return jsonb_build_object('allowed',false,'code','ECOMMERCE_RATE_LIMITED');end if;return jsonb_build_object('allowed',true);end;$f$;
alter table private.ecommerce_public_rate_limit_secret owner to postgres;
alter function private.ecommerce_public_configuration_client_fingerprint(uuid,uuid) owner to postgres;
alter function private.ecommerce_enforce_product_configuration_rate_limit(uuid,uuid,uuid) owner to postgres;
revoke all on function private.ecommerce_public_configuration_client_fingerprint(uuid,uuid) from public,anon,authenticated;
grant execute on function private.ecommerce_public_configuration_client_fingerprint(uuid,uuid) to service_role;
revoke all on function private.ecommerce_enforce_product_configuration_rate_limit(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.ecommerce_enforce_product_configuration_rate_limit(uuid,uuid,uuid) to service_role;
comment on table private.ecommerce_public_rate_limit_secret is 'Private generated pepper for public request identities. Never exposed to browser roles.';
comment on function private.ecommerce_public_configuration_client_fingerprint(uuid,uuid) is 'Returns an HMAC client bucket from trusted proxy request headers without persisting or returning the IP address.';
comment on function private.ecommerce_enforce_product_configuration_rate_limit(uuid,uuid,uuid) is 'Two-tier PUBLIC.1.1 limit: 60 requests/client/product/10m and 1200 requests/portal/product/10m.';;
