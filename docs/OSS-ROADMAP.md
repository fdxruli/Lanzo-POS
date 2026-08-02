# Hoja de ruta de transición open source

## Principios de la transición

La apertura de Lanzo-POS se realizará por fases verificables. `AGPL-3.0-only` es la licencia prevista, pero todavía no está vigente y no existe un archivo `LICENSE`. El repositorio continúa bajo los derechos aplicables por defecto. Ninguna fase preparatoria concede nuevos permisos jurídicos.

Los estados utilizados son: `COMPLETE`, `IN PROGRESS`, `PENDING`, `BLOCKED` y `NOT STARTED`.

## OSS.0 — Modernización del README

- **Objetivo:** actualizar la presentación del proyecto, su arquitectura, alcance y estado real.
- **Estado:** `COMPLETE`.
- **Entregables:** `README.md` modernizado y aclaración del estado de licenciamiento.
- **Criterio de salida:** documentación principal coherente con el producto actual y sin afirmar que AGPL ya está vigente.
- **Dependencias:** revisión del alcance funcional y técnico existente.
- **Riesgos:** sobreprometer capacidades, soporte o apertura jurídica.

## OSS.1 — Auditoría remota

- **Objetivo:** identificar bloqueantes de seguridad, titularidad, datos, dependencias, activos y autohospedaje mediante revisión estática remota.
- **Estado:** `COMPLETE`.
- **Entregables:** `docs/OSS-AUDIT.md` con evidencia, limitaciones y recomendación NO-GO.
- **Criterio de salida:** hallazgos clasificados y próximos pasos documentados sin declarar el repositorio listo para licenciar.
- **Dependencias:** acceso al árbol y metadatos remotos disponibles.
- **Riesgos:** falsos negativos por no inspeccionar exhaustivamente todos los objetos Git ni ejecutar herramientas locales.

## OSS.1.1 — Escaneo local de secretos e historial

- **Objetivo:** revisar el árbol completo, todas las referencias y el historial alcanzable en busca de secretos, credenciales y datos sensibles.
- **Estado:** `PENDING`.
- **Entregables:** resultados redactados de Gitleaks y TruffleHog, inventario de hallazgos, evidencia de rotación y plan de limpieza cuando corresponda.
- **Criterio de salida:** escaneos ejecutados sobre las referencias requeridas, hallazgos evaluados y secretos reales rotados antes de cualquier reescritura histórica.
- **Dependencias:** instalación local de Gitleaks y TruffleHog, clon completo y autorización para revisar el historial.
- **Riesgos:** exponer secretos en logs, confundir claves públicas con secretos o eliminar evidencia antes de rotar credenciales.

## OSS.1.2 — Gobernanza y documentación

- **Objetivo:** establecer una base preliminar para seguridad, contribuciones, marca, transición OSS y estado del autohospedaje.
- **Estado:** `COMPLETE`.
- **Entregables:** `SECURITY.md`, `CONTRIBUTING.md`, `TRADEMARK_POLICY.md`, `docs/OSS-ROADMAP.md` y `docs/SELF-HOSTING-STATUS.md`.
- **Criterio de salida:** documentos consistentes, honestos y explícitos en que AGPL es prevista, no vigente.
- **Dependencias:** resultados de OSS.1 y conocimiento de la arquitectura actual.
- **Riesgos:** convertir políticas preliminares en promesas operativas o jurídicas no verificadas.

## OSS.1.3 — Saneamiento del árbol

- **Objetivo:** retirar, anonimizar o sustituir datos operativos, rutas locales, casos reales y material sensible del árbol actual.
- **Estado:** `NOT STARTED`.
- **Entregables:** inventario de archivos afectados, cambios de saneamiento y validación de que no se alteró comportamiento productivo sin intención.
- **Criterio de salida:** árbol actual libre de datos reales innecesarios y documentación operativa apta para publicación.
- **Dependencias:** OSS.1.1 y clasificación de cada hallazgo.
- **Riesgos:** borrar evidencia necesaria, romper pruebas o dejar copias equivalentes en otras rutas.

