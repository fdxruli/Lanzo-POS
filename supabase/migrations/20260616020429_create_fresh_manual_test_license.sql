insert into public.licenses (
  license_key,
  plan_id,
  license_type,
  max_devices,
  duration_months,
  status,
  expires_at,
  product_name,
  features
) values (
  'LANZO-TEST-20260616-001',
  '80e977a7-894e-4b61-ae72-b0fc2639295c'::uuid,
  'trial',
  1,
  3,
  'active',
  now() + interval '3 months',
  'Lanzo POS Test Nueva',
  '{"full_access": true, "max_rubros": 1, "allowed_rubros": ["*"]}'::jsonb
)
on conflict (license_key) do nothing;

insert into public.license_events (license_key, event_type, metadata)
values (
  'LANZO-TEST-20260616-001',
  'LICENSE_CREATED_TEST',
  jsonb_build_object('purpose', 'fresh_manual_test', 'created_at', now())
)
on conflict do nothing;;
