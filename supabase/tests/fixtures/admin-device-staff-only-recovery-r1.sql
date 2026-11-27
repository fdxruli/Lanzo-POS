-- Narrow extension of the existing Admin-support PostgreSQL fixture. The
-- functions themselves are loaded from the repository's latest canonical
-- migrations by the test runner; this file only supplies missing Staff fields.
alter table public.licenses add column if not exists license_type text;

create table public.license_staff_users (
  id uuid primary key default extensions.gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  username text not null,
  display_name text not null,
  password_hash text not null,
  role_name text not null default 'staff',
  permissions jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);
create unique index license_staff_users_recovery_fixture_username_uidx
  on public.license_staff_users (license_id, lower(username));
alter table public.license_staff_users enable row level security;
revoke all on table public.license_staff_users from public, anon, authenticated;

alter table public.license_staff_sessions
  add column license_id uuid references public.licenses(id) on delete cascade,
  add column staff_user_id uuid references public.license_staff_users(id) on delete cascade,
  add column session_token_hash text,
  add column created_at timestamptz not null default now(),
  add column expires_at timestamptz not null default (now() + interval '12 hours'),
  add column last_seen_at timestamptz not null default now();
alter table public.license_staff_sessions enable row level security;
revoke all on table public.license_staff_sessions from public, anon, authenticated;

create table public.license_usage_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  license_id uuid references public.licenses(id) on delete cascade,
  device_fingerprint text,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