## OSS.1.4 — Dependencias, activos y procedencia

- **Objetivo:** verificar licencias, avisos, autoría y derechos sobre dependencias, código, documentación, imágenes, logos e iconos.
- **Estado:** `NOT STARTED`.
- **Entregables:** inventario legal, decisiones de reemplazo, futura preparación de avisos de terceros y SBOM, y registro de procedencia.
- **Criterio de salida:** componentes incompatibles o inciertos resueltos y derechos suficientes documentados para el alcance que se pretende licenciar.
- **Dependencias:** inventario técnico completo y revisión humana de procedencia.
- **Riesgos:** asumir que la presencia pública o el uso de IA garantiza titularidad o compatibilidad.

## OSS.1.5 — Autohospedaje reproducible

- **Objetivo:** demostrar una instalación limpia y reproducible de extremo a extremo fuera de la infraestructura oficial.
- **Estado:** `NOT STARTED`.
- **Entregables:** matriz de versiones, variables documentadas, secuencia de migraciones, configuración de RLS, Storage y Edge Functions, despliegue de tienda pública y procedimientos de actualización, respaldo y restauración.
- **Criterio de salida:** instalación nueva completada y repetida con documentación suficiente, sin usar secretos ni datos de producción de Lanzo.
- **Dependencias:** saneamiento, inventario de infraestructura y entorno de prueba aislado.
- **Riesgos:** documentar comandos no verificados, omitir dependencias administradas o confundir una instalación parcial con soporte certificado.

## OSS.2 — Adopción formal de AGPL

- **Objetivo:** adoptar formalmente `AGPL-3.0-only` para el alcance aprobado del código.
- **Estado:** `BLOCKED`.
- **Entregables:** archivo `LICENSE`, avisos consistentes y documentación final del alcance licenciado.
- **Criterio de salida:** bloqueantes de titularidad, secretos, dependencias, activos, datos y autohospedaje cerrados, con decisión explícita del maintainer.
- **Dependencias:** OSS.1.1 a OSS.1.5 completadas y revisión jurídica cuando resulte necesaria.
- **Riesgos:** conceder derechos sobre contenido sin titularidad suficiente o activar una licencia antes de limpiar secretos y datos.

## OSS.3 — Apertura a contribuciones externas

- **Objetivo:** aceptar contribuciones externas mediante procesos claros, seguros y sostenibles.
- **Estado:** `NOT STARTED`.
- **Entregables:** proceso final de contribución, DCO adoptado si se confirma, plantillas y controles de revisión.
- **Criterio de salida:** responsabilidades, procedencia, seguridad y mantenimiento definidos y aplicables.
- **Dependencias:** OSS.2 y capacidad del maintainer para revisar y sostener contribuciones.
- **Riesgos:** acumular cambios sin revisión, incorporar contenido incompatible o prometer soporte no disponible.

## OSS.4 — Postulación a Codex for OSS

- **Objetivo:** evaluar y, si corresponde, presentar Lanzo-POS al programa Codex for OSS.
- **Estado:** `NOT STARTED`.
- **Entregables:** evaluación de elegibilidad, evidencia de licencia activa, gobernanza, actividad y documentación requeridas por el programa vigente.
- **Criterio de salida:** postulación completa conforme a los requisitos vigentes o decisión documentada de no postular.
- **Dependencias:** OSS.2, OSS.3 y verificación actualizada de los criterios del programa.
- **Riesgos:** asumir elegibilidad o aceptación. Esta hoja de ruta no afirma que OpenAI aceptará el proyecto.

## Estado de la decisión de licencia

El NO-GO para activar AGPL se mantiene hasta cerrar los bloqueantes definidos. La clave permanente del negocio seguirá siendo un identificador operativo y no debe confundirse con la licencia jurídica del software.
