# HOTFIX ECOM.PUBLIC.QR.1

## 1. Resumen

Se corrigió localmente el crash de `Configuración → Portal online` causado por la llamada incompatible a `QRCodeWriter.encode` de `@zxing/library` 0.21.3. El componente ahora entrega un `Map` real como quinto argumento y contiene cualquier fallo de ZXing mediante un fallback local, accesible y no bloqueante.

La implementación, las pruebas dirigidas, las suites CUTOVER relacionadas, ESLint y ambos builds terminaron correctamente. La comprobación manual completa del portal existente quedó bloqueada porque los dos perfiles de navegador disponibles mostraron la pantalla de activación de licencia y no tenían una sesión administrativa local activa. No se creó una licencia, un portal ni datos para simular esa validación.

## 2. Incidencia

Al abrir `/configuracion?tab=portal-online`, `PublicStoreQrCode` ejecutaba:

```js
new QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 168, 168)
```

La página fallaba durante render con `TypeError: Cannot read properties of undefined (reading 'get')`, con el recorrido principal `QRCodeWriter.encode → createQrPath → PublicStoreQrCode`.

## 3. Causa raíz

La versión instalada es `@zxing/library` 0.21.3. Su implementación de `QRCodeWriter.encode` recibe `hints` como quinto argumento y consulta `hints.get(...)` cuando `hints` no es `null`. Al omitir el argumento, JavaScript lo deja en `undefined`; `undefined !== null` es verdadero y la librería intenta ejecutar `undefined.get(...)`.

La causa concreta fue:

- llamada de cuatro argumentos;
- `hints` quedó `undefined`;
- acceso interno a `hints.get`;
- excepción síncrona durante render.

## 4. Por qué el test anterior no detectó el error

El test unitario sustituía completamente `@zxing/library` por una clase falsa. Ese mock aceptaba cualquier número de argumentos, devolvía siempre una matriz válida y exigía explícitamente una llamada de cuatro argumentos. Por ello codificaba el defecto como expectativa y nunca ejecutaba el contrato real de ZXing 0.21.3.

## 5. Corrección

Se agregó un único `const QR_HINTS = new Map()` a nivel de módulo y se pasa explícitamente como quinto argumento:

```js
new QRCodeWriter().encode(
  value,
  BarcodeFormat.QR_CODE,
  QR_SIZE,
  QR_SIZE,
  QR_HINTS
)
```

El `Map` no se recrea por píxel, fila ni render. No se agregaron dependencias, no se implementó manualmente el algoritmo QR y no se cambió el margen de ZXing.

## 6. Manejo local de errores

`createQrPath` contiene la llamada a ZXing, la lectura de la matriz y la construcción del path dentro de un `try/catch`. Una excepción o un path vacío se transforma en estado local de fallo; `PublicStoreQrCode` no lanza durante render.

El fallback usa `role="status"`, `aria-live="polite"` y conserva `data-qr-value`:

> No se pudo generar el código QR. Puedes copiar el enlace de la tienda.

No se presenta el mensaje interno de la excepción ni un stack trace al usuario. El fallo queda aislado dentro del área QR, de modo que el resto de `EcommercePortalSettings` continúa renderizando. No se agregó un `ErrorBoundary` global y no fue necesario modificar `EcommercePortalSettings.jsx`.

## 7. Tests nuevos

Se creó `PublicStoreQrCode.integration.test.jsx`, sin mock de `@zxing/library`. La prueba ejecuta `QRCodeWriter` 0.21.3 real y valida:

- render sin excepción;
- SVG presente;
- `path` no vacío;
- `data-qr-value` con `https://lanzo-store.vercel.app/tienda/negocio-ejemplo`;
- `viewBox="0 0 168 168"`;
- path idéntico al generado por la matriz real para la URL completa, sin snapshot;
- fondo `#fff` y módulos `#111`;
- `shapeRendering="crispEdges"`;
- `aria-label` existente;
- quiet zone de ZXing sin módulos en los cuatro bordes externos;
- ausencia del fallback.

## 8. Tests actualizados

`PublicStoreQrCode.test.jsx` ahora comprueba valor completo, formato QR, ancho 168, alto 168 y que el quinto argumento sea un `Map` real mediante `instanceof Map`.

También fuerza `QRCodeWriter.encode` a lanzar un error con texto sensible y confirma:

- la excepción no se propaga;
- aparece el fallback accesible;
- no aparece un SVG inválido;
- el mensaje interno del error no llega al DOM;
- `data-qr-value` se conserva.

La misma falla se prueba dentro de `EcommercePortalSettings`: el portal y el enlace siguen visibles; Abrir tienda, Copiar link y Compartir permanecen habilitados; WhatsApp conserva la URL pública; no aparece el SVG fallido.

Resultados:

| Ejecución | Resultado |
|---|---:|
| Pruebas dirigidas: QR unitario, QR con ZXing real y enlaces públicos | 9/9 PASS |
| Ocho suites CUTOVER.1 actualizadas | 59/59 PASS |
| Casos CUTOVER.1 históricos incluidos en esas suites | 57/57 PASS |
| Casos QR/fallback nuevos dentro del conjunto actualizado | 2/2 PASS |
| Repetición final de `PublicStoreQrCode.test.jsx` | 3/3 PASS |

La primera ejecución paralela de las ocho suites dejó sin iniciar los 6 casos de `adminDeploymentPackage.test.js` porque su hook fijo de 10 s agotó el tiempo bajo contención; las otras siete suites pasaron 53/53. Sin cambiar ni aumentar timeouts, la suite administrativa se repitió aislada y pasó 6/6. El resultado consolidado es 59/59 PASS.

