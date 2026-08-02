# Contribuir a Lanzo-POS

Gracias por considerar una contribución a Lanzo-POS. Las aportaciones bien delimitadas, revisables y verificables ayudan a mejorar la calidad del proyecto y a preparar una futura apertura formal.

## Contribuciones aceptadas

Son bienvenidas, entre otras:

- correcciones de bugs;
- mejoras de documentación;
- accesibilidad;
- pruebas y validaciones;
- traducciones;
- mejoras funcionales o técnicas;
- reportes de seguridad enviados mediante un canal privado conforme a `SECURITY.md`.

Antes de comenzar, busca issues y pull requests existentes para evitar trabajo duplicado. Para cambios arquitectónicos, contratos públicos, modelos de datos o modificaciones amplias, abre primero una propuesta que describa el problema, las alternativas y el impacto esperado.

## Flujo de trabajo recomendado

1. Trabaja en una rama independiente y limitada a un objetivo.
2. Mantén commits claros, coherentes y fáciles de revisar.
3. Incluye las pruebas, validaciones y documentación correspondientes.
4. Explica el comportamiento anterior, el cambio realizado, el impacto y los riesgos.
5. Indica si utilizaste herramientas de inteligencia artificial para ayudar a generar código, pruebas, documentación, diseños o análisis.
6. Revisa, prueba y comprende personalmente todo el contenido enviado.

El uso de IA no sustituye la responsabilidad humana. Quien envía el cambio debe verificar que sea correcto, seguro, mantenible, compatible con el proyecto y que no incorpore contenido sin autorización.

## Datos y materiales prohibidos

No incluyas en commits, issues, pull requests, pruebas, fixtures, capturas ni documentación:

- secretos, tokens o credenciales;
- datos reales de clientes;
- claves de negocio o identificadores operativos sensibles;
- dumps de bases de datos;
- archivos de entorno con valores reales;
- capturas con información privada;
- información obtenida de sistemas de terceros sin autorización.

Utiliza datos sintéticos, redactados y claramente ficticios.

## Arquitectura y persistencia

Lanzo-POS sigue una arquitectura offline-first. Los cambios deben preservar el funcionamiento local, la recuperación ante desconexiones y la coherencia entre almacenamiento local y servicios administrados.

Ten especial cuidado con:

- Dexie e IndexedDB, especialmente cambios de versión, claves primarias y rutas de migración;
- migraciones y políticas de Supabase;
- RLS, Storage y Edge Functions;
- sincronización, idempotencia, reintentos y resolución de conflictos;
- compatibilidad entre Lanzo Local, Lanzo Nube y la tienda pública.

Todo cambio en contratos, RPC, esquemas, eventos, payloads, tablas, índices o políticas debe documentar:

- compatibilidad hacia atrás;
- orden de despliegue o migración;
- impacto offline y online;
- estrategia de rollback o recuperación;
- validaciones ejecutadas.

No inventes procedimientos operativos ni comandos de infraestructura que no hayan sido verificados.

## Procedencia y derecho a contribuir

Al enviar contenido, declaras de forma preliminar que tienes derecho a aportarlo y que no estás incorporando código, documentación, diseños, datos o activos sujetos a restricciones incompatibles. Debes poder explicar la procedencia del material cuando sea necesario.

Se prevé adoptar un Developer Certificate of Origin (DCO) en una fase posterior. El DCO todavía no se exige automáticamente, no existe un archivo DCO en esta fase y no hay workflows que validen `Signed-off-by`.

## Estado de licenciamiento

`AGPL-3.0-only` es la licencia prevista, pero todavía no está vigente. No existe un archivo `LICENSE`; por ello, el repositorio permanece bajo los derechos aplicables por defecto y esta guía no concede nuevos permisos jurídicos. La clave permanente del negocio identifica al tenant y no es la licencia jurídica del código.
