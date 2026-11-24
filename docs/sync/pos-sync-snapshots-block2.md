# LANZO POS: contrato SQL de snapshots, Bloque 2

## Alcance

Esta nota documenta los RPC aditivos de snapshots y la evidencia SQL del Bloque 2. La migración de la frontera del Bloque 1 permanece intacta. No se cambió el cliente ni se instaló SQL en Production.

## Migración candidata

- Archivo: `supabase/migrations/20261124220046_pos_consistent_snapshots_v1.sql`.
- SHA-256: `859e6cccfd8957771f38cc45d11204ccd5568dddfe089a7c2f2e49b2c3a94fe8`.
- Requiere `20261124183143_pos_sync_transactional_frontier_v1.sql` y sus tablas/proyecciones actuales.
- Añade cinco RPC públicos y cinco helpers privados. No cambia tablas, RLS, índices ni RPC legacy.
- RPC públicos: concedidos a `anon`, `authenticated` y `service_role`, que siguen sujetos a validación de licencia, dispositivo, actor y permisos dentro de cada llamada.
- Helpers privados: `EXECUTE` revocado a esos roles; la lectura directa de `pos_sync_events` sigue denegada por ACL/RLS.

## RPC y recorrido

Los parámetros comunes son licencia, huella de dispositivo, token, token de sesión, tamaño de página, frontera de referencia y cursor opaco. El límite máximo por llamada es 500.

| RPC | Firma resumida | Alcance de una pasada |
|---|---|---|
| `pos_pull_product_catalog_snapshot_v2` | `(text,text,text,text,integer,bigint,jsonb)` | Una sola secuencia keyset de categorías, productos y lotes. Usa la misma referencia para las tres entidades. |
| `pos_pull_customers_snapshot_v3` | `(text,text,text,text,integer,bigint,jsonb,jsonb)` | Clientes visibles; conserva el envelope V2. |
| `pos_pull_customer_credit_snapshot_v3` | `(text,text,text,text,integer,bigint,jsonb,text,jsonb)` | Movimientos de crédito, con filtro opcional por cliente y proyección de sus clientes relacionados; conserva el envelope V2. |
| `pos_pull_sales_snapshot_v2` | `(text,text,text,text,integer,bigint,jsonb,timestamptz,timestamptz)` | Ventas autorizadas, artículos y pagos de cada venta entregada. Fechas opcionales delimitan explícitamente el alcance. |
| `pos_pull_cash_snapshot_v2` | `(text,text,text,text,text,integer,bigint,jsonb)` | Sesiones y movimientos en un orden keyset combinado. El alcance admin puede ser `mine`, `open`, `staff` o `all`; Staff queda limitado a `mine`. |

### Protocolo para el consumidor del Bloque 3

1. En la primera llamada del recorrido, enviar referencia y cursor nulos.
2. Guardar `snapshot_reference_change_seq` y reenviarlo sin cambios en todas las páginas de ese recorrido. El catálogo es una pasada única para categorías, productos y lotes.
3. Reenviar `next_page_cursor` exactamente como se recibió. Es opaco y queda ligado a licencia, dispositivo, actor, sesión, permisos, frontera y filtros. No autoriza acceso y no se puede compartir entre negocios o contextos.
4. Continuar mientras `has_more=true`. Una pasada termina únicamente con `has_more=false` y `snapshot_complete=true`. Un error o respuesta limitada por rate limit no es finalización.
5. En clientes y crédito, leer estos campos dentro de `payload` del envelope V2. Los demás RPC devuelven el objeto de snapshot directamente.
6. `safe_change_seq` describe la frontera segura observada en esa llamada; puede cambiar entre páginas. No es cursor aplicado. El snapshot no devuelve `latest_change_seq` como evidencia de aplicación.
7. Después de completar las páginas, iniciar el delta desde la referencia capturada. Si `sync_deferred=true`, el recorrido puede continuar con esa referencia inferior; el cliente debe usar la recuperación aplazada ya disponible en #592 para drenar el delta.

