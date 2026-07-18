# HOTFIX ECOM.CATALOG.IDEMPOTENCY.FINAL.PAYLOAD

Fecha: 2026-07-18  
Repositorio: `fdxruli/Lanzo-POS`  
Rama: `agent/ecom-catalog-idempotency-final-payload`

## Estado

Implementación preparada en rama separada. Sin merge automático.

## Incidente

La sincronización automática del catálogo devolvía:

```text
ECOMMERCE_IDEMPOTENCY_CONFLICT
count: 8
catalog revision: 60
```

Supabase respondía HTTP 200 y conservaba correctamente el catálogo remoto. El conflicto estaba dentro de la respuesta funcional de la RPC.

## Causa raíz

`ecommerceCatalogSyncServiceBase` construía la llave idempotente con las proyecciones base.

Después, `ecommerceCatalogSyncService` reemplazaba parte del lote antes del transporte:

- configuración normalizada de restaurante;
- reglas de selección múltiple de extras;
- configuración de variantes apparel;
- revisión pública de configuración;
- disponibilidad y stock agregados de variantes.

El payload enviado ya no era el mismo payload utilizado para construir la llave.

## Corrección

Se añadió una preparación final del request en `ecommerceCatalogSyncService`:

1. aplica todas las proyecciones de configuración pendientes;
2. extrae el portal de la llave generada por el servicio base;
3. recalcula la llave con `buildBatchIdempotencyKey`;
4. envía exactamente las mismas proyecciones que fueron firmadas.

No se cambia el algoritmo canónico del servicio base ni se debilita la validación de Supabase.

## Cobertura

Se añadieron pruebas para:

- restaurante: conversión de extras de selección única a selección múltiple;
- restaurante: cambio de opciones y precios;
- apparel: incorporación de variantes SKU;
- apparel: stock y disponibilidad agregados;
- reintento de payload final idéntico;
- callers aislados con llaves que no pertenecen al catálogo automático.

## Impacto esperado

- restaurante y apparel comparten la misma garantía idempotente;
- un cambio real de configuración genera una llave nueva;
- un reintento idéntico conserva la misma llave;
- desaparece el conflicto provocado por mutaciones posteriores a la firma;
- la revisión remota existente no necesita reinicio.

## Supabase

No se modificó Supabase.

- sin SQL;
- sin migraciones;
- sin eliminación de solicitudes idempotentes;
- sin reinicio de `catalog_revision`;
- sin modificación de hashes remotos.

## Validación realizada

- revisión focalizada del diff;
- sintaxis JavaScript de servicio y prueba con `node --check`;
- verificación de que el diff funcional sólo:
  - añade la preparación final;
  - vuelve asíncrono el wrapper de `syncBatch`;
  - exporta internals para prueba.

Pendiente en checkout completo:

```text
npm run test:ci -- ecommerceCatalogSyncFinalPayloadIdempotency
npm run lint
npm run build
```
