# Lifecycle Pro → Free

## Estados y autoridad

La licencia define el plan y sus capacidades. La identidad del propietario es independiente de cualquier dispositivo. Un login válido del propietario en un equipo retirado puede recibir `FREE_DEVICE_TAKEOVER_REQUIRED`; la autoridad sólo cambia después de la confirmación explícita y de completar el bootstrap.

Una licencia PRO activa conserva sus capacidades y el límite PRO. Al expirar, sigue en `grace_period` hasta el fin canónico de gracia. El materializador no debe cambiar el plan antes de esa frontera. Después, el cambio a Free ajusta el límite de dispositivos, desactiva los excedentes de manera determinística, invalida sus tokens y revoca sus sesiones Admin y Staff. Retry del materializador y del takeover debe conservar un único resultado coherente.

Un Free creado directamente no tiene evidencia de downgrade y no obtiene el flujo de recuperación. Bloqueos administrativos, licencias suspendidas o revocadas tampoco son una recuperación Free.

## Cajas y operación local

El downgrade de plan no cierra cajas ni borra su historial. Una caja histórica sólo entra al bridge si la licencia actual es Free, existe una transición canónica desde un plan con Cloud Cash, la caja quedó abierta antes de esa transición y conserva evidencia canónica de apertura. El propietario actual y su sesión activa son necesarios para consultar y reconciliar.

El bridge histórico sirve para una conciliación humana explícita; no vuelve a habilitar `cloud_cash_sync`. Sólo el cierre confirmado modifica el estado financiero. La consulta del bridge informa el POS Local y no debe estar en el camino crítico de ventas locales. Offline con una lectura previa conserva el último conteo conocido; offline sin snapshot permanece desconocido, nunca cero.

## Ciclos, sesiones y runtime

Cada ciclo usa su transición y evidencia de downgrade actuales. Upgrade a PRO desactiva el bridge y restaura la superficie Cloud Cash normal; no reactiva dispositivos ni usuarios Staff antiguos automáticamente. Un segundo downgrade produce evidencia propia y no reutiliza el takeover anterior.

El runtime frontend aísla el conteo y el resultado transitorio de takeover por licencia y propietario. Logout, cambio de licencia/actor y respuestas tardías no pueden contaminar el scope nuevo. Sólo una respuesta válida del scope actual actualiza el snapshot; valores ausentes o inconsistentes permanecen como error/unknown.

## Regresiones y diagnóstico

La fixture integrada, completamente reversible, está en `supabase/tests/license_pro_to_free_lifecycle_final_r1_test.sql`. Los casos focales previos siguen siendo la fuente detallada para expiración, pruning, autorización y conciliación.

El script de solo lectura `scripts/supabase/license-pro-to-free-lifecycle-diagnostic.sql` reconstruye plan, lifecycle, dispositivos, sesiones obsoletas, cajas pendientes y auditoría de conciliaciones para una licencia elegida. Reemplaza el UUID centinela antes de ejecutarlo. No consulta Gary por nombre ni devuelve tokens, contraseñas o fingerprints.
