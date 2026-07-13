# ECOM.ORDERS.2.3.2 — Historial móvil carrito → pago

## Estado

- PR: `#95 — HOTFIX ECOM.ORDERS — corregir seguimiento del ciclo operativo`
- Rama: `fix_seguimiento_pedidos_ecommerce`
- Estado del PR: `DRAFT`
- Merge: `NO REALIZADO`
- Ready for review: `NO, hasta una revisión independiente`

## HEAD

- HEAD inicial verificado: `f9d31fed0e1538d8ae74183e498104d090464e41`
- HEAD de implementación antes de agregar este reporte: `b32389bcfc69372cc4d6860f9c2848e8fd93221f`
- HEAD final del PR: consultar la descripción del PR y la entrega final; agregar este reporte modifica el HEAD por sí mismo.

## Causa raíz

La transición móvil anterior ejecutaba conceptualmente:

```text
pushState del carrito
→ replaceState para retirar el marcador del carrito
→ pushState del pago o receta
```

`replaceState` modificaba la entrada actual, pero no la eliminaba. La entrada del carrito quedaba convertida en una copia de la ruta POS sin marcador. El nuevo modal agregaba otra entrada, por lo que después de cerrar pago o receta quedaba una pulsación Atrás sin efecto visual.

También existía el mismo riesgo cuando una capa POS cambiaba de identidad mientras permanecía abierta, por ejemplo:

```text
receta → pago
quickCaja → pago
```

El efecto dependía de `layerId`, limpiaba el marcador anterior y volvía a crear otra entrada.

## Arquitectura anterior

Cada instancia de `useDismissibleHistoryLayer`:

1. creaba un token;
2. ejecutaba `pushState` al abrir;
3. consumía la entrada con `history.back()` al cerrar normalmente;
4. utilizaba `replaceState` para la transición carrito → modal;
5. volvía a ejecutar `pushState` cuando la nueva capa se montaba.

La opción `replaceHistory` evitaba un `popstate` tardío, pero dejaba una entrada física sin propietario.

## Arquitectura nueva

Se añadió una transferencia explícita de propiedad de la entrada actual:

```text
POS + carrito + token A
→ handoff
POS + pago/receta + token B
```

La transferencia:

1. invalida el token del carrito;
2. conserva la entrada actual;
3. cierra visualmente el carrito;
4. registra un handoff pendiente;
5. permite que la siguiente capa reclame la entrada;
6. sustituye `token A` por `token B` mediante `replaceState`;
7. evita un segundo `pushState`.

El adaptador móvil ahora usa:

```js
closeCart({ handoffHistory: true });
```

## Propiedad de la entrada

La capa compartida mantiene:

- token propietario actual;
- identificador de capa propietario;
- si posee una entrada;
- cierre programático pendiente;
- handoff pendiente;
- estado de montaje;
- tokens activos;
- tokens invalidados;
- timer de recuperación del handoff;
- timer defensivo del cierre programático.

Los listeners por instancia se eliminan en cleanup. El listener de recuperación compartido utiliza conteo de instancias montadas y se elimina cuando no quedan hooks montados.

## Transferencia de token

Durante carrito → pago o carrito → receta:

```text
token A deja de ser activo
→ token A queda invalidado
→ la siguiente capa reclama la misma entrada
→ replaceState instala token B
```

Un `popstate` tardío que contenga `token A` se ignora si el navegador todavía conserva `token B` como propietario real.

Si el handoff no es reclamado dentro del timeout defensivo, la entrada huérfana se consume con `history.back()` en lugar de quedarse como una ruta duplicada sin marcador.

## Comportamiento de pushState

### Antes

```text
abrir carrito: pushState
carrito → pago: replaceState + pushState
```

Resultado: dos niveles sobre POS y una entrada fantasma intermedia.

### Después

```text
abrir carrito: pushState
carrito → pago/receta: replaceState del token en la misma entrada
```

Resultado: un único nivel descartable sobre POS.

El pago abierto sin carrito conserva su `pushState` normal.

## Comportamiento de replaceState

`replaceState` ya no se utiliza para dejar una entrada sin marcador antes de abrir otra. Ahora sustituye directamente el token propietario de la misma entrada.

Los cambios internos de capa con `isOpen === true`, por ejemplo receta → pago, reemplazan el token en la entrada existente y no recrean el nivel de historial.

## Comportamiento de popstate

- Atrás desde carrito cierra solamente carrito.
- Atrás desde pago o receta cierra solamente la capa activa.
- El siguiente Atrás alcanza directamente la ruta anterior a POS.
- Un evento tardío con un token invalidado no puede cerrar la capa propietaria actual.
- Los tokens que quedan en el historial hacia adelante se marcan como invalidados y se recuperan sin ejecutar callbacks de componentes desmontados.

## Archivos modificados

```text
src/hooks/useDismissibleHistoryLayer.js
src/hooks/pos/usePosModals.js
src/hooks/pos/__tests__/usePosModals.mobileTransition.test.jsx
reports/ecom_orders_2_3_2_mobile_history_layer_handoff_report.md
```

No se modificaron:

