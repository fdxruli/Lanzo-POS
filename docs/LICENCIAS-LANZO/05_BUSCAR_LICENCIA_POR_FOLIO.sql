-- SOLO LECTURA: buscar una emisión previa ANTES de reintentar script 01.
SELECT lp.metadata->>'manual_issue_ref' AS folio,
       l.license_key,
       l.status,
       bp.business_name,
       p.code AS plan_interno,
       lp.created_at AS fecha_registro
FROM public.license_periods lp
JOIN public.licenses l ON l.id=lp.license_id
JOIN public.plans p ON p.id=l.plan_id
LEFT JOIN public.business_profiles bp ON bp.license_id=l.id
WHERE lp.metadata->>'manual_issue_ref' = 'MANUAL-2026-0001' -- CAMBIAR
  AND lp.metadata->>'source' = 'manual_admin_sql_provisioning_v1';
-- 1 fila = ya existe; NO ejecutar de nuevo 01. 0 filas = investigar errores
-- antes de volver a intentar; evitar duplicar encargos con distinto folio.
