# Lanzo-POS

Lanzo-POS es un sistema de punto de venta y gestión operativa para pequeños negocios. Combina una aplicación administrativa PWA con operación offline-first, almacenamiento local en IndexedDB, servicios administrados en Supabase y una tienda pública independiente para ecommerce.

El proyecto nació de necesidades operativas reales y continúa en desarrollo activo. Este repositorio está preparando su formalización como proyecto open source, pero todavía no cuenta con una licencia OSS vigente.

## Estado del proyecto

| Área | Estado actual |
|---|---|
| Desarrollo | Activo |
| Aplicación administrativa | PWA offline-first |
| Operación local | Disponible mediante Lanzo Local |
| Servicios administrados | Disponibles mediante Lanzo Nube, conforme a las reglas vigentes del producto |
| Tienda pública | Arquitectura separada para catálogo, checkout y seguimiento |
| Licenciamiento OSS | En preparación; todavía no existe un archivo `LICENSE` |
| Autohospedaje | Documentación y proceso reproducible todavía en desarrollo |

Lanzo-POS se utiliza en flujos operativos reales, pero el repositorio no debe interpretarse todavía como una distribución autohospedable certificada ni como una versión con garantías de disponibilidad, compatibilidad o seguridad absoluta.

## Qué es Lanzo-POS

Lanzo-POS reúne en una sola plataforma las tareas que normalmente quedan separadas entre caja, inventario, clientes, ventas, pedidos y canales digitales.

La arquitectura actual tiene dos superficies principales:

- **Aplicación administrativa:** punto de venta, inventario, clientes, caja, reportes, configuración y operación interna.
- **Tienda pública:** experiencia separada para catálogo, carrito, checkout y seguimiento de pedidos.

La aplicación prioriza la continuidad operativa local. Las operaciones compatibles se apoyan primero en IndexedDB y, cuando corresponde, se sincronizan con servicios cloud administrados.

## Problema que resuelve

Muchos pequeños negocios necesitan controlar ventas, existencias, crédito, caja y pedidos sin depender permanentemente de una conexión estable ni de varias herramientas aisladas.

Lanzo-POS busca reducir esa fragmentación mediante:

- una base operativa local y resistente a interrupciones;
- flujos integrados entre venta, inventario, clientes y caja;
- capacidades específicas para comercio minorista y restaurante;
- sincronización y colaboración administradas cuando el negocio utiliza Lanzo Nube;
- una tienda pública conectada con el flujo operativo del POS.

## Principios del proyecto

1. **Offline-first:** la operación local no debe depender innecesariamente de la red.
2. **Continuidad operativa:** las actualizaciones, recuperaciones y sincronizaciones deben proteger los datos del negocio.
3. **Aislamiento por negocio:** cada negocio opera dentro de un identificador canónico propio.
4. **Exactitud financiera:** importes, descuentos, saldos y movimientos deben conservar una representación consistente.
5. **Evolución compatible:** las migraciones locales y cloud deben respetar datos y contratos existentes.
6. **Seguridad por capas:** navegador, dispositivo, sesiones, RPC, Edge Functions, RLS y almacenamiento tienen responsabilidades distintas.
7. **Transparencia:** las capacidades, limitaciones y estado del licenciamiento deben documentarse sin promesas no verificadas.

## Capacidades principales

### Punto de venta y operación comercial

- Punto de venta con catálogo, búsqueda, categorías y escáner de códigos.
- Ventas por unidad y modalidades compatibles con productos a granel.
- Tickets, recibos y envío de información por WhatsApp.
- Descuentos y representación exacta de importes.
- Historial de ventas, consultas operativas y reportes.
- Apertura, movimientos, conciliación y cierre de caja.

### Productos e inventario

- Productos, categorías, costos, precios y existencias.
- Catálogos independientes para Inventario y Punto de Venta.
- Paginación y consultas locales sobre IndexedDB.
- Lotes, caducidades y estrategias de rotación como FEFO.
- Stock disponible, comprometido y validaciones de inventario.
- Imágenes locales y publicación optimizada de imágenes cuando corresponde.
- Papelera y mecanismos de recuperación para registros compatibles.

### Clientes y crédito

- Registro y consulta de clientes.
- Crédito o fiado.
- Abonos y movimientos de cuenta.
- Apartados.
- Historial relacionado con el cliente.
- Controles de consistencia para deuda y saldos.

