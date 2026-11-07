# Recuperación administrativa asistida — referencia V1

El **manual vigente** para soporte es
[soporte-recuperacion-cuentas.md](soporte-recuperacion-cuentas.md). Contiene búsqueda,
diagnóstico, árbol de decisiones A–I, scripts operativos, errores y mensajes modelo.

## Estado histórico confirmado

El PR #407 se fusionó con `c29855a6ae288d5175a36f9900ee1f0fcf570105`.
La migración `20261106201326_admin_support_account_recovery_v1.sql` está instalada
según ledger de Production consultado durante V2. El propietario confirmó el
recorrido de vinculación, recuperación de usuario/contraseña, rechazo de contraseña
anterior, login nuevo, revocación y conservación de datos/permisos con El Balón.

Esto reemplaza las antiguas notas que todavía indicaban instalación/QA V1 pendientes.
No repetir esa migración. El estado de V2 se registra separadamente en
[LANZO_ACCOUNT_RECOVERY_V2_PRODUCTION_INSTALL_REPORT.md](LANZO_ACCOUNT_RECOVERY_V2_PRODUCTION_INSTALL_REPORT.md).
V2 está instalada con autorización y hash canónico; su QA manual sigue pendiente.
El reporte de preparación V2 se conserva como antecedente histórico.

## Contratos conservados

- `admin_request_recovery_contact`: primera vinculación, sesión propietaria y contraseña.
- `admin_confirm_recovery_contact`: código entregado manualmente, misma sesión original.
- `admin_recovery_contact_status`: contacto y solicitud; V2 agrega `pending_change`.
- `support_issue_admin_recovery_code`: emisor privado SQL; contraseña solo al contacto verificado.
- `admin_redeem_password_recovery`: usuario original, nueva contraseña y revocación atómica.

V1 no reemplaza contactos. V2 incorpora ese procedimiento mediante expedientes,
congelación de recuperaciones normales mientras haya caso activo y controles humanos.
No se cambian identidad, dispositivos, planes, permisos Staff ni datos Dexie.

## Pruebas reproducibles

Con PostgreSQL 17 local y `psql`:

```sh
RECOVERY_TEST_PGURL=postgresql://postgres@127.0.0.1:55432/postgres \
  node --test scripts/supabase/admin-support-recovery.node-test.mjs
```

El runner rechaza hosts remotos y crea/elimina solo una base temporal local.
Carga dependencias desde migraciones canónicas, V1 y V2. El fixture delimita tablas
comerciales/entitlement y no sustituye el QA manual en Preview conectado a Production.
