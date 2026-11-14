-- Isolated fixture ONLY. Exact canonical table definitions for live guards.
create table private.restaurant_cloud_contract_state (
  singleton boolean primary key default true check(singleton),
  contract_version integer not null default 1 check(contract_version in (1,2)),
  writes_paused boolean not null default false,
  generation bigint not null default 1 check(generation > 0)
);
insert into private.restaurant_cloud_contract_state(singleton) values(true);
alter table private.restaurant_cloud_contract_state enable row level security;
revoke all on private.restaurant_cloud_contract_state from public,anon,authenticated;
create table private.pos_fin01_qa_pilots_v2 (
  license_id uuid primary key references public.licenses(id) on delete cascade,
  creation_xid xid8 not null,
  protocol integer not null default 1 check (protocol in (1,2)),
  generation bigint not null default 1,
  approval_reference text,
  change_reference text,
  activated_at timestamptz,
  changed_at timestamptz not null default now()
);
create table private.pos_fin01_admissions_v2 (
  transaction_id xid8 not null,
  license_id uuid not null references public.licenses(id) on delete cascade,
  depth integer not null check (depth > 0),
  primary key(transaction_id,license_id)
);
alter table private.pos_fin01_qa_pilots_v2 owner to postgres;
alter table private.pos_fin01_admissions_v2 owner to postgres;
alter table private.pos_fin01_qa_pilots_v2 enable row level security;
alter table private.pos_fin01_admissions_v2 enable row level security;
revoke all on private.pos_fin01_qa_pilots_v2,private.pos_fin01_admissions_v2 from public,anon,authenticated,service_role;
