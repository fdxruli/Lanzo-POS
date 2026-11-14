# F-03: procedencia de conteos de categorías

Base verificada: `main` / `7fc5fe7b07ca9b559a8d47f5971ecb3ebf13b0bd`.
Rama: `fix/categories-pro-count-provenance`.

## Causa y reproducción

El marcador histórico `products_last_snapshot_at` habilitaba `complete: true` para
cifras IndexedDB en PRO. No demuestra que hayan llegado asociaciones de otros dispositivos.
Antes del cambio se ejecutó la prueba `does not infer Cloud zero from a historical
PRO snapshot and local zero` en ProductsPage.categorySave: falló porque la confirmación
recibió «No hay productos asociados. Los productos no se eliminarán.» en vez de la
advertencia genérica. La prueba usa el resultado del contrato anterior, cero local y
licencia PRO; no simula un servidor ni afirma que se haya probado sincronización física.

## Contrato final

`getCategoryProductCounts(ids)` devuelve `{ source: 'local', complete, counts }`.
Free: `complete: true`; IndexedDB es la autoridad local del catálogo.
PRO: `complete: false`; las cifras son locales y no acreditan el total Cloud.
La existencia, edad o ausencia del snapshot no afecta el resultado. No se consulta
el marcador, no se agrega tráfico Cloud y los errores de lectura se propagan; la lista
oculta cifras al fallar, sin fabricar ceros. Se mantienen las reglas locales existentes:
incluyen inactivos e ingredientes, excluyen eliminados.

Free conserva «Sin productos», «1 producto» y «N productos».
PRO muestra «Sin productos registrados aquí», «1 producto en este dispositivo» o
«N productos en este dispositivo», tanto en página como en modal.
La lista no transmite cifras PRO como confiables al borrado. La página también verifica
el modo actual antes de usar una advertencia numérica. Respuestas tardías se descartan;
los resultados se vinculan a la lista y licencia que originaron la consulta para ocultarlos
en el primer render de otro contexto.

Confirmación PRO y conteo desconocido:
«Los productos asociados quedarán sin categoría. Los productos no se eliminarán.»

Confirmaciones Free con conteo conocido:
- Cero: «No hay productos asociados. Los productos no se eliminarán.»
- Uno: «El producto asociado quedará sin categoría. El producto no se eliminará.»
- Varios: «Los N productos asociados quedarán sin categoría. Los productos no se eliminarán.»

El conteo no autoriza ni bloquea el borrado. La operación y la RPC existentes no se modifican.

## Archivos

- src/services/products/productRepository.js
- src/components/products/CategoryList.jsx
- src/pages/ProductsPage.jsx
- src/services/products/__tests__/productRepository.freeLocalAuthority.test.js
- src/components/products/__tests__/CategoryManagers.reliability.test.jsx
- src/pages/__tests__/ProductsPage.categorySave.test.jsx
- Este informe.

## Verificación

Reproducción previa: fallo esperado y mensaje incorrecto confirmado.
Suite focalizada: productRepository.freeLocalAuthority, CategoryManagers.reliability,
ProductsPage.categorySave y productLocalRepository.cutover. Cubre cero/uno/varios,
procedencia PRO con/sin snapshot y online/offline, rechazo Dexie, cambio de licencia,
respuesta tardía, eliminación y consumidores compartidos.
ESLint de los seis archivos JS/JSX modificados: sin errores.
`npm run build`: aprobado, incluidos ambos audits postbuild de precaché.
`git diff --check`: sin errores.
Una exploración adicional de integración que importaba infraestructura completa se
canceló durante la carga; no se cuenta como prueba aprobada. La prueba principal de UI
simula el contrato del repositorio, y la suite del repositorio verifica ese contrato aparte.
CI GitHub/Vercel y HEAD final se registran en el PR y en la entrega.

## Riesgos y QA pendiente

El conteo PRO puede seguir desactualizado: se comunica su procedencia, no se garantiza
consistencia multidispositivo. No se agrega refresco automático. La protección depende
de los cambios de licencia/lista publicados por los stores existentes.
QA física pendiente: dos dispositivos PRO, modo avión, cambio real de negocio/licencia
y legibilidad en pantalla móvil estrecha. No se ejecutó borrado contra Production.
Siguiente acción: revisar el Draft y realizar esa QA antes de considerar su aprobación.
No hubo SQL, migraciones, cambios de RLS, RPC, sync, Production ni corrección F-05.
