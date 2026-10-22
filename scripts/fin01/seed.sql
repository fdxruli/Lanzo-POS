-- Synthetic fixtures only. No production rows or credentials.
begin;
insert into public.licenses(id,license_key,license_type,features) values
 ('10000000-0000-0000-0000-000000000001','fixture-a','pro','{"cloud_pos_sync":true,"cloud_cash_sync":true,"cloud_customer_credit_sync":true,"cloud_sales_credit":true,"cloud_sales_cashier":true,"cloud_sales_sync_base":true,"cloud_products_sync":true,"cloud_sales_inventory":false}'),
 ('10000000-0000-0000-0000-000000000002','fixture-b','pro','{"cloud_pos_sync":true,"cloud_cash_sync":true,"cloud_customer_credit_sync":true,"cloud_sales_credit":true,"cloud_sales_cashier":true,"cloud_sales_sync_base":true}');
insert into public.license_devices(id,license_id,device_fingerprint,security_token,device_mode,device_role,is_active) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','device-a','synthetic-device','shared','admin',true),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','device-b','synthetic-device','shared','admin',true),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','device-c','synthetic-device','admin_only','admin',true);
insert into public.license_admin_users(id,license_id,username,display_name,password_hash,is_owner) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','owner-a','Synthetic Owner',extensions.crypt('synthetic',extensions.gen_salt('bf',4)),true),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','admin-a','Synthetic Admin',extensions.crypt('synthetic',extensions.gen_salt('bf',4)),false),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','owner-b','Synthetic Owner B',extensions.crypt('synthetic',extensions.gen_salt('bf',4)),true);
insert into public.license_admin_sessions(id,license_id,admin_user_id,device_id,session_token_hash) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',extensions.crypt('owner-session-a',extensions.gen_salt('bf',4))),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',extensions.crypt('owner-session-b',extensions.gen_salt('bf',4))),
 ('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',extensions.crypt('admin-session',extensions.gen_salt('bf',4))),
 ('40000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003',extensions.crypt('other-owner',extensions.gen_salt('bf',4)));
insert into public.license_staff_users(id,license_id,username,display_name,password_hash,permissions) values
 ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','staff-a','Synthetic Staff',extensions.crypt('synthetic',extensions.gen_salt('bf',4)),'{"customers":true,"pos":true,"cash":true}');
insert into public.license_staff_sessions(license_id,staff_user_id,device_id,session_token_hash) values
 ('10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',extensions.crypt('staff-session',extensions.gen_salt('bf',4)));
select private.resolve_cash_station_for_device('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',true);
select private.resolve_cash_station_for_device('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',true);
insert into public.pos_cash_sessions(id,license_id,device_id,actor_key,responsible_name,cash_station_id) values
 ('cash-a','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','admin:30000000-0000-0000-0000-000000000001','Synthetic','cash_station_device_20000000-0000-0000-0000-000000000001'),
 ('cash-b','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','admin:30000000-0000-0000-0000-000000000001','Synthetic','cash_station_device_20000000-0000-0000-0000-000000000002');
insert into public.pos_products(id,license_id,name,name_key,price,cost,stock) values
 ('product','10000000-0000-0000-0000-000000000001','Synthetic Product','synthetic',150,20,1000);
commit;
