Lanzo POS - Sistema de Punto de Venta
Lanzo POS es un sistema de punto de venta (POS) moderno, offline-first, y de código abierto, diseñado para la gestión de pequeños y medianos negocios. Está construido con React, Zustand y una base de datos local IndexedDB, enfocado en la velocidad y la capacidad de funcionar sin conexión a internet.

Este proyecto fue iniciado y patrocinado gracias a la dark kitchen "Entre Alas".

✨ Características Principales
El sistema está compuesto por varios módulos clave que cubren las necesidades esenciales de un negocio:

Punto de Venta (POS)

Interfaz de cuadrícula de productos visual e intuitiva.

Filtrado por categorías y búsqueda de productos en tiempo real.

Resumen del pedido (carrito de compras) que se actualiza al instante.

Soporte para ventas por Unidad y A Granel (peso/volumen).

Gestión de Clientes y Crédito (Fiado)

Base de datos de clientes con nombre, teléfono y dirección.

Sistema de crédito (fiado) integrado en el modal de pago.

Registro de abonos a deudas, afectando directamente la caja.

Historial de compras por cliente.

Gestión de Inventario (Productos)

Creación y edición de productos con control de:

Costo y Precio (con cálculo de margen).

Stock actual.

Fecha de caducidad.

Código de barras.

Calculadora de Costos para productos compuestos.

Gestor de categorías.

Gestión de Caja

Lógica de apertura y cierre de caja con monto inicial y conteo final.

Registro de movimientos de efectivo (entradas y salidas).

Historial de cajas cerradas con cálculo de diferencias.

Dashboard y Estadísticas

Panel de estadísticas clave (Ingresos, Pedidos, Ganancia Neta).

Historial de ventas detallado.

Papelera de Reciclaje para restaurar productos, clientes o ventas eliminadas.

Ticker de Notificaciones con alertas de stock bajo y caducidad.

Integraciones y Utilidades

Escaneo de Código de Barras: Integrado en el POS y en el formulario de productos usando react-zxing.

Integración con WhatsApp: Envío de tickets de venta, recibos de abono y recordatorios de deuda.

Licenciamiento (Supabase): Sistema de activación de licencia por dispositivo usando Supabase y FingerprintJS.

Tema Claro/Oscuro/Sistema: Selector de tema que persiste en localStorage.

🛠️ Stack Tecnológico
Frontend: React 18

Gestión de Estado: Zustand (para useAppStore, useOrderStore, useDashboardStore, useMessageStore)

Routing: React Router v6

Base de Datos Local: IndexedDB (gestionado a través de un wrapper en src/services/database.js)

Autenticación/Licencias: Supabase (RPC y Auth)

Escáner: react-zxing

🧠 Lógica Central
1. Gestión de Estado (Zustand)
La aplicación se apoya fuertemente en Zustand para el manejo del estado global, eliminando la necesidad de Context y facilitando la comunicación entre componentes no relacionados:

useOrderStore: Controla el carrito de compras del POS. Acciones como addItem, clearOrder, etc., están centralizadas aquí.

useDashboardStore: Almacena los datos que se muestran en el Ticker y el Dashboard. Se actualiza después de una venta para mantener la consistencia.

useAppStore: Maneja el estado de la aplicación (loading, unauthenticated, setup_required, ready) basado en la licencia y el perfil del negocio.

2. Flujo de Datos (Offline-First)
El núcleo de la aplicación es el archivo src/services/database.js. Este archivo proporciona funciones (initDB, saveData, loadData, deleteData) que actúan como un wrapper simple sobre IndexedDB.

Casi todas las operaciones (crear venta, guardar producto, añadir cliente) interactúan primero con esta base de datos local. Esto garantiza que la aplicación funcione al 100% sin conexión a internet.

3. Flujo de Licenciamiento (App.jsx)
La aplicación tiene un "guardia" en App.jsx que comprueba el estado en useAppStore antes de renderizar la aplicación principal:

loading: Estado inicial mientras se verifica localStorage e IndexedDB.

unauthenticated: No se encontró licencia. Muestra <WelcomeModal /> para activar una clave.

setup_required: Licencia válida, pero el perfil del negocio no está configurado. Muestra <SetupModal />.

ready: Licencia y perfil listos. Muestra el <Layout /> principal con la aplicación.

## Procedencia y marca

La procedencia de los activos gráficos y el alcance reservado de la identidad
se documentan por separado:

- [Declaración de procedencia de activos](docs/OSS-ASSET-DECLARATION.md)
- [Inventario y conclusión de procedencia](docs/OSS-ASSET-PROVENANCE.md)
- [Política preliminar de marca](TRADEMARK_POLICY.md)

## Autohospedaje

La reproducibilidad está documentada con sus límites actuales:

- [Guía de autohospedaje](docs/SELF-HOSTING.md)
- [Matriz de componentes](docs/SELF-HOSTING-MATRIX.md)
- [Evidencia de validación](docs/SELF-HOSTING-VALIDATION.md)

Estado OSS.1.5: `SELF-HOSTING BLOCKED`. OSS.1.4 continúa `NO-GO` y OSS.2
permanece bloqueado.
