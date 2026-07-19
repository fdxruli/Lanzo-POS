-- Regression: one invalid configuration must not roll back a valid sibling.
-- Runs entirely inside a rollback transaction.
begin;

do $test$
declare
  v_license uuid := '25100000-0000-4000-8000-000000000001';
  v_device uuid := '25100000-0000-4000-8000-000000000002';
  v_portal uuid := '25100000-0000-4000-8000-000000000003';
  v_valid uuid := '25100000-0000-4000-8000-000000000004';
  v_invalid uuid := '25100000-0000-4000-8000-000000000005';
  v_result jsonb;
  v_revision bigint;
  v_simple jsonb := '{"type":"simple","version":1,"hasRecipe":false,"variants":[],"optionGroups":[],"availabilitySource":"direct","availabilityReasonCode":null,"limitingSource":{"productId":null,"name":null}}'::jsonb;
  v_invalid_config jsonb := '{"type":"variant_parent","version":1,"hasRecipe":false,"variants":[{"sourceVariantRef":"missing","sourceProductId":"missing-source","localProductRef":"missing-source","sku":"MISSING","publicName":"Missing","optionValues":{"size":"M"},"priceMode":"base","priceValue":0,"imageUrl":null,"imageRef":null,"trackStock":true,"stockMode":"exact","stockSnapshot":1,"sourceAvailable":true,"manualAvailable":true,"displayOrder":0,"sourceRevision":"version:2","metadata":{}}],"optionGroups":[],"availabilitySource":"variant_aggregate","availabilityReasonCode":null,"limitingSource":{"productId":null,"name":null}}'::jsonb;
begin
  insert into public.licenses(id,license_key,license_type,status,expires_at,features)
  values(v_license,'ECOM-ISOLATION-ROLLBACK','pro','active',now()+interval '1 hour','{"ecommerce_portal_enabled":true,"ecommerce_cloud_catalog_source":true}'::jsonb);
  insert into public.license_devices(id,license_id,device_fingerprint,security_token,is_active,device_role)
  values(v_device,v_license,'ecom-isolation-device','ecom-isolation-token',true,'admin');
  insert into public.ecommerce_portals(id,license_id,slug,status,name)
  values(v_portal,v_license,'ecom-isolation-rollback','published','Isolation');
  insert into public.pos_products(id,license_id,name,name_key,price,stock,committed_stock,track_stock,is_active,product_type,sale_type,batch_management,expiration_mode,server_version)
  values
    ('isolation-valid',v_license,'Valid','isolation-valid',10,5,0,true,true,'sellable','unit','{"enabled":false}','NONE',2),
    ('isolation-invalid',v_license,'Invalid','isolation-invalid',20,3,0,true,true,'sellable','unit','{"enabled":false}','NONE',2);
  insert into public.ecommerce_published_products(id,portal_id,license_id,local_product_ref,public_name,price,is_published,manual_available,source_available,is_available,source_state)
  values
    (v_valid,v_portal,v_license,'isolation-valid','Valid',10,true,true,true,true,'in_stock'),
    (v_invalid,v_portal,v_license,'isolation-invalid','Invalid',20,true,true,true,true,'in_stock');
  select catalog_revision into v_revision from public.ecommerce_portals where id=v_portal;
  v_result := public.ecommerce_admin_sync_published_catalog_v2(
    'ECOM-ISOLATION-ROLLBACK','ecom-isolation-device','ecom-isolation-token',null,
    jsonb_build_array(
      jsonb_build_object('publishedProductId',v_valid::text,'localProductRef','isolation-valid','sourceRevision','version:2','sourceState','in_stock','sourceAvailable',true,'stockSnapshot',5,'fields',jsonb_build_object('name','Valid synced','description',null,'category',null,'price',10,'image',null),'configuration',v_simple,'configurationSourceRevision','version:2'),
      jsonb_build_object('publishedProductId',v_invalid::text,'localProductRef','isolation-invalid','sourceRevision','version:2','sourceState','in_stock','sourceAvailable',true,'stockSnapshot',3,'fields',jsonb_build_object('name','Invalid synced','description',null,'category',null,'price',20,'image',null),'configuration',v_invalid_config,'configurationSourceRevision','version:2')
    ),'ecom-isolation-batch',v_revision);
  if coalesce((v_result->>'success')::boolean,false) is not true
     or coalesce((v_result->>'updatedCount')::integer,0) <> 1
     or coalesce((v_result->>'reviewCount')::integer,0) <> 1
     or not exists (select 1 from jsonb_array_elements(v_result->'results') r where r->>'publishedProductId'=v_invalid::text and r->>'status'='invalid' and r->>'code'='ECOMMERCE_VARIANT_SOURCE_NOT_FOUND')
     or (select public_name from public.ecommerce_published_products where id=v_valid) <> 'Valid synced'
     or (select sync_status from public.ecommerce_published_products where id=v_invalid) <> 'review' then
    raise exception 'ECOM_CATALOG_CONFIGURATION_ISOLATION_FAILED: %',v_result;
  end if;
end;
$test$;

rollback;
