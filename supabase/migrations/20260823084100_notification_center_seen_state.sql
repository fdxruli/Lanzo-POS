-- POS Notification Center hotfix: actor-scoped seen state.
-- Opening the center records seen_at without changing read_at.

begin;

alter table public.pos_notification_reads
  add column if not exists seen_at timestamptz;

-- read/archive are stronger acknowledgements than seen. Preserve all existing
-- actor provenance while making those historical states internally coherent.
update public.pos_notification_reads
set seen_at = coalesce(read_at, archived_at),
    updated_at = now()
where seen_at is null
  and (read_at is not null or archived_at is not null);

create index if not exists idx_pos_notification_reads_license_seen_at
  on public.pos_notification_reads (license_id, seen_at)
  where seen_at is not null;

create or replace function private.enforce_pos_notification_seen_semantics()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.read_at is not null or new.archived_at is not null then
    new.seen_at := coalesce(new.seen_at, new.read_at, new.archived_at, now());
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_pos_notification_seen_semantics() from public, anon, authenticated;

drop trigger if exists trg_pos_notification_reads_seen_semantics on public.pos_notification_reads;
create trigger trg_pos_notification_reads_seen_semantics
before insert or update of seen_at, read_at, archived_at
on public.pos_notification_reads
for each row execute function private.enforce_pos_notification_seen_semantics();

commit;
