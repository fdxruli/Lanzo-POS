-- LICENSE.FREE.1 — Renombrar plan FREE visible sin cambiar compatibilidad interna.
-- Alcance intencional:
-- - NO cambia plans.code.
-- - NO cambia features, precio, dispositivos ni vigencia técnica.
-- - Solo actualiza textos visibles del registro interno code = 'free_trial'.

UPDATE public.plans
SET
    name = 'Plan Free',
    description = 'Plan gratuito local para iniciar con Lanzo POS.'
WHERE code = 'free_trial';
