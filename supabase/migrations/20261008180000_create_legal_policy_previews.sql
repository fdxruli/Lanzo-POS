-- Tabla separada para mostrar borradores legales solo en despliegues de revisión aislados.
-- Esta migración crea la estructura vacía; no modifica legal_terms ni activa documentos en producción.
create table public.legal_policy_previews (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (document_type in (
    'terms_of_use', 'privacy_policy', 'ai_policy',
    'payment_policy', 'refund_policy', 'legal_notice'
  )),
  version text not null,
  content_html text not null,
  is_active boolean not null default false,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint legal_policy_previews_document_type_version_key unique (document_type, version)
);

create unique index legal_policy_previews_one_active_per_type
  on public.legal_policy_previews (document_type)
  where is_active;

alter table public.legal_policy_previews enable row level security;
revoke all privileges on table public.legal_policy_previews from public, anon, authenticated;
grant select on table public.legal_policy_previews to anon, authenticated;

create policy "read active legal policy previews"
  on public.legal_policy_previews
  for select
  to anon, authenticated
  using (is_active);
