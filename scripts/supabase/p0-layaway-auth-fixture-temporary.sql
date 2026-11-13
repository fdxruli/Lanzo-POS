-- Temporary FIN-01/restaurant support objects for the disposable PG17 test DB.
-- Schemas and functions are from the repository's Production-derived snapshot;
-- no Production rows are copied or written.

-- Empty Ecommerce stock projection touched by layaway reservation release. The
-- PR338 financial fixture omits Ecommerce tables; this narrow table reproduces
-- the columns used by the real projection function without adding test rows.
CREATE TABLE public.ecommerce_published_product_variants (
  license_id uuid NOT NULL,
  source_product_id text,
  stock_snapshot numeric(12,3),
  source_available boolean NOT NULL DEFAULT true,
  deleted_at timestamptz
);

CREATE TABLE private.pos_fin01_qa_pilots_v2 (
  license_id uuid primary key references public.licenses(id) on delete cascade,
  creation_xid xid8 not null,
  protocol integer not null default 1 check (protocol in (1,2)),
  generation bigint not null default 1,
  approval_reference text,
  change_reference text,
  activated_at timestamptz,
  changed_at timestamptz not null default now()
);
CREATE TABLE private.pos_fin01_admissions_v2 (
  transaction_id xid8 not null,
  license_id uuid not null references public.licenses(id) on delete cascade,
  depth integer not null check (depth > 0),
  primary key(transaction_id,license_id)
);
ALTER TABLE private.pos_fin01_qa_pilots_v2 OWNER TO postgres;
ALTER TABLE private.pos_fin01_admissions_v2 OWNER TO postgres;
ALTER TABLE private.pos_fin01_qa_pilots_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.pos_fin01_admissions_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.pos_fin01_qa_pilots_v2, private.pos_fin01_admissions_v2 FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.pos_historical_credit_authorizations (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id),
  batch_id uuid not null,
  manifest jsonb not null,
  content_hash text not null,
  customer_count integer not null check (customer_count between 1 and 500),
  total_cents bigint not null check (total_cents > 0),
  owner_id uuid not null references public.license_admin_users(id),
  session_id uuid not null references public.license_admin_sessions(id),
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  state text not null default 'PENDING',
  results jsonb not null default '[]',
  approvals jsonb not null default '[]',
  unique (license_id, batch_id),
  unique (license_id, content_hash)
);
CREATE TABLE private.pos_historical_credit_receipts (
  license_id uuid not null references public.licenses(id),
  customer_id text not null,
  source_id uuid not null,
  source_customer_id text not null,
  amount_cents integer not null check (amount_cents > 0),
  authorization_id uuid not null references private.pos_historical_credit_authorizations(id),
  ledger_id text not null,
  imported_at timestamptz not null default now(),
  primary key (license_id, customer_id),
  unique (license_id, source_id, source_customer_id)
);
ALTER TABLE private.pos_historical_credit_authorizations OWNER TO postgres;
ALTER TABLE private.pos_historical_credit_receipts OWNER TO postgres;
ALTER TABLE private.pos_historical_credit_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.pos_historical_credit_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.pos_historical_credit_authorizations, private.pos_historical_credit_receipts FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.restaurant_cloud_contract_state (
  singleton boolean primary key default true check(singleton),
  contract_version integer not null default 1 check(contract_version in (1,2)),
  writes_paused boolean not null default false,
  generation bigint not null default 1 check(generation > 0)
);
INSERT INTO private.restaurant_cloud_contract_state(singleton) VALUES (true);
ALTER TABLE private.restaurant_cloud_contract_state OWNER TO postgres;
ALTER TABLE private.restaurant_cloud_contract_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.restaurant_cloud_contract_state FROM PUBLIC, anon, authenticated, service_role;
