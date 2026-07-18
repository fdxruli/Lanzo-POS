# HOTFIX ECOM.CONFIGURATION.CONTENT.REVISION.COORDINATION

Fecha: 2026-07-18  
Proyecto Supabase: `odlrhijtfyavryeqivaa`  
Rama: `agent/ecom-configuration-revision-coordination`

## Estado

**IMPLEMENTACIÓN COMPLETA — PR PENDIENTE DE REVISIÓN.**

## Incidente

Después de corregir la firma idempotente del payload final, la reconciliación del catálogo devolvía:

```text
ECOMMERCE_CATALOG_SOURCE_STALE
count: 8
catalog revision: 60
```

La última sincronización remota exitosa continuaba intacta. No se creó una solicitud nueva porque el error ocurría dentro de la aplicación transaccional de la configuración y revertía el lote completo.

## Causa raíz

La proyección final de restaurante y apparel utiliza una revisión direccionada por contenido:

```text
configuration:<hash>
```

`private.ecommerce_parse_source_revision` la normaliza como una revisión opaca:

```text
opaque:configuration:<hash>
```

La protección de configuración comparaba esa revisión con la revisión canónica del producto POS:

```text
version:<server_version>
```

Cuando el catálogo base devolvía `idempotent`, `p_revision_already_applied` era falso y la diferencia se clasificaba como `ECOMMERCE_CATALOG_SOURCE_STALE`, aunque el hash del payload fuera exactamente el ya guardado.

El síntoma apareció después de apparel porque sus variantes, stock agregado y disponibilidad forman parte de la configuración pública final y necesitan una huella de contenido independiente de la versión del producto padre.

## Corrección

La función `private.ecommerce_apply_product_configuration_checked` ahora reconoce exclusivamente revisiones opacas con el prefijo canónico:

```text
opaque:configuration:
```

Estas revisiones se aceptan únicamente cuando se cumple una de las siguientes condiciones:

1. el catálogo base ya aceptó una revisión nueva en la misma transacción (`p_revision_already_applied = true`);
2. el hash del payload es exactamente igual al hash de configuración ya almacenado.

Se mantiene bloqueante:

```text
base idempotente + payload de configuración diferente
→ ECOMMERCE_CATALOG_SOURCE_CONFLICT
```

Por tanto, la corrección no permite cambios ocultos ni elimina la protección contra dispositivos atrasados.

## Restaurante

La regla permite que una revisión aceptada del catálogo actualice de forma coordinada:

- selección única o múltiple;
- mínimos y máximos;
- opciones y precios;
- ingredientes y cantidades;
- disponibilidad derivada de inventario.

Un reintento idéntico no genera conflicto aunque utilice una nueva etiqueta `configuration:<hash>` equivalente al mismo payload.

## Apparel

La regla permite que una revisión aceptada del catálogo actualice:

- variantes por SKU;
- talla, color y atributos;
- stock por variante;
- disponibilidad agregada;
- estado `variant_parent`.

Una configuración apparel diferente sin una revisión base aceptada continúa bloqueada.

## Aislamiento de revisiones

La huella de contenido nunca reemplaza:

- `source_revision`;
- `source_revision_kind`;
- `source_revision_order`;
- `source_payload_hash`;
- la revisión canónica guardada en `ecommerce_configuration_source_revision`.

La revisión canónica del producto continúa siendo `version:<server_version>` o su timestamp autoritativo.

## Supabase

Migración aplicada:

```text
ecom_configuration_content_revision_coordination
```

Archivo:

```text
supabase/migrations/20260718163000_ecom_configuration_content_revision_coordination.sql
```

No se eliminaron solicitudes idempotentes, no se reinició `catalog_revision` y no se modificaron productos reales.

## Validación

### PASS — validación focalizada sobre datos reales con rollback

- retry de contenido idéntico aceptado;
- cambio oculto con base idempotente rechazado como `ECOMMERCE_CATALOG_SOURCE_CONFLICT`;
- cambio después de avance base aceptado;
- rollback confirmado: hash, motivo de disponibilidad y timestamps originales intactos.

### PASS — prueba SQL sintética

Archivo:

```text
supabase/tests/ecom_configuration_content_revision_coordination.sql
```

Cobertura:

- configuración restaurante inicial;
- retry restaurante idéntico;
- cambio restaurante oculto bloqueado;
- cambio restaurante coordinado aceptado;
- grupo múltiple persistido;
- retry restaurante final;
- cambio apparel oculto bloqueado;
- variante apparel coordinada aceptada;
- retry apparel final;
- aislamiento de la revisión canónica.

Resultado final después del rollback:

```text
synthetic_licenses: 0
synthetic_portals: 0
synthetic_products: 0
synthetic_published_products: 0
```

## Archivos del hotfix

```text
supabase/migrations/20260718163000_ecom_configuration_content_revision_coordination.sql
supabase/tests/ecom_configuration_content_revision_coordination.sql
docs/reports/HOTFIX.ECOM.CONFIGURATION.CONTENT.REVISION.COORDINATION.md
```

No mergear automáticamente. Probar una reconciliación real de los ocho productos y confirmar `Sync completed` antes del merge.
