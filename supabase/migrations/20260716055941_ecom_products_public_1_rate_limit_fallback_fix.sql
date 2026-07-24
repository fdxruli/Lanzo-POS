-- ECOM.PRODUCTS.PUBLIC.1.2 safe rate-limit fallback
create or replace function private.ecommerce_public_configuration_client_fingerprint(p_portal_id uuid,p_product_id uuid)
returns text language plpgsql stable security definer set search_path='' as $function$
declare v_headers jsonb:='{}'::jsonb;v_headers_raw text;v_trusted_header text;v_candidate text;v_normalized_ip text;v_secret bytea;v_identity_material text;
begin
 if p_portal_id is null or p_product_id is null then raise exception 'ECOMMERCE_RATE_LIMIT_CONTEXT_REQUIRED';end if;
 v_trusted_header:=lower(btrim(coalesce(current_setting('app.settings.ecommerce_public_trusted_ip_header',true),'')));
 if v_trusted_header not in('cf-connecting-ip','x-real-ip','x-forwarded-for')then return null;end if;
 begin v_headers_raw:=nullif(current_setting('request.headers',true),'');if v_headers_raw is not null then v_headers:=v_headers_raw::jsonb;end if;exception when others then return null;end;
 v_candidate:=nullif(btrim(coalesce(v_headers->>v_trusted_header,'')),'');if v_trusted_header='x-forwarded-for' then v_candidate:=nullif(btrim(split_part(coalesce(v_candidate,''),',',1)),'');end if;if v_candidate is null then return null;end if;
 begin v_normalized_ip:=host(v_candidate::inet);exception when others then return null;end;if v_normalized_ip is null then return null;end if;
 select secret into v_secret from private.ecommerce_public_rate_limit_secret where singleton is true;if v_secret is null then raise exception 'ECOMMERCE_RATE_LIMIT_SECRET_MISSING';end if;
 v_identity_material:=v_normalized_ip||':'||p_portal_id::text||':'||p_product_id::text;
 return 'public-store-client:'||encode(extensions.hmac(convert_to(v_identity_material,'UTF8'),v_secret,'sha256'),'hex');
end;$function$;

create or replace function private.ecommerce_enforce_product_configuration_rate_limit(p_portal_id uuid,p_license_id uuid,p_product_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_client_fingerprint text;v_client_result jsonb;v_global_result jsonb;
begin
 if p_portal_id is null or p_license_id is null or p_product_id is null then raise exception 'ECOMMERCE_RATE_LIMIT_CONTEXT_REQUIRED';end if;
 v_client_fingerprint:=private.ecommerce_public_configuration_client_fingerprint(p_portal_id,p_product_id);
 if v_client_fingerprint is not null then
  v_client_result:=public.enforce_pos_rpc_rate_limit_v2('ecommerce-license:'||p_license_id::text,v_client_fingerprint,null,'ecommerce_get_product_configuration','ECOMMERCE_PRODUCT_CONFIGURATION_CLIENT',60,600,900,'ECOMMERCE_RATE_LIMITED',jsonb_build_object('source','ecommerce_public_store','tier','client','phase','ECOM.PRODUCTS.PUBLIC.1.2'));
  if coalesce((v_client_result->>'allowed')::boolean,true)is not true then return jsonb_build_object('allowed',false,'code','ECOMMERCE_RATE_LIMITED');end if;
 end if;
 v_global_result:=public.enforce_pos_rpc_rate_limit_v2('ecommerce-license:'||p_license_id::text,'public-store-global:'||p_portal_id::text||':'||p_product_id::text,null,'ecommerce_get_product_configuration','ECOMMERCE_PRODUCT_CONFIGURATION_GLOBAL',1200,600,900,'ECOMMERCE_RATE_LIMITED',jsonb_build_object('source','ecommerce_public_store','tier','global','phase','ECOM.PRODUCTS.PUBLIC.1.2'));
 if coalesce((v_global_result->>'allowed')::boolean,true)is not true then return jsonb_build_object('allowed',false,'code','ECOMMERCE_RATE_LIMITED');end if;
 return jsonb_build_object('allowed',true);
end;$function$;

alter function private.ecommerce_public_configuration_client_fingerprint(uuid,uuid)owner to postgres;alter function private.ecommerce_enforce_product_configuration_rate_limit(uuid,uuid,uuid)owner to postgres;
revoke all on function private.ecommerce_public_configuration_client_fingerprint(uuid,uuid)from public,anon,authenticated;grant execute on function private.ecommerce_public_configuration_client_fingerprint(uuid,uuid)to service_role;
revoke all on function private.ecommerce_enforce_product_configuration_rate_limit(uuid,uuid,uuid)from public,anon,authenticated;grant execute on function private.ecommerce_enforce_product_configuration_rate_limit(uuid,uuid,uuid)to service_role;
revoke all on table private.ecommerce_public_rate_limit_secret from public,anon,authenticated,service_role;
comment on function private.ecommerce_public_configuration_client_fingerprint(uuid,uuid)is 'ECOM.PRODUCTS.PUBLIC.1.2 HMAC only for an explicitly verified infrastructure header; NULL when identity is absent or untrusted.';
comment on function private.ecommerce_enforce_product_configuration_rate_limit(uuid,uuid,uuid)is 'ECOM.PRODUCTS.PUBLIC.1.2 optional 60/client/product/10m plus mandatory 1200/portal/product/10m; no shared anonymous client bucket.';;