El snapshot es estado de servidor y no acredita que Dexie haya aplicado las filas. El Bloque 3 debe conservar Outbox y demás datos locales protegidos, comparar `server_version` antes de reemplazar información más reciente y aplicar tombstones. Debe confirmar localmente la carga y el cursor solo después de terminar todos los efectos de las páginas y del delta, sin usar el máximo de referencias recibidas.

Los cursores de ventas con fechas cubren solamente ese intervalo. `snapshot_complete=true` no significa que se descargó un histórico más amplio que el filtro solicitado. Las eliminaciones blandas se proyectan con su estado eliminado; eliminaciones y cambios posteriores a la referencia deben llegar por el delta.

Si cambian permisos, sesión, dispositivo o filtros, un cursor anterior se rechaza. Se debe abortar ese recorrido y comenzar otro con el contexto actualmente autorizado.

## Estrategia de consistencia

Cada primera página obtiene `snapshot_reference_change_seq` de `private.pos_sync_safe_frontier_v1`. Las páginas posteriores validan y conservan esa referencia. Las consultas usan keyset por IDs inmutables y orden nativo determinista de sus columnas, no `OFFSET` ni `updated_at`.

Las filas con cambios solo posteriores a la referencia quedan para el delta. Las filas con una versión previa a la referencia siguen siendo miembros del snapshot aunque cambie su proyección durante el recorrido; las versiones de servidor y tombstones permiten que el cliente converja al combinar snapshot y delta. Las altas, bajas o actualizaciones de después de la frontera no se convierten en evidencia de que páginas anteriores fueron aplicadas.

No se mantiene una transacción o conexión entre llamadas ni una tabla de sesiones de snapshot. Cada página revalida permisos y filtra por la licencia autorizada. Los IDs usan la colación determinista declarada por la base; mantenerla igual durante un recorrido evita cambios de orden. La colación `C` explícita se retiró después de `EXPLAIN`: no coincidía con el índice B-tree nativo de `id` y forzaba ordenamiento; el comparador nativo permite al planificador usar ese índice cuando el tamaño lo justifica.

## QA SQL en laboratorio

Laboratorio aislado PostgreSQL 17.6 en Docker; almacenamiento disponible comprobado antes de las pruebas. La migración final se aplicó en `pr338_frontier_candidate`, `pr338_block2_lab` y `pr338_block2_3738`. Todos los fixtures fueron sintéticos.

| Caso | Resultado sobre el candidato final |
|---|---|
| Cursor 37/38 | En la corrida concurrente inicial, A recibió el valor anterior con referencia 37; B confirmó la actualización 38 antes de terminar A. El recorrido keyset conservó su referencia y el delta desde 37 devolvió la versión nueva. |
| Desplazamiento A/B/C/D | El caso legacy por `updated_at, id` devolvió A/B en la primera página; al mover A, OFFSET devolvió D/A y omitió C. El recorrido keyset previo descargó A/B/C/D sin omisiones. La revisión final solo cambió la colación de comparación. |
| Altas y eliminaciones | En el recorrido con referencia 37, `0-new` y el tombstone de D quedaron fuera del baseline y el delta los entregó junto con la actualización de A. La unión coincidió con los productos activos del servidor. |
| Frontera transaccional pendiente, commit | Con dos conexiones: evento 45 quedó abierto, evento 46 confirmó primero. Snapshot reportó referencia 44 y `sync_deferred=true`. Después del commit de 45, el delta desde 44 entregó ambos eventos y las proyecciones A/B. |
| Frontera transaccional pendiente, rollback | Evento 47 quedó abierto y evento 48 confirmó. Snapshot reportó referencia 46 y `sync_deferred=true`; al revertir 47, la frontera avanzó a 48 y el delta entregó solo el evento confirmado, sin hueco bloqueante. |
| Paginación extensa, límite 500 | Catálogo: 1,506 filas en 4 páginas. Clientes: 501 en 2. Crédito: 501 en 2. Ventas: 501 en 2, con 501 artículos y 501 pagos. Caja: 1,002 filas combinadas en 3. Sin duplicados; frontera estable dentro de cada recorrido y última página completa. |
| Permisos y aislamiento | Admin y Staff con `pos`, `inventory` o `products` leyeron catálogo; Staff sin permiso fue rechazado. Clientes requirió `customers`; ventas respetó `reports`; caja limitó Staff a `mine` y rechazó POS-only. Token inválido y dispositivo de otro negocio fueron rechazados. |
| ACL/RLS | RPC público con permiso `EXECUTE`; helpers privados sin permiso para los tres roles; lectura directa de eventos denegada y RLS habilitado. |
| Parámetros/contexto | Se rechazaron límites y referencias fuera de rango, cursor malformado, cursor de otra licencia/contexto y alcance de caja inválido. |

