create table if not exists public.ai_agent_usage (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  device_id uuid references public.license_devices(id) on delete set null,
  staff_user_id uuid references public.license_staff_users(id) on delete set null,
  agent_type text not null,
  status text not null default 'reserved' check (status in ('reserved', 'completed', 'failed')),
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_ai_agent_usage_license_status
  on public.ai_agent_usage (license_id, status, created_at desc);

alter table public.ai_agent_usage enable row level security;

drop policy if exists "ai_agent_usage_no_client_select" on public.ai_agent_usage;
create policy "ai_agent_usage_no_client_select"
  on public.ai_agent_usage
  for select
  using (false);

drop policy if exists "ai_agent_usage_no_client_insert" on public.ai_agent_usage;
create policy "ai_agent_usage_no_client_insert"
  on public.ai_agent_usage
  for insert
  with check (false);

drop policy if exists "ai_agent_usage_no_client_update" on public.ai_agent_usage;
create policy "ai_agent_usage_no_client_update"
  on public.ai_agent_usage
  for update
  using (false)
  with check (false);;