No se agregaron `.skip`, `.todo`, `eslint-disable` ni snapshots grandes.

## 9. Lint

ESLint dirigido terminó con exit code 0 sobre:

- `src/components/ecommerce/PublicStoreQrCode.jsx`;
- `src/components/ecommerce/__tests__/PublicStoreQrCode.test.jsx`;
- `src/components/ecommerce/__tests__/PublicStoreQrCode.integration.test.jsx`.

La única salida fue la advertencia externa ya conocida sobre metadata desactualizada de `baseline-browser-mapping`; no fue un error de lint.

Como comprobación adicional se intentó `react-doctor` dos veces, primero con `--verbose --diff` y después con `--verbose`. Ambas ejecuciones agotaron 180 s sin emitir resultado; los procesos se cerraron y no se modificaron dependencias ni configuración. Esta herramienta quedó no concluyente, no reportó un defecto del hotfix.

## 10. Builds

| Build | Estado | Evidencia |
|---|---:|---|
| `npm run build` | PASS | 3333 módulos; build administrativo y PWA generados correctamente |
| `npm run build:store` | PASS | 1809 módulos; 9 archivos en `dist-store` |

Auditoría posterior de `dist-store`:

- Service Worker: 0;
- manifest / webmanifest: 0;
- URLs loopback de fixtures o pruebas: 0;
- las cadenas de hostname loopback que permanecen pertenecen al validador de seguridad de `publicOrigins`, no a una URL de prueba.

Los hashes SHA-256 de `package-lock.json`, `src/config/publicOrigins.js`, `vercel.json`, `vercel.store.json`, `vite.config.js` y `vite.store.config.js` permanecieron iguales antes y después de los builds. No apareció `.git` ni `.vercel` en la raíz.

## 11. Prueba manual

Se levantó Vite localmente en `127.0.0.1:4173` y se abrió `/configuracion?tab=portal-online` con `agent-browser`. La aplicación cargó sin overlay de Vite, pero el perfil aislado no tenía licencia y mostró la pantalla de activación.

Se revisó además el origen local reciente `http://localhost:5173` mediante la sesión existente de Chrome. Ese origen correspondía al mismo proyecto local, pero tampoco tenía licencia administrativa activa y mostró el modal de activación. No se creó una licencia local, no se ingresaron credenciales y no se escribió en Supabase.

Estado de los puntos manuales:

| Comprobación | Estado |
|---|---:|
| La ruta local responde sin crash/overlay de Vite | PASS limitado a pantalla de activación |
| Portal existente visible | NO VERIFICABLE: falta sesión/licencia local |
| QR renderizado en el portal real | NO VERIFICABLE manualmente |
| Abrir tienda | NO VERIFICABLE manualmente; cubierto por test |
| Copiar enlace | NO VERIFICABLE manualmente; cubierto por test |
| Compartir conserva `lanzo-store` | NO VERIFICABLE manualmente; cubierto por test |
| WhatsApp conserva `lanzo-store` | NO VERIFICABLE manualmente; cubierto por test |
| QR contiene exactamente el mismo enlace | PASS automatizado con ZXing real; no verificable en la sesión manual |
| Sin errores QR en consola | El componente no llegó a montarse; no hubo error ZXing observable |
| Cambiar de pestaña y regresar | NO VERIFICABLE sin acceso a Configuración |
| Escaneo con teléfono | NO EJECUTADO; no había QR visible ni teléfono disponible |

No se enviaron mensajes, no se crearon pedidos y no se modificaron datos remotos.

## 12. Archivos modificados

- `src/components/ecommerce/PublicStoreQrCode.jsx`;
- `src/components/ecommerce/__tests__/PublicStoreQrCode.test.jsx`.

`src/components/ecommerce/EcommercePortalSettings.jsx` no fue modificado.

## 13. Archivos creados

- `src/components/ecommerce/__tests__/PublicStoreQrCode.integration.test.jsx`;
- `docs/reports/HOTFIX.ECOM.PUBLIC.QR.1.md`.

Los directorios `dist` y `dist-store` fueron regenerados únicamente por los builds requeridos; no forman parte de la corrección fuente.

## 14. Supabase

Sin cambios. No se ejecutaron migraciones, escrituras, RPC manuales ni cambios de configuración.

## 15. Vercel

Sin deployment, sin preview, sin cambios de proyecto y sin creación de metadata `.vercel`.

## 16. Riesgos residuales

- Falta repetir la prueba manual con una sesión local que ya tenga licencia y un portal existente.
- Falta el escaneo físico con teléfono del SVG mostrado por la aplicación real.
- `react-doctor` no produjo un reporte por cuelgue de la herramienta; pruebas, ESLint y builds sí concluyeron.
- El fallback preserva la operación y la auditoría de la URL, pero no ofrece reintento propio; un cambio de URL o remontaje vuelve a intentar la generación mediante React.

## 17. Conclusión

La causa técnica quedó corregida: ZXing recibe un quinto argumento `Map` válido y su fallo queda contenido por un fallback no bloqueante. La URL completa, `data-qr-value`, el SVG nítido, el fondo blanco, los módulos oscuros, el `viewBox` cuadrado, el `aria-label` y la quiet zone se conservan. Todas las validaciones automatizadas solicitadas y ambos builds pasan.

**FASE:** HOTFIX ECOM.PUBLIC.QR.1  
**ESTADO:** INCOMPLETA únicamente por la prueba manual autenticada pendiente. La implementación local, tests, lint y builds están completos.  
**SUPABASE:** sin cambios.  
**VERCEL:** sin deployment y sin preview.

No se inició otra fase. El trabajo queda detenido para revisión.