```text
src/hooks/pos/usePosCheckout.js
seguimiento público
fulfillment
pedidos online
inventario
reservas
lotes
caja
processSale
conversionKey
checkoutAttemptId
confirmación remota ecommerce
Supabase
migraciones
SQL
```

## Pruebas Vitest añadidas

La suite `usePosModals.mobileTransition.test.jsx` ahora cubre:

1. apertura normal del carrito con un único `pushState`;
2. cierre normal mediante Atrás y callback único;
3. handoff carrito → pago sin segundo `pushState`;
4. propiedad del token de pago;
5. rechazo de `popstate` tardío del carrito;
6. Atrás desde pago hacia POS y después hacia la ruta anterior;
7. tres ciclos carrito → pago → cancelar sin acumulación;
8. carrito → receta → pago reutilizando la entrada;
9. pago directo sin carrito;
10. recuperación de un handoff no reclamado;
11. comportamiento bajo `React.StrictMode`.

## Prueba de integración

Se agregó un modelo determinista de historial para representar:

```text
ruta anterior
→ POS
→ carrito
→ pago
→ Atrás cierra pago
→ Atrás vuelve a ruta anterior
```

La prueba verifica índices, estados, tokens, `pushState`, `replaceState`, `back` y callbacks, sin depender únicamente de `history.length` de jsdom.

## Validación ejecutada

### Sintaxis de archivos modificados

Resultado: `PASS`

Se ejecutó sobre copias exactas de los archivos modificados:

```text
node --check src/hooks/useDismissibleHistoryLayer.js
node --check src/hooks/pos/usePosModals.js
TypeScript parser --allowJs --jsx react-jsx --noEmit --noResolve
```

No se detectaron errores de sintaxis en JavaScript o JSX.

### Revisión equivalente a diff check enfocada

Resultado: `PASS` para los archivos modificados.

Se verificó:

- newline final;
- ausencia de whitespace al final de línea;
- parseo correcto de los tres archivos.

El comando completo `git diff --check` no pudo ejecutarse porque el entorno disponible opera mediante el conector GitHub y no dispone de un checkout local completo del repositorio.

## Validaciones no ejecutadas en este entorno

### Vitest enfocado

```bash
npx vitest run \
  src/hooks/pos/__tests__/usePosModals.mobileTransition.test.jsx \
  src/hooks/pos/__tests__/usePosCheckout.ecommerce.test.jsx
```

Estado: `NO EJECUTADO`.

Motivo: el entorno de edición conectado a GitHub no dispone del checkout completo ni de las dependencias instaladas. La suite fue ampliada, pero debe ejecutarse en el entorno local del proyecto antes de revisión independiente.

### ESLint enfocado

Estado: `NO EJECUTADO` por la misma limitación de entorno.

### npm run test:ci

Estado: `NO EJECUTADO`.

No se declaró `PASS` ni `TIMEOUT` porque el comando no llegó a iniciarse.

### npm run lint

Estado: `NO EJECUTADO`.

### npm run build

Estado: `PENDIENTE DE CHECK AUTOMÁTICO DE VERCEL / EJECUCIÓN LOCAL`.

No se abrió ni validó manualmente el preview. Solo se observó el check automático creado por los commits.

## Pruebas manuales

### Android físico / gesto Atrás

Estado: `PENDIENTE`.

### Botón Atrás del navegador móvil

Estado: `PENDIENTE`.

### Botón cancelar/cerrar

Estado: cubierto por la prueba automatizada del modelo de historial; validación visual real pendiente.

### Receta

Estado: cubierto por prueba automatizada; validación visual real pendiente.

No se realizó una venta real.

## Commits creados para ECOM.ORDERS.2.3.2

```text
56c02138b806a389f4d424abaf6d95d5f8745ae3 Fix mobile history layer handoff
1f2e8e7bec82c7c7d1cbcd78bdd2b1ea65400bea Use explicit cart history handoff
fdebe0aa02db80696e90b93e6f2d505e44eec482 Test mobile history layer ownership transfer
23e918af8a671a3787dadbcadbb765f9a5026a5a Consume orphaned history handoffs
31a2db75a75d4e3e36791a5adb0b818eadd7407b Assert orphaned handoff entry is consumed
b32389bcfc69372cc4d6860f9c2848e8fd93221f Clean focused history hook formatting
```

## Riesgos residuales

1. Falta ejecutar Vitest y ESLint reales con las dependencias del proyecto.
2. Falta confirmar el build automático o ejecutar `npm run build` localmente.
3. Falta prueba manual con botón físico/gesto Atrás en Android y navegador móvil real.
4. La validación independiente debe confirmar que el timeout de recuperación no interactúa con navegadores embebidos que retrasen el montaje más de un segundo.
5. La corrección no debe marcarse lista para revisión hasta completar las pruebas pendientes.

## Conclusión

La causa de la entrada fantasma se eliminó a nivel de arquitectura: la transición ya no crea una entrada nueva después de desmarcar la anterior, sino que transfiere la propiedad de la entrada existente. La corrección permanece en draft y no debe mergearse hasta ejecutar las validaciones reales y realizar una revisión independiente.
