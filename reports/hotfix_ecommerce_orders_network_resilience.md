# Hotfix: resiliencia de red de la bandeja ecommerce

## Alcance

Este hotfix se limita a la lectura administrativa de pedidos ecommerce en el cliente. No cambia Supabase, SQL, migraciones, contratos públicos de RPC, apartados, Caja, inventario, checkout público, realtime, fulfillment ni conversión POS.

## Causa técnica

Una interrupción transitoria del transporte del navegador (por ejemplo `Failed to fetch` o `ERR_CONNECTION_CLOSED`) llegaba desde `supabase-js` sin código PostgREST. El cliente la normalizaba como un error genérico y una actualización en segundo plano podía anunciar un fallo aunque la bandeja ya tuviera datos válidos.

Además, la carga de lista y la del resumen podían iniciar RPC separadas a `ecommerce_admin_list_orders` para el mismo contexto.

## Comportamiento aplicado

- Se clasifica conservadoramente como conectividad temporal un error sin código funcional que señale `Failed to fetch`, `NetworkError`, `Network request failed`, `ERR_CONNECTION_CLOSED`, `ERR_NETWORK_CHANGED`, `ERR_INTERNET_DISCONNECTED` o `Load failed`.
- El resultado seguro usa `ECOMMERCE_ORDERS_NETWORK_UNAVAILABLE` y no expone detalles de transporte, argumentos de RPC, tokens, licencia, huella de dispositivo ni datos del cliente.
- Solo se reintenta una vez, con una espera breve y acotada, para `ecommerce_admin_list_orders` y `ecommerce_admin_get_order`.
- No hay reintentos automáticos para `ecommerce_admin_mark_order_seen`, `ecommerce_admin_accept_order`, `ecommerce_admin_reject_order`, RPC de borradores/conversión POS ni ninguna mutación.
- Los errores con código funcional, incluidos `42501`, permisos, sesión, validación, negocio y rate limit, conservan su flujo anterior y no se reclasifican como red.
- El primer fallo temporal de lectura se registra como `Logger.warn` con nombre de RPC, código seguro e intento `1`. Si el segundo intento falla, se registra una sola vez como `Logger.error` con el código seguro.
- Un refresco de lista fallido con caché conserva pedidos, conteos y fecha de última carga; termina los indicadores y deja la lista marcada como stale. El resultado incluye `preservedCache: true`.
- El resumen reutiliza una carga completa compatible (`all`, límite 50, offset 0) que ya esté en curso para la misma licencia y actor. No comparte promesas entre actores distintos.

## Protección contra carreras

La escritura en store continúa pasando por `requestEpoch`, `listIntentEpoch`, `detailIntentEpoch`, `ecommerceOrdersActiveRequestKey`, `isRequestContextCurrent`, `isListIntentCurrent` e `isDetailIntentCurrent`. Una respuesta recuperada se descarta si cambia licencia, actor, intención, filtro, página o sesión.

## Validación

- Servicio y store focalizados: 40 pruebas aprobadas.
- Rutas/runtime/página de la bandeja: aprobadas en ejecuciones individuales (10, 7 y 14 pruebas respectivamente).
- Servicios relacionados: permisos, tracking, fulfillment y conversión POS: 57 pruebas aprobadas en seis archivos.
- `ecommercePublicTrackingContract.test.js`: una prueba preexistente no relacionada falló porque espera `trackingVersion: 1` y la respuesta actual no lo incluye. El archivo no fue modificado por este hotfix.
- El panel de fulfillment y varios lotes grandes de UI excedieron el límite de ejecución del entorno sin resultado final; no se consideran aprobados.
- ESLint focalizado y `git diff --check`: aprobados.
- `npm run build`: no concluyó dentro de cinco minutos sin producir diagnóstico; no se considera aprobado.

El único aviso de herramientas observado fue `baseline-browser-mapping` desactualizado; no se modificaron dependencias para este hotfix.
