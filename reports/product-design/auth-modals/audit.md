# Auditoría Product Design — modales de acceso Admin / Staff

## 1. Revisión estructural previa

1. Admin y Staff tenían jerarquías distintas: Admin vivía sobre `AdminAuthModal.css`, mientras Staff usaba una pantalla completa independiente con `StaffLoginModal.css`.
2. La acción secundaria `Cambiar licencia` abandonaba todo el flujo; no había una salida contextual para corregir una elección de perfil.
3. El layout anterior no compartía una estrategia mobile-first: el modal Staff no tenía el mismo tratamiento de overlay, superficie, espaciado ni comportamiento responsive que Admin.
4. Los mensajes de estado de la selección se heredaban dentro del login, mezclando contexto de navegación con errores o avisos de autenticación.

## 2. Decisiones aplicadas

1. Se unificó la composición visual: indicador de paso, perfil activo, icono de seguridad, título, explicación, formulario y acciones finales.
2. Mobile-first: ambos accesos comienzan como bottom sheet con área segura, altura contenida, scroll interno, campos táctiles y botones de ancho completo.
3. Desktop: el sheet pasa a diálogo centrado, compacto y con acciones secundarias alineadas en una sola fila.
4. Se añadió `Elegir otro perfil` como acción contextual y discreta. Sólo aparece cuando la licencia ofrece ambos perfiles.
5. Se añadió `returnToLicenseAccessChoice` al flujo de licencia y se limpian los mensajes de selección al abrir Admin o Staff.

## 3. Evidencia visual

- [Admin desktop](./01-admin-desktop.png)
- [Admin mobile](./02-admin-mobile.png)
- [Staff desktop](./03-staff-desktop.png)
- [Staff mobile](./04-staff-mobile.png)
- [Retorno a selección de perfil](./05-back-to-profile-selection.png)

## 4. Validación

- `AdminAuthModals.test.jsx`: 7 tests passing.
- ESLint: sin errores; queda un aviso existente de actualización de `baseline-browser-mapping`.
- Vite build: completó la generación (`✓ built in 2m 58s`). Los avisos restantes son warnings preexistentes de imports dinámicos/estáticos.

## 5. Ajuste posterior — contexto de licencia

Se reemplazó el bloque de licencia del pie Staff por una tarjeta contextual reutilizable en la parte superior de Admin y Staff. La selección de perfil ahora también muestra licencia, producto/plan y el nombre del negocio cuando el perfil está disponible.

- [Selección desktop con contexto](./06-chooser-context-desktop.png)
- [Selección mobile con contexto](./07-chooser-context-mobile.png)
- [Admin mobile con licencia arriba](./08-admin-context-mobile.png)
- [Staff mobile sin colisión de acciones](./09-staff-context-mobile.png)
- [Selección mobile con negocio cargado](./10-chooser-business-loaded-mobile.png)

La tarjeta ya no interpreta un perfil aún no cargado como configuración pendiente. La pantalla consulta el perfil asociado a la licencia sin cambiar `appStatus`; si existe, muestra el nombre real del negocio.

También se añadió el control de visibilidad de contraseña en ambos accesos:

- [Admin con contraseña visible](./11-admin-password-visible-mobile.png)
- [Staff con contraseña visible](./12-staff-password-visible-mobile.png)

Finalmente, el layout desktop usa un diálogo más ancho y distribuye Usuario/Contraseña en dos columnas; móvil conserva el flujo apilado:

- [Admin desktop compacto](./15-admin-desktop-compact.png)
- [Staff desktop compacto](./16-staff-desktop-compact.png)
- [Staff mobile responsive](./17-staff-mobile-responsive.png)
