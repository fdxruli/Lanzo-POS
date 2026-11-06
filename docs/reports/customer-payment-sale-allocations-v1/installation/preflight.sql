-- READ ONLY. Expected original functions and version absent.
with expected(signature,sha256,owner_name,definer,config,anon_exec,authenticated_exec,service_exec) as (values
('private.pos_sale_to_jsonb(pos_sales)','6395afe3312283501b60a4cebb2d7f2425951843dc89b7007503259e133c2ce9','postgres',false,'["search_path=\"\""]'::jsonb,false,false,false),
('public.pos_record_customer_payment_unlimited(text,text,text,text,text,numeric,text,text,text,jsonb,text)','73ce2f73f985eada337800b1ed18b9242c1f57948a23c48a57542f522ead8bf4','postgres',true,'["search_path=\"\""]'::jsonb,false,false,true),
('public.pos_cancel_cloud_sale_unlimited(text,text,text,text,text,text,text)','988743703fbf74423dc308871667582f3f4517f3e0ea2da9ca0099012da90320','postgres',true,'["search_path=\"\""]'::jsonb,false,false,true),
('public.pos_get_customer_credit_summary_unlimited(text,text,text,text,text)','fd1278d820f6a0ea481534b2ffd7a411a94c54edcac4b46ce166eeb309c19745','postgres',true,'["search_path=\"\""]'::jsonb,false,false,true)
), checks as (
 select e.signature,p.oid is not null as present,
   encode(extensions.digest(convert_to(replace(pg_get_functiondef(p.oid),E'\r',''),'UTF8'),'sha256'),'hex')=e.sha256 as body_matches,
   pg_get_userbyid(p.proowner)=e.owner_name and p.prosecdef=e.definer and to_jsonb(p.proconfig)=e.config as attributes_match,
   has_function_privilege('anon',p.oid,'EXECUTE')=e.anon_exec
     and has_function_privilege('authenticated',p.oid,'EXECUTE')=e.authenticated_exec
     and has_function_privilege('service_role',p.oid,'EXECUTE')=e.service_exec as permissions_match
 from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)
), ledger as (select count(*)=0 as matches
 from supabase_migrations.schema_migrations where version='20261106025114')
select jsonb_build_object('all_ok',coalesce(bool_and(present and body_matches and attributes_match and permissions_match),false) and (select matches from ledger),
 'functions',jsonb_agg(to_jsonb(checks) order by signature),'ledger_matches',(select matches from ledger)) from checks;