### Restaurante

- Recetas e ingredientes.
- Extras y modificadores.
- Flujos de preparación compatibles con la operación del POS.
- División de cuentas.
- Manejo de productos compuestos y consumo de inventario.

### PWA y continuidad

- Instalación como Progressive Web App.
- Service Worker con estrategia de actualización controlada.
- Recuperación frente a chunks obsoletos después de despliegues.
- Conservación de IndexedDB y datos operativos durante la recuperación del shell.
- Workers y servicios locales para procesos especializados.
- Respaldo y restauración en los flujos soportados.

### Lanzo Nube y administración

- Sincronización cloud para las entidades compatibles.
- Administración de dispositivos conforme al plan.
- Sesiones de administrador y staff.
- Notificaciones operativas.
- Servicios administrados de almacenamiento.
- Funciones de inteligencia artificial ejecutadas mediante una Edge Function, con validación y límites administrados.

### Ecommerce y tienda pública

- Portal público por negocio.
- Catálogo, carrito y checkout.
- Pedidos online y bandeja administrativa.
- Preparación y conversión del pedido al Punto de Venta.
- Seguimiento público del pedido.
- Personalización visual y documentos versionados del sitio.
- Imágenes optimizadas.
- Metadata Open Graph e imágenes sociales por negocio.
- Aplicación pública compilada y desplegada de forma separada de la PWA administrativa.

La disponibilidad exacta de cada capacidad depende del modo de operación, el plan, la configuración y los contratos implementados en la versión correspondiente.

## Lanzo Local y Lanzo Nube

### Lanzo Local

Lanzo Local es la modalidad de acceso gratuito orientada a la operación principalmente local.

- Enfoque offline-first.
- Datos operativos guardados principalmente en el dispositivo.
- Capacidades esenciales para pequeños negocios.
- Clave permanente del negocio.
- Sin fecha de caducidad real para la clave de Lanzo Local.
- Dependencia reducida de servicios cloud durante la operación cotidiana.

La aplicación puede requerir conexión para activación, validaciones puntuales o funciones que por naturaleza utilizan infraestructura remota.

### Lanzo Nube

Lanzo Nube es el servicio oficial administrado alrededor de Lanzo-POS.

- Sincronización cloud.
- Uso en varios dispositivos conforme al plan vigente.
- Administración de dispositivos.
- Acceso de administrador y staff.
- Servicios cloud, almacenamiento y operación administrada.
- Ecommerce y capacidades administradas conforme a las reglas vigentes.
- Infraestructura y soporte proporcionados por Lanzo.

Este README no publica precios ni garantiza que todas las capacidades cloud pertenezcan exclusivamente a un plan. Las reglas reales deben comprobarse en la implementación y en la configuración comercial vigente.

## Clave permanente del negocio

La interfaz utiliza el término **clave de licencia**, pero su función arquitectónica no debe confundirse con la licencia jurídica del código fuente.

La clave:

- identifica de forma estable al negocio o tenant;
- es permanente para Lanzo Local y no representa una prueba temporal;
- relaciona el perfil del negocio, dispositivos, productos, configuración, sincronización, ecommerce y pedidos;
- ayuda a conservar el aislamiento entre negocios;
- funciona como identificador canónico alrededor del cual se organizan distintos contratos actuales.

En el código y en la base de datos pueden aparecer nombres como `license_key` y `license_id`. Esta fase documental no cambia esos contratos ni propone sustituirlos.

## Arquitectura general

```text
┌──────────────────────────────────────────────────────────────┐
│ Aplicación administrativa PWA                               │
│ React + Vite + Zustand                                      │
│ POS, inventario, clientes, caja, reportes y configuración   │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│ Capa local offline-first                                    │
│ Dexie + IndexedDB                                           │
│ Datos operativos, cachés, outbox, sesiones y recuperación   │
└───────────────────────┬──────────────────────────────────────┘
                        │ sincronización y servicios
                        ▼
┌──────────────────────────────────────────────────────────────┐
│ Supabase                                                    │
│ PostgreSQL, RLS, RPC, Realtime, Storage y Edge Functions     │
└───────────────────────┬──────────────────────────────────────┘
                        │ contratos públicos
                        ▼
┌──────────────────────────────────────────────────────────────┐
│ Tienda pública separada                                     │
│ Entrada `src/main-store.jsx` + `vite.store.config.js`        │
│ Catálogo, checkout, seguimiento y metadata social           │
└───────────────────────┬──────────────────────────────────────┘
                        ▼
                 Despliegues en Vercel
```

