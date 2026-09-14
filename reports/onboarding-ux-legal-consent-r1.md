# Onboarding UX + legal consent R1

## Alcance

Ajuste posterior al PR #289 para clarificar el flujo visual sin cambiar el orden de seguridad.

### Flujo nueva licencia

1. Tu negocio
2. Giro del Negocio
3. Tu acceso como propietario
4. Todo listo

El paso 3 usa `Continuar`: crea la identidad propietaria y obtiene ActorRuntime. No guarda todavía el perfil del negocio ni registra aceptación legal.

El paso 4 muestra el resumen de negocio/giro/acceso y el aviso legal. `Crear negocio` registra la aceptación de la versión vigente de Términos y Condiciones y, sólo después, guarda el perfil.

### Navegación

- Se eliminan botones `Atrás` de los pasos 2 y 3.
- Las secciones completas se reabren desde los encabezados del acordeón.
- `Cambiar licencia` queda fuera de las secciones del onboarding, como acción secundaria inferior.
- El enrollment standalone de una licencia existente conserva su CTA `Crear cuenta propietaria` y su acción de cambio de licencia.

## Invariantes

- No persistir perfil antes de ActorRuntime Admin autenticado.
- No registrar aceptación legal antes del CTA final `Crear negocio`.
- Si el guardado final falla, conservar el propietario autenticado y el draft para reintento idempotente.
- Sin migraciones ni cambios Supabase.
- Sin cambios Caja/Ventas/Ecommerce.