La intercalación concurrente y el recorrido completo se ejecutaron mediante conexiones PostgreSQL independientes; no se sustituyeron por mocks. La matriz financiera del Bloque 1 no se repitió: este bloque no modifica ventas, inventario, pagos, caja ni su atomicidad.

### Medición focal

Diez llamadas de primera página por RPC, `limit=100`, sobre el fixture de 501–1,506 filas, ya calentado, en el laboratorio local. Milisegundos dentro del servidor; p95 es una muestra pequeña, no una estimación de Production.

| RPC | Operaciones | p50 | p95 |
|---|---:|---:|---:|
| Catálogo | 10 | 60.88 ms | 84.81 ms |
| Clientes | 10 | 26.18 ms | 49.02 ms |
| Crédito | 10 | 33.84 ms | 43.69 ms |
| Ventas | 10 | 18.56 ms | 50.81 ms |
| Caja | 10 | 44.11 ms | 61.84 ms |

En el fixture de ventas de 501 filas, el plan nativo medido para una página ejecutó en 10.15 ms y leyó 1,188 buffers compartidos; por el tamaño pequeño, el planificador eligió secuencial. Con secuencial deshabilitado para inspeccionar elegibilidad, el orden nativo produjo un rango `Index Scan` en la PK de `id`; `COLLATE "C"` no lo hacía. No se agregaron índices. Estas mediciones no sustituyen el benchmark conjunto del Bloque 4.

## Compatibilidad y dependencias pendientes

- Production (`odlrhijtfyavryeqivaa`) fue consultado solo en lectura: sigue en PostgreSQL 17.6, las funciones snapshot actuales conservan sus firmas legacy con OFFSET y ninguno de los cinco RPC nuevos está instalado.
- Los endpoints nuevos son aditivos. Los clientes existentes siguen usando sus RPC y contratos actuales; la negociación/activación se resuelve en 4F.
- Precondición de convergencia: toda mutación alcanzable debe registrar su evento en la transacción y el log debe conservar los eventos desde la referencia hasta el delta. La migración depende del recorder/frontera del Bloque 1.
- El Bloque 3 debe conectar estos contratos con los servicios de catálogo, clientes/crédito, ventas y caja; integrar el envelope V2; hacer la aplicación local reentrante y protegida por versión; y coordinar el marcador durable de snapshot/delta. Ninguno de esos cambios cliente forma parte de esta entrega.
- `cursor_ahead_of_safe_frontier` no detecta todas las omisiones históricas. Este contrato previene omisiones futuras pero no repara cursores que ya pudieron avanzar inseguramente.
- La instalación requiere primero resolver en 4F la pausa/drenado de transacciones y las condiciones de transición; no instalar esta migración aislada en Production.

## Estado de validación

- Código preparado: sí; migration candidata aditiva y nota de contrato.
- QA SQL real: completado para paginación, convergencia y frontera pendiente descritas arriba.
- QA automatizado del cliente / QA integrado con Dexie: no realizado; corresponde al Bloque 3.
- QA manual con dispositivos físicos: reservado para el cierre del roadmap.
- Production: solo inspección de lectura; sin escrituras ni instalación.
- Dictamen: base apta para comenzar el Bloque 3, no apta para merge o instalación y no representa el cierre de 4D/4E.
