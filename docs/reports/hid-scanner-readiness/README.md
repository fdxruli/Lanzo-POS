# Preparación funcional HID — 2026-11-06

## Base y alcance

- Referencias actualizadas con `git fetch origin --prune` antes de modificar. HEAD remoto de `main`: `f554b3f2e844784f93cc58d64393560ac81afd71` (PR #392).
- PR [#252](https://github.com/fdxruli/Lanzo-POS/pull/252) revisado: fusionado en `3348fad8d9349af8a0c79e0a5414272bb8346327`, antecesor de la base.
- Única rama local: `fix/hid-scanner-functional-readiness`. Un candidato para revisión; sin PR, push, merge ni despliegues.

## Código preparado

Se conserva `usePhysicalBarcodeScanner` → `keyboardWedgeClassifier` → `barcodeScanEvent` → `resolveWithCache` / `barcodeResolver` → `addMultipleScannedProducts` / `useActiveOrders`.

Problemas confirmados por reproducción focalizada y corregidos:

- El buscador del POS excluía los escaneos al tener foco. Ahora es un punto explícito de captura; conserva la entrada manual y limpia la búsqueda al reconocer una lectura completa.
- La deduplicación descartaba una segunda lectura completa del mismo código dentro de 125 ms. Ahora se suprime únicamente el terminador repetido sin nuevos caracteres; dos ráfagas completas producen dos unidades. Se conserva la utilidad compartida de eventos y la ventana de 125 ms.
- El buffer sobrevivía a cambios de foco y orden. Se reinicia con foco, pérdida de foco y cambio de orden; se conserva la limpieza al desactivar o desmontar.
- Una resolución pendiente podía incorporar un producto tras desmontar el POS o después de cambiar de orden/pago y volver al estado inicial. Se invalida el contexto anterior, se consulta el estado vivo de la orden y se entrega su ID explícito a la mutación existente.
- Los diálogos internos del catálogo podían dejar pasar eventos dirigidos fuera del diálogo. El POS comprueba las capas modales montadas antes de capturar y después de resolver.
- El SKU directo de un lote y las referencias cacheadas de variantes no comprobaban si el lote seguía vendible. Se reutilizan los guardas comerciales de actividad/caducidad y stock disponible. FIFO excluye esos lotes y no cae al stock agregado del padre cuando no hay lote elegible.

Ya resuelto en la base y conservado: Enter/NumpadEnter, límites multifactor de tiempo/longitud, caracteres como cadenas, protección de campos normales/paste/IME/modificadores, bloqueo de pago/modal/cámara, captura exclusiva del campo de ProductFormV2, resolver y caché locales, y mutación comercial existente. Los umbrales del classifier, la normalización, índices, esquema y persistencia permanecen intactos.

Archivos adicionales imprescindibles: `ProductMenu.jsx` identifica únicamente el buscador como punto de captura; los tests existentes ajustan el contrato para el ID de orden explícito. No se cambian `orderActions`, ProductFormV2, cámaras, finanzas, sincronización ni Supabase.

## QA automatizado

La suite nueva `PosPageContent.hidLocal.integration.test.jsx` usa eventos de teclado, ProductMenu, resolver/caché, el esquema Dexie con IndexedDB de prueba y el store real de órdenes. Solo reemplaza presentación ajena al recorrido y audio. No simula el producto resuelto ni el resultado de la mutación. Para las carreras, una barrera retrasa el resolver y luego ejecuta su implementación real.

| Recorrido | Evidencia focalizada |
| --- | --- |
| Código válido → producto → una unidad | Barcode con ceros iniciales; SKU de producto; SKU exacto de variante con precio y lote correctos |
| Dos lecturas legítimas → dos unidades | Dos ráfagas iguales dentro de 125 ms y otra diferente; Enter/NumpadEnter; terminador duplicado |
| Desconocido → cero incorporaciones | Orden real vacía y aviso de no encontrado |
| Lote inactivo/no vendible | Lookup frío, caché revalidada, FIFO y ausencia de fallback al padre; inactivo, archivado, reservado y vencido STRICT |
| Orden/pago/bloqueo durante lookup | Cambio de orden, ida y vuelta, apertura/cierre de pago, bloqueo y desmontaje; buffer parcial entre órdenes |
| ProductForm → captura sin venta | Campo real, ninguna resolución, mutación ni guardado por Enter duplicado |
| Modal/pago abierto | Pago, cámara, carrito y diálogo interno con foco fuera |
| Sin conexión | `navigator.onLine=false`, `fetch` prohibido y catálogo local real |
| Escritura normal | Buscador con escritura lenta y Enter; inputs/textarea/select/contenteditable protegidos por el hook |

Gate final: **232/232 pruebas en 22 suites**, incluidas **23 integraciones locales**. Ver resultados y comandos en `automated.log`. ESLint se ejecuta sobre los ocho archivos JS/JSX modificados; `git diff --check` también forma parte del gate.

`npm run build` administrativo y su `postbuild` pasan. Workbox emite avisos de patrones glob sin archivos coincidentes; la auditoría verifica 25 assets de arranque y 0 assets de rutas Local separados. No se ejecuta la suite completa ni el build de la tienda: los cambios pertenecen al POS administrativo.

## QA de navegador realmente ejecutado

Chromium `154.0.8037.57`, sin hardware, con Playwright y teclado del navegador. Montaje temporal de PosPageContent, ProductMenu, OrderSummary, ProductFormV2, catálogo IndexedDB y store reales, dentro de MemoryRouter y un perfil nuevo. Sin credenciales ni peticiones externas. Los archivos temporales se retiraron; no se incorpora simulador permanente.

Pasaron: buscador con foco y ceros iniciales, Enter duplicado, lecturas iguales/diferentes, escritura manual, diálogo con foco fuera, código desconocido sin incorporación, SKU local en modo offline y ProductForm sin venta ni guardado. Evidencia: `browser.log`.

Límite observado: el primer montaje carecía del Router y se corrigió solo en el fixture temporal. El recorrido posterior pasó, pero los componentes auxiliares emitieron tres errores `ACTOR_CONTEXT_LOCKED` al faltar una sesión autenticada en ese montaje aislado. No se modificó autenticación ni se certifica el flujo completo de una sesión real, cobro o reservas financieras con esta prueba. Las carreras de orden/pago se verificaron en la integración automatizada, no en navegador.

## Pendientes y estado operativo

- QA con hardware físico: **pendiente**. Windows + USB HID y Android + Bluetooth HID dependen de que SO/navegador emitan KeyboardEvent; no se ejecutaron en esos dispositivos.
- Compatibilidad USB/Bluetooth real: **todavía no certificada**. Las heurísticas conservan sus límites; escritura humana que imite exactamente una ráfaga rápida puede ser indistinguible de un lector.
- Production: **sin cambios**. Sin datos productivos, SQL/RPC, WebUSB/WebHID/Web Bluetooth, QR, SDKs ni servicios nuevos.
- Antes de afirmar soporte real: probar lectores concretos, distribución de teclado, prefijos/sufijos, Enter/NumpadEnter, foco, repetición, desconexión y Android/navegador objetivo. El catálogo local debe estar disponible previamente.