### Aplicación administrativa

La entrada principal vive en `src/main.jsx`. La aplicación carga sus rutas, stores y servicios desde `src/`, con módulos especializados para productos, ventas, clientes, caja, sincronización, ecommerce, seguridad y recuperación PWA.

### Persistencia local

La persistencia local se implementa con Dexie sobre IndexedDB. El esquema contiene stores para productos, lotes, ventas, clientes, caja, movimientos, apartados, ledger de clientes, eventos de inventario, imágenes, caché de sincronización y registros de recuperación.

### Servicios cloud

`supabase/` contiene migraciones y Edge Functions. La aplicación utiliza clientes públicos con claves publicables, mientras que las operaciones privilegiadas pertenecen al servidor, RPC, políticas RLS o funciones administradas.

### Tienda pública

La tienda pública utiliza una entrada y configuración de build separadas. Sus rutas incluyen la tienda por slug, seguimiento de pedidos y una página pública de presentación. El directorio `store/` contiene runtime y funciones orientadas al despliegue público, incluida la generación de metadata e imágenes Open Graph.

### Despliegue

La arquitectura oficial utiliza proyectos separados en Vercel para la aplicación administrativa y la tienda pública. Los scripts del repositorio incluyen preparación y auditoría de artefactos, pero ejecutar despliegues requiere configuración administrada fuera de este README.

## Stack tecnológico

Versiones verificadas en `package.json`:

| Área | Tecnología |
|---|---|
| Interfaz | React 19, React DOM 19 |
| Build | Vite 7, `@vitejs/plugin-react` |
| Rutas | React Router 7 |
| Estado | Zustand 5 |
| Base local | Dexie 4, IndexedDB |
| Backend administrado | Supabase JS 2 |
| PWA | `vite-plugin-pwa` 1 |
| Pruebas | Vitest 4, Testing Library, jsdom |
| Validación | Zod 4 |
| Cálculo decimal | big.js 7 |
| Gráficas | Recharts 3 |
| Escaneo | ZXing y `react-zxing` |
| Metadata social | `@vercel/og` |
| Procesamiento de imágenes servidor | `sharp`, limitado al alcance que lo importa |
| Despliegue oficial | Vercel |
| Iconos y UI auxiliar | Lucide React, React Hot Toast |

El repositorio no declara actualmente un campo `engines` en `package.json`. Utiliza una versión de Node.js y npm compatible con Vite 7 y alineada con el entorno de CI o despliegue que se vaya a usar.

## Preparación del entorno de desarrollo

### Requisitos

- Git.
- Node.js y npm compatibles con las dependencias actuales.
- Un proyecto Supabase propio para los flujos cloud que se deseen ejecutar.
- Configuración local de variables de entorno sin reutilizar secretos de producción.

### Instalación

```bash
git clone https://github.com/fdxruli/Lanzo-POS.git
cd Lanzo-POS
npm ci
```

Crea un archivo local de entorno, por ejemplo `.env.local`, y agrega únicamente las variables necesarias para el flujo que vas a desarrollar. No confirmes archivos `.env` ni valores reales en Git.

### Desarrollo

Aplicación administrativa:

```bash
npm run dev
```

Tienda pública:

```bash
npm run dev:store
```

## Variables de entorno

### Variables públicas del navegador

Estas variables pueden formar parte del bundle del navegador y **no deben contener secretos**:

| Variable | Uso |
|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase utilizado por el cliente |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clave publicable de Supabase |
| `VITE_ENABLE_LICENSE_REALTIME` | Activa el canal realtime de validación cuando vale `true` |
| `VITE_ADMIN_APP_ORIGIN` | Origen público de la aplicación administrativa |
| `VITE_PUBLIC_STORE_ORIGIN` | Origen público de la tienda |
| `VITE_AI_EDGE_FUNCTION` | Nombre de la Edge Function de IA |
| `VITE_AI_PROVIDER` | Selección del proveedor de IA soportado por el cliente |
| `VITE_GOOGLE_CLIENT_ID` | Cliente OAuth para los flujos compatibles de Google Drive |

