-- Run only after installing the QA candidate + own fixtures. Always ROLLBACK.
begin;
set local statement_timeout='25s';
create temp table collection_checks(id text,ok boolean,detail jsonb);
insert into lanzo_ecom_bridge_qa.identities(id,license_id,device_id,actor_type,actor_id,actor_session_id,created_at,retired_at)
select ('ffffffff-ffff-4fff-8fff-'||lpad(to_hex(n),12,'0'))::uuid,
 i.license_id,i.device_id,'admin',i.actor_id,gen_random_uuid(),clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day'
from generate_series(1,1001) n cross join lateral
 (select * from lanzo_ecom_bridge_qa.identities where actor_type='admin' order by id limit 1) i;
do $$
declare rows jsonb; cursor_id uuid:='ffffffff-ffff-4fff-8fff-000000000000'; total integer:=0; batches integer:=0; r jsonb;
begin
 loop
  rows:=public.lanzo_ecom_bridge_qa_collect_batch(cursor_id,100); batches:=batches+1;
  for r in select value from jsonb_array_elements(rows) loop
   total:=total+1;cursor_id:=(r->>'id')::uuid;
   perform public.lanzo_ecom_bridge_qa_collect_ack(cursor_id,true);
  end loop;
  exit when jsonb_array_length(rows)<100;
  if batches>12 then raise exception 'PAGINATION_LOOP'; end if;
 end loop;
 insert into collection_checks values('KEYSET-1001',total=1001 and batches=11,jsonb_build_object('rows',total,'batches',batches));
 insert into collection_checks values('ACK-DURABLE',
  (select count(*)=1001 from lanzo_ecom_bridge_qa.identities where id>'ffffffff-ffff-4fff-8fff-000000000000' and cleanup_completed_at is not null),'{}');
 insert into collection_checks values('RETENTION-KEEPS-RECENT',public.lanzo_ecom_bridge_qa_retention(100)->>'identities'='0','{}');
 update lanzo_ecom_bridge_qa.identities set cleanup_completed_at=clock_timestamp()-interval '31 days' where id>'ffffffff-ffff-4fff-8fff-000000000000';
 insert into collection_checks values('RETENTION-BOUNDED',public.lanzo_ecom_bridge_qa_retention(100)->>'identities'='100','{}');
end $$;
select jsonb_agg(to_jsonb(c)) from collection_checks c;
rollback;
