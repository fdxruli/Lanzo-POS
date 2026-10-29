# Acerca de Free · Mobile-first R1

Fecha: 16 de octubre de 2026 (America/Mexico_City).

## A. Estado de implementación

**PARCIAL para certificación integral; implementación y pruebas focales completas.**

- Rama: `codex/about-free-mobile-first-r1`.
- [PR Draft #359](https://github.com/fdxruli/Lanzo-POS/pull/359), sin merge.
- HEAD inicial y `origin/main` verificado: `1efcd6dbf1ccdbd1458250c7f9ce398d5d53b254`.
- HEAD de implementación: `2df6eeb864ff5c964d3e156a3ac19b970de2bf07`.
- HEAD final de entrega: consultar `headRefOid` del PR; los commits posteriores al HEAD de implementación contienen documentación/evidencia.
- [Preview de la rama](https://lanzo-pos-git-codex-about-free-mobile-98ddb7-fdxrulis-projects.vercel.app/acerca-de).
- Vercel informó `Deployment has completed`. Se verificó HTTP 200 con `vercel curl` y, tras obtener acceso temporal, el navegador renderizó la bienvenida real del POS. No se creó ni utilizó una licencia de producción para QA.
- [Comparación global PR127 del código](https://github.com/fdxruli/Lanzo-POS/actions/runs/38962742341): **PASS diferencial**, 100 fallos compartidos con BASE, cero exclusivos del candidato y cero identidades sin resolver. La suite global bruta no está totalmente verde; el gate confirma ausencia de fallos nuevos. Ver [resumen descargado](about-free-mobile-first-r1/ci-comparison.md).

No se ejecutaron migraciones, escrituras en Supabase ni operaciones POS de producción.
Los archivos locales de recuperación preexistentes no se incluyeron en el PR.

## B. Cambios y aislamiento

`src/pages/AboutPage.jsx` monta `AboutLocalExperience` exclusivamente cuando el
resolver devuelve `ABOUT_LICENSE_STATE.LOCAL_ACTIVE`. El resto conserva su DOM,
acciones, herramientas y formularios existentes.

`AboutLocalExperience.jsx` y su CSS organizan el contenido en este orden:

1. Lanzo Local identificado con check, «Tu plan actual», estado confirmado y atributos compactos.
2. Categorías de venta, inventario, caja, clientes, reportes, Ecommerce, respaldos y herramientas del rubro cuando se confirma un rubro conocido.
3. «Elige a tu ritmo», sin modalidad preseleccionada, con `aria-pressed`, foco visible y recomendación `role=status` atómica.
4. Beneficios adicionales de Nube y contacto asistido con las acciones originales.
5. Historia, ayuda, Telegram y versión existentes.

Los límites se leen de la licencia disponible, incluidos features anidados y
overrides. Si falta un límite, se muestra «según licencia» en lugar de prometer
1/10 arbitrariamente. Se admiten cero y el valor ilimitado de Ecommerce.
Portal, horarios, WhatsApp, bandeja y alertas locales dependen de sus features.
No se presentan recetas, modificadores, variantes, laboratorio ni estaciones
PRO como herramientas Free. Los reportes consideran los permisos del actor.

`aboutTelegramActions.js` añade una comprobación **de presentación**, solo para
Local: no anunciar activo si `valid !== true` o `is_entitled === false`, incluso
si el presentador compartido normaliza metadatos antiguos de vencimiento Free.
No se cambia el resolver compartido de licencias, las autorizaciones ni los
contratos de Telegram.

El CSS nuevo parte de una columna y escala con container queries a dos/tres
columnas según ancho útil. Reutiliza los tokens y el layout de navegación
existentes, limita la lectura de párrafos y conserva estado/check en móvil.
El contenedor de las categorías no envuelve el diálogo fijo de Telegram.
No se añaden dependencias, sticky headers ni scroll interno a la pantalla.

Se conserva la selección informativa y los mensajes/permisos de Telegram. La
promoción 3 meses/$300 no tiene vigencia verificable y no se anuncia en Free.
La tabla `plans` confirmó $129 MXN para PRO, pero la pantalla solicita condiciones
vigentes sin inventar un contrato promocional.

### Auditoría inicial

Se comprobaron los archivos solicitados, permisos, Ecommerce, rubros, navegación,
pruebas y workflows. Los siete hallazgos previos seguían presentes: resumen de
plan, selector vacío, selector antes de capacidades, tres beneficios Local,
oferta temprana, badge oculto en móvil y ancla `#about-local-plan`.

PR abiertos revisados: #357 (incidentes, modifica About y sus pruebas), #352 y
#338 (restaurante). #357 requiere coordinar sus cambios posteriores en los
formularios de ayuda; no se incorporó ni se mezcló esa rama.

### Supabase: lectura verificada

Se consultó únicamente configuración comercial de `public.plans` y metadatos de
contratos. No se leyeron registros de clientes ni operaciones financieras.

| Capacidad | `free_trial` | `pro_monthly` |
|---|---:|---:|
| Precio MXN | 0 | 129 |
| max_devices | 1 | 5 |
| cloud_pos_sync | false | true |
| staff_roles | false | true |
| ai_agents | false | true |
| ecommerce_max_published_products | 10 | -1 |
| ecommerce_portal_enabled | true | true |
| ecommerce_whatsapp_checkout | true | true |
| ecommerce_order_inbox | true | true |

Estos datos sirven como evidencia de auditoría. No se agrega una consulta a la
red al abrir Acerca de: la pantalla usa la licencia efectiva almacenada.

## C. Validaciones

| Suite / revisión | Resultado | Evidencia |
|---|---|---|
| ESLint focal, componentes, helper, pruebas y fixture | PASS, cero warnings de código | `npx eslint src/pages/AboutPage.jsx src/pages/AboutLocalExperience.jsx src/pages/aboutTelegramActions.js src/pages/__tests__/AboutPage.localExperience.test.jsx scripts/qa/about-free --max-warnings=0` |
| Nueva experiencia Local | PASS: 19 pruebas | `src/pages/__tests__/AboutPage.localExperience.test.jsx` |
| About / acciones / Telegram existentes | PASS: 52 pruebas en 3 archivos | `vitest run AboutPage.telegramContacts.test.jsx aboutTelegramActions.test.js src/services/support` |
| Local + resolver después del ajuste conservador | PASS: 45 pruebas, 2 archivos | Ejecución conjunta de las 19 nuevas y las 26 del resolver |
| Licencia / actor / storage / Ecommerce / Telegram | PASS: 269 pruebas, 24 archivos | Comando reproducible abajo |
| HTML de PRO contra BASE | PASS: 5 estados, igualdad exacta | Copia temporal de AboutPage desde el HEAD inicial; `renderToStaticMarkup` con los mismos mocks/actor para activo, gracia, vencido, pendiente y desconocido; temporal eliminado tras ejecutar |
| Build POS + postbuild | PASS | `npm run build`; auditoría de precache: 23 assets de arranque. Advertencias de tamaño de chunks y glob sin rutas separadas, sin fallo de build |
| Build del fixture visual independiente | PASS | `vite build --config scripts/qa/about-free/vite.config.mjs` |
| React Doctor | Sin problemas encontrados en 2 archivos React | API de score inaccesible; no se atribuye puntuación |
| Contratos estáticos de creación/entitlement/downgrade | 16 PASS, 1 fallo preexistente | Ver atribución abajo |
| `git diff --check origin/main...HEAD` | PASS | Sin cambios en migraciones, autoridad, storage, finanzas o workflows |
| PR127 global BASE/candidato del código `2df6eeb86` | PASS diferencial | 100 fallos compartidos, 0 nuevos, 0 exclusivos y 0 identidades sin resolver; los commits siguientes solo documentan evidencia |
| Actor Runtime / Actor Scoped Storage workflows completos | No activados por paths | No se tocaron sus rutas protegidas; se ejecutaron suites focales relevantes |
| Preview desplegado | READY; HTTP 200 y bienvenida POS renderizada | Acceso temporal Vercel obtenido; Acerca de con licencia de QA real sigue pendiente |

Comando de la suite de 269 pruebas (Vitest también selecciona archivos cuyo path
coincide con los filtros):

```powershell
node node_modules/vitest/vitest.mjs run src/utils/__tests__/licenseStatusPresentation.test.js src/services/auth/__tests__/actorScopedStorage.test.js src/services/auth/__tests__/actorRuntimeController.test.js src/services/ecommerce/__tests__/ecommerceOrderCapabilities.test.js src/pages/__tests__/AboutPage.telegramContacts.test.jsx --maxWorkers=2 --reporter=dot
```

### Atribución del fallo contractual

`license-expired-material-downgrade-r1.node-test.mjs`, caso **phase 2 never mutates
financial state**, falla porque su regex detecta `ledger` en el comentario SQL
«No cash, sales, ledger, balance, or financial mutations».

Se exportaron desde el HEAD inicial el test y sus cuatro archivos SQL a un
directorio temporal aislado y se ejecutó Node Test: **BASE 8 PASS / 1 FAIL**, mismo
caso. El candidato tiene los mismos archivos sin cambios. Es un fallo contractual
preexistente por texto de comentario, no evidencia de escritura financiera. No
se modificó ni debilitó el test.

## D. QA visual

Se capturaron `AboutPage` y `Navbar` reales con CSS real en un fixture separado,
con negocio, actor y licencia **sintéticos**, sin montar los efectos operativos
de `Layout`. Ver instrucciones y limitación de módulos del navegador integrado en
`scripts/qa/about-free/README.md`.

| Ancho | Columnas de categorías | Captura | Desbordamiento horizontal |
|---|---:|---|---|
| 320 | 1 | [320](about-free-mobile-first-r1/light-320.jpg) | Ninguno |
| 360 | 1 | [360](about-free-mobile-first-r1/light-360.jpg) | Ninguno |
| 375 | 1 | [375](about-free-mobile-first-r1/light-375.jpg) | Ninguno |
| 390 | 1 | [390](about-free-mobile-first-r1/light-390.jpg) | Ninguno |
| 414 | 1 | [414](about-free-mobile-first-r1/light-414.jpg) | Ninguno |
| 600 | 2 | [600](about-free-mobile-first-r1/light-600.jpg) | Ninguno |
| 768 | 2 | [768](about-free-mobile-first-r1/light-768.jpg) | Ninguno |
| 1024 | 2 | [1024](about-free-mobile-first-r1/light-1024.jpg) | Ninguno |
| 1280 | 3 | [1280](about-free-mobile-first-r1/light-1280.jpg) | Ninguno |
| 1440 | 3 | [1440](about-free-mobile-first-r1/light-1440.jpg) | Ninguno |
| 1920 | 3 | [1920](about-free-mobile-first-r1/light-1920.jpg) | Ninguno |

Mediciones de `clientWidth`, `scrollWidth`, ancho de main, columnas y elementos
que exceden el borde derecho: [responsive.json](about-free-mobile-first-r1/responsive.json).

Otras evidencias:

- [Oscuro móvil](about-free-mobile-first-r1/dark-390.jpg), [320](about-free-mobile-first-r1/dark-320.jpg), [tablet](about-free-mobile-first-r1/dark-768.jpg), [desktop](about-free-mobile-first-r1/dark-1440.jpg).
- [Horizontal 844×390](about-free-mobile-first-r1/landscape-844.jpg): sin desbordamiento horizontal.
- [Modalidad individual](about-free-mobile-first-r1/solo-390.jpg) y [equipo](about-free-mobile-first-r1/team-390.jpg).
- [Vista previa Telegram](about-free-mobile-first-r1/telegram-390.jpg); no se envió ningún mensaje.
- [Final junto al navbar](about-free-mobile-first-r1/bottom-390.jpg): footer termina en y=730.9 y navbar empieza en y=779, viewport de 390×844. Ayuda y versión accesibles.
- [Bienvenida real del Preview](about-free-mobile-first-r1/preview-welcome.jpg), después de superar la protección Vercel. No se creó una licencia ni se escribieron datos.

Se verificaron encabezados/estados, foco, selección con teclado y Escape con
restauración del foco. La pantalla no requiere consultas remotas nuevas para
renderizar datos locales válidos. Esto no certifica una instalación PWA real
tras cerrar/reabrir el navegador sin red.

## E. Riesgos y pendientes

- El Preview exige una licencia POS para abrir Acerca de. El acceso temporal
  Vercel se obtuvo después de fallos de transporte y se comprobó la bienvenida
  real. Para probar Free dentro del Preview hace falta una licencia de QA
  autorizada; no se creó una contra producción. No se desactivaron protecciones.
- Zoom de navegador al 200%, lector de pantalla, teléfono físico con safe areas
  y reapertura offline de una PWA real requieren QA manual. No se declara una
  certificación integral WCAG 2.2 AA con estas comprobaciones parciales.
- PR127 pasó para el código; cualquier rerun de los commits de documentación debe
  revisarse también. Los 100 fallos compartidos no equivalen a una suite global
  completamente aprobada, aunque no son regresiones introducidas aquí.
- El fallo estático preexistente de downgrade sigue abierto, sin cambios aquí.
- Hay cruce potencial con #357 en ayuda/incidentes; revisar al integrar ramas.
- La vigencia de la promoción 3 meses/$300 no está confirmada. Consultar condiciones
  preserva el canal comercial sin prometer un precio no validado.

## F. Checklist del propietario

1. Abrir el Preview con sesión Vercel autorizada y licencia Free de QA. Confirmar
   «Lanzo Local», check, «Tu plan actual» y «Activo», sin selección de modalidad.
2. En teléfono, recorrer el orden plan → capacidades → selector → Nube → ayuda.
   Confirmar que ayuda, versión y botones finales quedan sobre el navbar.
3. Revisar 320/360 y 390/414, girar el teléfono y comprobar safe areas; repetir en
   tablet y desktop con sidebar. No debe haber desplazamiento horizontal.
4. Alternar claro/oscuro y aplicar zoom al 200%. Revisar títulos, textos, foco,
   atributos del plan, botones y diálogo Telegram sin pérdida de contenido.
5. Con teclado, Tab/Shift+Tab y Enter/Espacio: seleccionar ambas modalidades,
   comprobar la recomendación, abrir Telegram, recorrer el diálogo y cerrarlo
   con Escape. El foco debe regresar al disparador. No es necesario enviar.
6. Elegir «Vendo desde un equipo» y «Mantener plan Local». El ancla debe llevar al
   plan visible y la licencia debe seguir igual.
7. Con licencia de QA y límites distintos, verificar dispositivos/productos,
   flags de portal/horarios/WhatsApp/bandeja y rubros. No deben aparecer campos
   especializados PRO como incluidos en Free.
8. Repetir con actor Staff y con actor por resolver: soporte general disponible,
   sin solicitudes comerciales de administrador.
9. Abrir PRO activo, gracia, vencido y pendiente. Confirmar herramientas,
   renovación/reactivación/soporte originales y ausencia de categorías nuevas Free.
10. Tras instalar/cargar el Preview en un entorno de QA compatible, desconectar
    internet y reabrir Acerca de con licencia local válida. Confirmar contenido
    local y avisos de conexión en herramientas online.
11. Revisar PR127 y el diff final. No aprobar merge mientras existan fallos
    exclusivos del candidato o pendientes de validación críticos.

## G. Recomendación

**HOLD_FIX_REQUIRED para cierre técnico integral.** El Draft y las evidencias están
disponibles para revisión del propietario. Queda por certificar Acerca de Free
dentro del Preview con licencia de QA, y el zoom/safe areas/offline reales.
El comparador global del código pasó sin fallos nuevos.
Esta recomendación no identifica un defecto funcional nuevo: conserva el gate
de verificación solicitado. No se declara `READY_FOR_MERGE`.
