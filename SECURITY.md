# Política de seguridad

## Alcance

Esta política describe cómo comunicar de manera responsable posibles vulnerabilidades relacionadas con Lanzo-POS. Cubre hallazgos que afecten:

- el código disponible en este repositorio;
- el servicio oficial administrado Lanzo Nube;
- despliegues autohospedados operados por terceros.

Estas superficies no son equivalentes. Una vulnerabilidad en el código puede no afectar a la operación oficial, y un problema de configuración en un despliegue de terceros puede no existir en Lanzo Nube. El reporte debe identificar con claridad cuál superficie está afectada.

## Cómo reportar una vulnerabilidad

No publiques en issues, discusiones, pull requests ni comentarios públicos:

- tokens, claves, credenciales o secretos;
- datos personales o información real de clientes;
- detalles explotables que permitan reproducir un ataque de forma inmediata;
- accesos, registros, capturas o archivos obtenidos de sistemas ajenos.

Cuando GitHub Security Advisories o el reporte privado de vulnerabilidades estén habilitados para el repositorio, utiliza ese canal. Es el medio preferido para compartir detalles técnicos sensibles de forma coordinada.

Si no existe un canal privado disponible, abre un issue público mínimo solicitando un canal de contacto privado. No incluyas la vulnerabilidad, evidencias sensibles, payloads, credenciales ni pasos explotables en ese issue.

No se publica un correo de seguridad en este documento y no se afirma que exista un programa de recompensas.

## Información útil para el reporte

Incluye, cuando sea posible y seguro:

- componente o superficie afectada;
- versión, rama o commit observado;
- impacto técnico y operativo estimado;
- pasos generales de reproducción, evitando datos reales y detalles que faciliten abuso inmediato;
- mitigaciones o controles compensatorios conocidos;
- indicación de si el hallazgo afecta al repositorio, a Lanzo Nube o a un despliegue autohospedado específico.

El maintainer procurará acusar recibo y evaluar el reporte dentro de una ventana razonable según su complejidad y disponibilidad. Esta política no establece ni promete un SLA ni tiempos específicos de respuesta o corrección.

## Divulgación coordinada

Se solicita mantener los detalles sensibles en privado mientras se confirma el alcance, se prepara una mitigación y se coordina una divulgación responsable. La fecha y el nivel de detalle de cualquier publicación deben acordarse considerando el riesgo para usuarios, tiendas y operadores.

No realices pruebas contra datos, tiendas, cuentas, dispositivos o infraestructura de terceros sin autorización expresa. No interrumpas servicios, no extraigas información y no intentes ampliar privilegios más allá de lo estrictamente necesario para demostrar un hallazgo en un entorno autorizado.

## Responsabilidades por superficie

### Código del repositorio

Los reportes pueden señalar defectos de implementación, configuraciones inseguras por defecto, errores en contratos, migraciones, RLS, Edge Functions, almacenamiento, autenticación o manejo de datos.

### Servicio oficial Lanzo Nube

La operación oficial incorpora configuración administrada, secretos, dominios y controles que no necesariamente están representados por completo en el repositorio. Un reporte sobre Lanzo Nube debe evitar cualquier acceso no autorizado y describir únicamente la evidencia obtenida de forma legítima.

### Despliegues autohospedados de terceros

Cada operador es responsable de su configuración, secretos, actualizaciones, respaldos, dominios y controles de acceso. El proyecto puede analizar si un problema deriva del código común, pero no garantiza soporte ni corrección de configuraciones externas.

## Estado de licenciamiento

`AGPL-3.0-only` es la licencia prevista, pero todavía no está vigente y no existe un archivo `LICENSE`. El repositorio continúa bajo los derechos aplicables por defecto. Esta política no concede nuevos permisos jurídicos. La clave permanente del negocio es un identificador operativo del tenant y no constituye la licencia jurídica del código.