`VITE_APP_VERSION`, `VITE_BUILD_DATE` y `VITE_BUILD_COMMIT` se inyectan durante el build y normalmente no deben configurarse manualmente.

### Secretos de servidor

Las siguientes variables aparecen en flujos de servidor o funciones administradas y nunca deben llegar al bundle del navegador:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AI_API_KEY`
- `OPENAI_API_KEY`

La lista puede ampliarse conforme evolucionen las Edge Functions. Usa secretos propios del entorno y no copies valores desde producción.

## Comandos npm verificados

| Comando | Propósito |
|---|---|
| `npm run dev` | Servidor de desarrollo de la aplicación administrativa |
| `npm run dev:store` | Servidor de desarrollo de la tienda pública |
| `npm run build` | Build de producción de la aplicación administrativa |
| `npm run build:store` | Build de la tienda pública |
| `npm run build:store:vercel` | Build de la tienda para el flujo de Vercel |
| `npm run deploy:store:prepare` | Prepara el artefacto de despliegue de la tienda |
| `npm run deploy:admin:prepare` | Prepara el artefacto de despliegue administrativo |
| `npm run audit:vercel-output` | Audita el Build Output de Vercel |
| `npm run audit:cutover` | Ejecuta auditorías del cutover público |
| `npm run audit:store:remote` | Audita un despliegue remoto de tienda |
| `npm run lint` | Ejecuta ESLint sobre `src/**/*.js` y `src/**/*.jsx` |
| `npm run test` | Ejecuta Vitest en modo interactivo |
| `npm run test:ci` | Ejecuta Vitest una vez con workers limitados |
| `npm run preview` | Sirve localmente el build administrativo |
| `npm run preview:store` | Sirve localmente el build de tienda |
| `npm run version:status` | Consulta el estado de versión |
| `npm run version:patch` | Incrementa la versión patch |
| `npm run version:minor` | Incrementa la versión minor |
| `npm run version:major` | Incrementa la versión major |
| `npm run version:set` | Establece una versión explícita |

Los comandos `deploy:*` y `audit:*` no sustituyen la configuración de credenciales, proyectos o permisos del entorno administrado.

## Estructura general del repositorio

```text
.
├── src/
│   ├── components/        # Componentes administrativos y públicos
│   ├── config/            # Configuración de aplicación y orígenes
│   ├── hooks/             # Hooks reutilizables
│   ├── layout/            # Estructura visual administrativa
│   ├── pages/             # Pantallas y rutas
│   ├── pwa/               # Service Worker y recuperación de actualizaciones
│   ├── router/            # Rutas administrativas y públicas
│   ├── schemas/           # Esquemas de validación
│   ├── services/          # Dominio, persistencia, sync, cloud y ecommerce
│   ├── store/             # Stores de Zustand
│   ├── styles/            # Estilos y tokens compartidos
│   ├── utils/             # Utilidades de dominio
│   └── workers/           # Procesos en Web Workers
├── store/                 # Runtime y funciones de la tienda pública
├── supabase/
│   ├── functions/         # Edge Functions
│   └── migrations/        # Migraciones SQL versionadas
├── scripts/               # Builds, preparación y auditorías
├── docs/                  # Documentación y reportes técnicos
├── reports/               # Evidencia histórica de fases y auditorías
├── public/                # Recursos públicos de la aplicación administrativa
├── vite.config.js         # Build y PWA administrativa
└── vite.store.config.js   # Build separado de la tienda pública
```

La presencia de reportes históricos no implica que cada resultado siga vigente. Para evaluar el estado actual, revisa el código, las migraciones recientes, las pruebas y el historial de cambios.

## Seguridad y privacidad

Lanzo-POS separa responsabilidades entre cliente y servidor:

- el navegador utiliza claves publicables, no `service_role`;
- las operaciones privilegiadas deben permanecer en RPC, RLS o Edge Functions;
- los secretos de IA y Supabase deben configurarse únicamente en el servidor;
- los flujos de dispositivo y staff utilizan tokens y validaciones específicas;
- las cargas de imágenes pasan por autorización, validación de tipo, tamaño y ruta;
- los artefactos públicos tienen auditorías para evitar incluir archivos privados o secretos;
- la PWA implementa recuperación de actualizaciones sin borrar deliberadamente los datos operativos de IndexedDB.

Estas medidas reducen riesgos, pero no constituyen una garantía de seguridad absoluta. Para comunicar vulnerabilidades de forma responsable, consulta la [política de seguridad](SECURITY.md). El proyecto no promete un SLA ni afirma que exista un programa de recompensas.

No publiques en issues, documentación o ejemplos:

- claves de negocio reales;
- tokens, cookies o sesiones;
- archivos `.env`;
- claves de Supabase o proveedores de IA;
- datos de clientes, ventas o pedidos;
- identificadores internos de infraestructura;
- evidencias privadas de incidentes.

## Estado del licenciamiento OSS

Lanzo-POS está preparando su formalización como proyecto open source.

- La licencia prevista y actualmente en evaluación es **AGPL-3.0-only**.
- AGPL-3.0-only **todavía no está vigente** para este repositorio.
- El archivo `LICENSE` se agregará en una fase posterior, después de la auditoría correspondiente.
- Hasta que exista un archivo `LICENSE`, no debe asumirse que se concedieron permisos formales para usar, copiar, modificar o redistribuir el código como software open source.
- La clave permanente del negocio es un identificador del producto y no tiene relación con la licencia jurídica futura del código fuente.

Este README no sustituye el texto de una licencia ni agrega condiciones propias a AGPL.

## Origen del proyecto

Lanzo surgió de necesidades operativas reales de un pequeño negocio. La primera experiencia se construyó alrededor de la operación de **Entre Alas**, y con el tiempo evolucionó desde un POS local hacia una plataforma con inventario, clientes, caja, restaurante, sincronización y ecommerce.

La historia del proyecto explica su enfoque: priorizar problemas cotidianos, continuidad operativa y herramientas accesibles para negocios pequeños.

## Contribuciones

La apertura formal a contribuciones externas está en preparación.

Antes de considerar una contribución:

1. revisa el estado del licenciamiento descrito arriba;
2. evita incluir datos, credenciales o referencias privadas;
3. limita los cambios a un objetivo claro y verificable;
4. documenta pruebas, migraciones e impacto operativo;
5. no asumas todavía un acuerdo de contribución o una licencia OSS implícita.

Consulta la [guía preliminar de contribución](CONTRIBUTING.md) para conocer el flujo de trabajo, las reglas de procedencia y la responsabilidad sobre contenido asistido por inteligencia artificial. Esta guía no concede permisos jurídicos: `AGPL-3.0-only` todavía no está vigente y el DCO aún no se exige automáticamente.

## Documentación del proyecto

- [Política de seguridad](SECURITY.md)
- [Guía preliminar de contribución](CONTRIBUTING.md)
- [Política preliminar de marca](TRADEMARK_POLICY.md)
- [Auditoría de preparación OSS](docs/OSS-AUDIT.md)
- [Hoja de ruta de transición OSS](docs/OSS-ROADMAP.md)
- [Estado actual del autohospedaje](docs/SELF-HOSTING-STATUS.md)

Estos documentos preparan la transición del proyecto, pero no sustituyen una licencia de software ni declaran que `AGPL-3.0-only` ya esté vigente.

## Roadmap general

La transición open source se gestiona por fases en la [hoja de ruta OSS](docs/OSS-ROADMAP.md). Las prioridades inmediatas son completar el escaneo local del historial, sanear datos operativos, verificar dependencias y activos, certificar el autohospedaje y, únicamente después, adoptar formalmente la licencia seleccionada.

La hoja de ruta expresa dirección técnica y documental, no fechas ni compromisos comerciales.

## Autohospedaje y documentación pendiente

El repositorio contiene componentes importantes de la arquitectura, incluida la aplicación administrativa, la tienda pública, migraciones y Edge Functions. Sin embargo:

- el flujo oficial utiliza infraestructura administrada;
- la instalación completa todavía no está documentada de extremo a extremo;
- existe un [documento de estado del autohospedaje](docs/SELF-HOSTING-STATUS.md), pero todavía no una guía completa y certificada de instalación;
- no se promete una instalación sencilla o certificada;
- Docker no debe considerarse soportado mientras no exista una implementación y documentación verificadas;
- despliegues, dominios, Storage, RLS, secretos y operaciones cloud requieren configuración propia.

La documentación de autohospedaje se publicará después de completar la auditoría OSS y separar claramente los componentes comunitarios de los servicios administrados.
