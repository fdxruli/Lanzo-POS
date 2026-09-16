# LICENSE.LIFECYCLE.3 — operación

El job `license-expiry-materialization-v1` corre una vez por hora en UTC con un
lote máximo de 25. La demora de hasta una hora no concede acceso Pro: la
autoridad de entitlement sigue siendo `private.license_entitlement_state_v1`.

## Estado del scheduler

```sql
select jobid, jobname, schedule, command, database, username, active
from cron.job
where jobname = 'license-expiry-materialization-v1';

select status, start_time, end_time, return_message
from cron.job_run_details
where jobid = (
  select jobid from cron.job where jobname = 'license-expiry-materialization-v1'
)
order by start_time desc
limit 24;
```

## Resultado de negocio y fallos

```sql
select run_id, started_at, finished_at, status, batch_limit,
       candidates_seen, downgraded_count, noop_count, failed_count,
       error_summary
from private.license_lifecycle_scheduler_runs
order by started_at desc
limit 48;

select run_id, license_id, result_code, occurred_at, error_code, error_message
from private.license_lifecycle_scheduler_run_items
where result_code = 'FAILED'
order by occurred_at desc
limit 100;
```

Las tablas son privadas, no contienen PII y se purgan después de 90 días. Los
fallos de licencia se reintentan tras seis horas; ese enfriamiento permite que
el backlog posterior siga avanzando.

## Backlog canónico

```sql
with backlog as (
  select l.id as license_id, e.grace_period_ends
  from public.licenses l
  join public.plans p on p.id = l.plan_id
  cross join lateral private.license_entitlement_state_v1(l.id) e
  where lower(coalesce(l.status::text, '')) = 'active'
    and coalesce(l.is_lifetime, false) is false
    and l.expires_at is not null
    and p.code <> 'free_trial'
    and coalesce(p.price, 0) > 0
    and e.lifecycle_state = 'expired'
    and e.is_entitled is false
), recent_failures as (
  select count(distinct i.license_id) as licenses_failed_recently
  from private.license_lifecycle_scheduler_run_items i
  where i.result_code = 'FAILED'
    and i.occurred_at > now() - interval '24 hours'
)
select count(*) as total_backlog,
       min(grace_period_ends) as oldest_grace_ended,
       (select licenses_failed_recently from recent_failures) as licenses_failed_recently
from backlog;
```

Señales operacionales:

- scheduler fallando: último `cron.job_run_details.status` distinto de `succeeded`;
- downgrade fallando: runs `completed_with_errors` o `failed_count > 0`;
- backlog creciendo: `total_backlog` aumenta durante varias horas o la fecha
  `oldest_grace_ended` envejece.

Los triggers legacy `ecommerce_order_items_phase4_tenant_scope_guard` y
`ecommerce_reservations_phase4_tenant_scope_guard` siguen fuera de alcance. La
matriz de esta fase no crea pedidos ni reservas y no los activa artificialmente.
