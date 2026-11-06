# UX del modal de abonos — validación local

Fecha: 2026-11-06. Rama local: `fix/abono-modal-ux`.
Base inicial: `origin/main`, HEAD `787293c5b96bc72302e7aafab50291dcfda9c846`.
Base actualizada para publicación: `main` en `5686355a8edfcc9c396367419b9b9d2d55400b39`.
La actualización fue fast-forward, sin conflictos. El hash del diff de aplicación antes y después
fue idéntico (`b43dbd6e8c0b1204689c56d3c03680630cfacec915a13bbc91031d52c8be3c2e`);
no fue necesario reconstruir ni modificar la implementación.
Se comprobó que incluye el merge de #395 (`9d36e133aae04e00daf00b4c5725bc03832ea36f`).

El checkbox anterior estaba deshabilitado cuando Cloud no confirmaba conciliación. Era una protección financiera correcta, pero impedía descubrir la razón del bloqueo. Ahora ambas modalidades se pueden seleccionar; solamente la confirmación específica exige notas verificadas.

## Comportamiento

- **Abono general**, predeterminado: monto libre hasta la deuda disponible. Conserva el callback con asignaciones `null`; el servidor decide/aplica FIFO según el contrato vigente. El navegador no distribuye dinero.
- **Abonar por venta / nota**: tarjetas expandibles con folio, fecha, importe original, saldo vigente y campo de abono. Solo se envían las notas con importe positivo, usando el contrato existente `{ saleId, amountApplied }`. Los totales asignado y a confirmar permanecen visibles.
- Cloud distingue carga, consulta fallida con reconsulta, lista verificada vacía, saldos sin verificar y `historical_unallocated`. Nunca sustituye `current_balance_due = null` por un saldo local/original.
- La cuenta histórica conserva el abono general y explica por qué no puede asignarlo por nota. Habilitarla requiere una conciliación financiera expresamente autorizada y verificable, fuera de este cambio. No se reinterpretaron ni modificaron pagos anteriores.
- Validación de presentación: importes positivos, hasta dos decimales, límites por nota y deuda total; datos Cloud inválidos impiden confirmar asignaciones. El servidor conserva la última palabra ante cambios concurrentes.
- La confirmación usa un bloqueo síncrono contra doble envío y mantiene el foco dentro del diálogo durante la espera. Caja, permisos, comprobante, notificación y manejo financiero del padre conservan sus flujos.

## Archivos

Aplicación:

- `src/components/customers/AbonoModal.jsx`: modalidades, tarjetas, estados, totales y navegación por teclado.
- `src/components/customers/AbonoModal.css`: estilos acotados al modal, cuerpo desplazable y pie con totales/acciones.
- `src/pages/CustomersPage.jsx`: reutiliza la consulta existente para reintentar, distingue error y evita leer ventas IndexedDB cuando el crédito es Cloud.

Pruebas:

- `src/components/customers/__tests__/AbonoModal.allocations.test.jsx`.
- `src/pages/__tests__/CustomersPage.navigation.test.jsx`.
- `scripts/qa/abono-modal/`: demostración aislada y verificación de navegador, excluidas del arranque/build del POS. No usa credenciales, APIs financieras ni base de datos; aborta solicitudes externas.

## Resultados

- **40/40** pruebas Vitest de los dos archivos anteriores.
- ESLint de los archivos JS/JSX modificados: sin errores ni advertencias.
- `npm run build`: PASS, incluidos los dos controles de precache del postbuild. Vite emitió avisos sobre anotaciones de dependencias Zod y mezcla de imports estáticos/dinámicos; no se cambiaron esas dependencias ni sus rutas.
- `git diff --check`: PASS.
- Para publicar se reutiliza la evidencia de las 40 pruebas y del navegador. Tras actualizar
  la base pasaron nuevamente **21/21** pruebas de Clientes y la compilación con postbuild, porque `main` incorporó
  cambios de navegación/PWA. No se repitieron auditorías financieras ni pruebas SQL.
- Chromium real mediante Python Playwright: **13 comprobaciones agrupadas**, sin excepciones de página ni solicitudes externas. General, específico a una nota, doble envío, operación pendiente, históricos, carga, error con reconsulta y ausencia de notas. Teclado: flechas en modalidades, Enter en notas, Tab hacia el importe, ciclo de foco, Escape y retorno al botón que abrió el modal.
- Tamaños comprobados: escritorio 1440×1000; móvil 320×568, 390×844 y 390×520; tema oscuro. Sin desbordamiento horizontal y con confirmación dentro del viewport. El tamaño 390×520 es una comprobación de espacio reducido, no una prueba de teclado virtual Android.

Las notas controladas de la demostración conciliada tienen importe original de $20 y saldo vigente de $15 cada una; la deuda del cliente es $30. Los callbacks se capturan en memoria. **Estos resultados no certifican operaciones financieras ni funcionamiento en Production.**

Evidencia guardada junto a este reporte:

- `browser-results.json`: resultados automatizados.
- `desktop-specific.png`: asignación a una nota en escritorio.
- `mobile-specific.png`: importe original separado del saldo vigente y total del abono.
- `mobile-historical.png`: bloqueo histórico explicado.

## Reproducción

```sh
npx vitest run src/components/customers/__tests__/AbonoModal.allocations.test.jsx src/pages/__tests__/CustomersPage.navigation.test.jsx --maxWorkers=2
npx eslint src/components/customers/AbonoModal.jsx src/components/customers/__tests__/AbonoModal.allocations.test.jsx src/pages/CustomersPage.jsx src/pages/__tests__/CustomersPage.navigation.test.jsx scripts/qa/abono-modal/fixture.jsx scripts/qa/abono-modal/no-database.js
npm run build
```

Para la demostración, iniciar en una terminal:

```sh
npx vite --config scripts/qa/abono-modal/vite.config.mjs
```

Abrir `http://127.0.0.1:5176/` o usar `?scenario=historical_unallocated`, `loading`, `error` o `empty`. En otra terminal, con Python Playwright y Chromium instalados:

```sh
python scripts/qa/abono-modal/verify.py /tmp/lanzo-abono-modal-ux
```

`CHROMIUM_PATH` permite indicar otra ruta al ejecutable. La demostración nunca registra pagos reales.

## Límites y estado

Publicación autorizada mediante commit, push normal y un único PR Draft contra `main`.
SQL, contratos V1/V2, servicios financieros y Production intactos. Sin merge ni cambio a Ready.
No se borró IndexedDB. No se hizo conciliación histórica. La generación automática de Vercel
Preview se comprobará mediante los checks del PR y los metadatos del despliegue.

Pendiente, tras la autorización posterior correspondiente: recorrido real en el entorno aprobado y Android físico, incluyendo comprobante/caja/notificación. El laboratorio visual no sustituye ese QA.
