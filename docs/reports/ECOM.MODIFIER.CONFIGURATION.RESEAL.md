# HOTFIX ECOM.MODIFIER.CONFIGURATION.RESEAL

Fecha: 2026-07-16 (America/Mexico_City)  
Repositorio: `fdxruli/Lanzo-POS`  
Proyecto Supabase: `odlrhijtfyavryeqivaa`  
Rama: `agent/ecom-modifier-configuration-reseal`  
Estado: **MIGRACIÓN APLICADA Y VERIFICADA — PR PENDIENTE DE MERGE**

## 1. Resumen ejecutivo

Se corrigió el bloqueo:

```text
ECOMMERCE_CATALOG_SOURCE_CONFLICT
```

que aparecía al sincronizar un lote de ocho productos en la revisión de catálogo `58` del portal de desarrollo `farmaciagary`.

El valor `count: 8` correspondía al tamaño del lote. La causa real estaba limitada a cuatro productos configurables con modificadores de restaurante.

No se modificaron:

- inventario;
- lotes;
- recetas;
- productos fuente;
- variantes u opciones normalizadas;
- pedidos;
- ventas;
- caja;
- revisión pública del portal;
- funciones o políticas RLS.

## 2. Causa raíz

La normalización reciente de modificadores de restaurante comenzó a emitir el contrato canónico completo, incluyendo:

- `selectionType`;
- `multiple`;
- `minSelect`;
- `maxSelect`;
- campos de consumo de inventario.

Los productos ya tenían guardada una huella de configuración creada por el serializador anterior. El `server_version` del producto seguía siendo el mismo, pero el JSON canónico cambió.

La protección de revisiones interpretó correctamente:

```text
misma source revision + payload hash diferente = conflict
```

La rehidratación de IndexedDB no podía resolver el caso porque el nuevo payload era determinista y continuaba usando la misma revisión del producto.

## 3. Preauditoría

El predicado compensatorio encontró exactamente cuatro filas:

| Producto | Referencia local | Revisión |
|---|---|---:|
| Hamburguesa de pollo | `prod_rest_hamburguesa_pollo` | `version:1` |
| Papas a la francesa | `prod_rest_papas_francesa` | `version:1` |
| Quesadilla de queso | `prod_rest_quesadilla_queso` | `version:1` |
| Taco al pastor | `prod_rest_taco_pastor` | `version:2` |

Condiciones requeridas:

- portal activo con slug `farmaciagary`;
- producto publicado activo;
- `configuration_type = 'configurable'`;
- `has_option_groups = true`;
- producto fuente activo con arreglo `modifiers` no vacío;
- huella privada de configuración existente;
- revisión privada igual a `version:<server_version>`.

No se utilizaron UUID generados ni una lista de IDs publicados dentro de la migración.

## 4. Migración

Archivo local:

```text
supabase/migrations/20260717055543_ecom_modifier_configuration_reseal.sql
```

Historial remoto:

```text
20260717055736 — ecom_modifier_configuration_reseal
```

La migración elimina únicamente estas claves privadas de las filas que cumplen el predicado:

```text
ecommerce_configuration_payload_hash
ecommerce_configuration_source_revision
ecommerce_configuration_rejected_revision
ecommerce_configuration_canonical_revision
```

Además registra:

```text
ecommerce_configuration_reseal_reason
ecommerce_configuration_reseal_requested_at
```

El próximo ciclo autenticado de sincronización vuelve a sellar la configuración mediante la RPC productiva y el serializador canónico actual.

## 5. Validación posterior

La migración fue aplicada correctamente en Supabase.

Resultado para las cuatro filas:

```text
configuration_source_revision = null
configuration_payload_hash = null
sync_status = synced
sync_error_code = null
reseal_reason = modifier_normalizer_contract_20260716
```

El historial remoto confirmó la migración `20260717055736`.

## 6. Validación funcional pendiente del cliente

La base quedó preparada para la reconciliación. En una sesión actualizada de Lanzo POS se debe:

1. recargar la aplicación administrativa;
2. permitir que finalice la hidratación cloud;
3. confirmar que desaparezca `ECOMMERCE_CATALOG_SOURCE_CONFLICT`;
4. confirmar un log `Sync completed` para el lote;
5. verificar que los cuatro productos vuelvan a tener `ecommerce_configuration_source_revision` y `ecommerce_configuration_payload_hash`;
6. comprobar en la tienda pública que los grupos opcionales permiten seleccionar varias opciones hasta `maxSelect`.

## 7. Riesgo residual

La reparación resuelve la huella heredada existente. Para impedir que una evolución futura del serializador vuelva a producir el mismo patrón, la revisión de configuración debería incorporar una versión explícita del contrato de proyección, independiente del `server_version` funcional del producto.
