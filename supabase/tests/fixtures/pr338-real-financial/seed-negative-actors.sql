\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.license_devices (id,license_id,device_fingerprint,security_token,is_active,device_mode,device_role) VALUES ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-000000000002','lab-device-c','lab-device-token-c',true,'staff_only','staff');
INSERT INTO public.license_staff_users (id,license_id,username,display_name,password_hash,role_name,permissions,is_active) VALUES
('00000000-0000-0000-0000-0000000000ad','00000000-0000-0000-0000-000000000001','lab-no-pos','Lab no POS',extensions.crypt('lab-only',extensions.gen_salt('bf')),'staff','{"pos":false}',true),
('00000000-0000-0000-0000-0000000000ae','00000000-0000-0000-0000-000000000001','lab-expired','Lab expired',extensions.crypt('lab-only',extensions.gen_salt('bf')),'staff','{"pos":true}',true),
('00000000-0000-0000-0000-0000000000af','00000000-0000-0000-0000-000000000002','lab-tenant-b','Lab tenant B',extensions.crypt('lab-only',extensions.gen_salt('bf')),'staff','{"pos":true}',true);
INSERT INTO public.license_staff_sessions (id,license_id,staff_user_id,device_id,session_token_hash,expires_at,last_seen_at) VALUES
('00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000ad','00000000-0000-0000-0000-00000000000b',extensions.crypt('lab-no-pos-session',extensions.gen_salt('bf')),now()+interval '1 day',now()),
('00000000-0000-0000-0000-0000000000d4','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000ae','00000000-0000-0000-0000-00000000000b',extensions.crypt('lab-expired-session',extensions.gen_salt('bf')),now()-interval '1 second',now()),
('00000000-0000-0000-0000-0000000000d5','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000af','00000000-0000-0000-0000-00000000000c',extensions.crypt('lab-tenant-b-session',extensions.gen_salt('bf')),now()+interval '1 day',now());
INSERT INTO public.pos_restaurant_orders (id,license_id,local_order_id,table_label,subtotal,total,updated_at) VALUES ('lab-denial-row','00000000-0000-0000-0000-000000000001','lab-denial','Lab denial',20,20,'2026-10-01T00:00:00Z');
COMMIT;