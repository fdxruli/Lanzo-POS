-- SOLO LECTURA. Funciona con v1 instalada. Escribir UNA búsqueda (mínimo 3 caracteres).
-- Licencia exacta, UUID interno, nombre parcial o correo completo. Máximo 50 filas.
with input as (select btrim('BUSQUEDA') as q)
select l.id as license_id,l.license_key,
  coalesce(b.business_name,l.organization_name,l.product_name) as business_name,
  l.status as license_status,l.expires_at,
  u.id as owner_id,u.username as owner_username,
  c.email as recovery_email,c.verified_at,
  l.owner_email as historical_email_unverified
from public.licenses l
left join public.business_profiles b on b.license_id=l.id
left join public.license_admin_users u on u.license_id=l.id and u.is_owner and u.is_active
left join private.admin_recovery_contacts c on c.license_id=l.id and c.admin_user_id=u.id
cross join input i
where char_length(i.q)>=3 and
 (l.id::text=i.q or u.id::text=i.q or lower(l.license_key)=lower(i.q)
  or position(lower(i.q) in lower(coalesce(b.business_name,l.organization_name,l.product_name,'')))>0
  or lower(c.email)=lower(i.q) or lower(l.owner_email)=lower(i.q)
  or exists(select 1 from public.subscriptions sub where sub.license_id=l.id and lower(sub.customer_email)=lower(i.q))
  or exists(select 1 from private.admin_recovery_challenges h where h.license_id=l.id and h.consumed_at is not null
    and h.purpose in ('contact','replacement_new','replacement_old') and lower(h.email)=lower(i.q)))
order by l.id limit 50;
