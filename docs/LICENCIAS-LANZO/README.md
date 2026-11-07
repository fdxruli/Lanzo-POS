# LICENCIAS-LANZO

**Referencia central:** documentación operativa para emitir licencias manualmente y propuesta diferida del generador administrativo **independiente** de LANZO-POS.

**Estado:** documentación archivada; scripts SQL para operador. **No ejecutar directamente sin revisar los parámetros y las condiciones de Production.** La creación manual Free del script `01` no tiene QA extremo a extremo confirmado para una licencia nueva. No incluye alta comercial PRO/Nube.

## Acceso rápido

| Archivo | Uso | ¿Escribe en Supabase Production? |
| --- | --- | --- |
| [Manual de operación](00_LEEME_OPERACION.md) | Procedimiento completo, precauciones y recuperación | No |
| [00 — Precheck](00_PRECHECK_SOLO_LECTURA.sql) | Verificar proyecto, permisos y plan Free | No |
| [01 — Crear licencia Free](01_CREAR_LICENCIA_FREE_SIN_DISPOSITIVO.sql) | Licencia, período y perfil sin propietario ni dispositivo | **Sí** |
| [02 — Código inicial](02_EMITIR_CODIGO_PRIMER_INGRESO.sql) | Emitir invitación de 24 horas y un solo uso | **Sí** |
| [03 — Verificar estado](03_VERIFICAR_ESTADO.sql) | Entitlement, propietario, dispositivo, invitación y sesión | No |
| [04 — Revocar código](04_REVOCAR_CODIGO_PENDIENTE.sql) | Invalidar invitación pendiente | **Sí** |
| [05 — Buscar por folio](05_BUSCAR_LICENCIA_POR_FOLIO.sql) | Evitar alta duplicada después de respuesta perdida | No |
| [Generador independiente — pendiente](FASE3_GENERADOR_INDEPENDIENTE_PENDIENTE.md) | Diseño para una implementación futura separada del POS | No |

### Orden cuando llegue un cliente Free

1. Leer el manual y ejecutar `00`.
2. Completar correctamente datos, folio y rubro en `01`; solicitar autorización de emisión comercial antes de ejecutarlo.
3. Comprobar el resultado con `03`. Si la respuesta de `01` se perdió, consultar antes `05` para evitar duplicados.
4. Cuando el propietario esté listo, emitir el código con `02`. **No conservar el código en Git ni compartirlo públicamente.**
5. El propietario introduce licencia y código en LANZO-POS, crea sus propias credenciales y registra su dispositivo.
6. Confirmar con `03` que hay un propietario y un dispositivo activos y una invitación consumida.

### Límites de uso

- Estos SQL están orientados al proyecto actual de Supabase Production; **no son migraciones** ni se deben ejecutar con `db push`.
- El repositorio puede ser público: no subir datos reales de clientes, códigos emitidos, contraseñas, tokens ni claves privilegiadas.
- El script Free no representa un alta PRO/Nube. Para PRO preparar y verificar un procedimiento comercial diferente.
- Actualizar este manual cuando cambien el esquema, el plan o las reglas de emisión.

**Actualizado inicialmente:** 2026-11-07.
