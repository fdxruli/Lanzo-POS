# LANZO — Futuro generador administrativo de licencias (proyecto independiente)

**Estado: DIFERIDO. NO IMPLEMENTAR TODAVÍA.** Última definición: 2026-11-07.

## Decisión de producto

El generador no será una pantalla dentro de LANZO-POS. Será una **herramienta interna separada**, accesible únicamente para el propietario/operadores autorizados de LANZO. Mientras no exista, se utilizará el runbook y los scripts de emisión manual del paquete para **Free/Local**, y se elaborará un procedimiento PRO concreto antes de emitir comercialmente ese plan.

## Resultado que debe entregar cuando se autorice

1. Operador con identidad fuerte y permisos de emisión inicia sesión en la herramienta interna.
2. Completa solicitud: nombre de negocio, rubro, plan, folio/cliente, contacto opcional y período **solo para planes de pago**.
3. El backend administrativo verifica autorización, idempotencia y reglas comerciales; crea una licencia SIN dueño ni dispositivo. Nunca ejecuta SQL libre desde el navegador.
4. Emite opcionalmente una invitación de un solo uso para primera configuración (24 horas o política actual) mediante el contrato ya instalado. El operador puede aplazar la invitación hasta cuando el cliente tenga el dispositivo disponible.
5. Muestra los datos entregables y mantiene un registro operativo sin contraseñas, códigos ya consumidos, tokens de dispositivo/sesión ni secretos.
6. El cliente abre LANZO-POS (app principal), ingresa licencia + invitación, crea por sí mismo propietario y contraseña y registra su primer dispositivo.
7. Operador puede consultar estado, reemitir/revocar invitaciones pendientes y ver si la licencia ya fue reclamada; **nunca** puede reemitir inscripción inicial cuando existe propietario.

## Separación de sistemas

- **LANZO-POS:** frontend cliente, inscripción y autenticación normales; no tendrá interfaz administrativa de generación.
- **Generador independiente:** interfaz interna de gestión, autenticación de operadores y backend propio.
- **Supabase Production LANZO:** fuente de verdad actual de licencias, planes, períodos, perfiles, propietarios, dispositivos e invitaciones. Se reutilizan los contratos existentes; nunca duplicar una segunda base de licencias inconsistente.
- **Credenciales privilegiadas:** únicamente en entorno de servidor confiable; jamás en bundle de navegador. MFA/controles de roles para operadores, auditoría de emisión y revocación y protección frente a reintentos.

## Entrega incremental sugerida (futura, previa autorización)

**Entrega A — Generación Free:** crear una licencia de duración indefinida con perfil y período vigentes, sin dueño ni dispositivo, y poder emitir/revocar una invitación. Prueba: crear negocio real de prueba desde herramienta y completar alta en Android en Production; cero duplicados ante repetición del folio. Evitar nueva infraestructura o esquemas si puede reutilizarse la lógica actual con una función administrativa mínima restringida.

**Entrega B — PRO/Nube:** solo tras revisar contrato comercial exacto (plan `pro_monthly`, períodos pagados, fecha de caducidad, límite de dispositivos, entitlements, cobros/autorización). Prueba: alta de licencia pagada por período contratado, registro de propietario y vencimiento/renovación correctos. No tratar una licencia Free como PRO simplemente cambiando la etiqueta.

No añadir masivos, facturación, correo/WhatsApp automático, CRM ni paneles extensos en el primer incremento.

## Condiciones de seguridad no negociables

- La clave de licencia por sí sola **no** acredita a un propietario.
- Invitaciones de un uso, alta atómica y no reutilizable; operador no conoce ni establece contraseñas.
- Derecho comercial y límites verificados en servidor; cambios Free/PRO nunca solamente desde la interfaz.
- No exponer `service_role` ni secretos administrativos, ni RPC heredadas con secreto fijo; no usar `public.admin_create_license` como API del generador.
- Sin acceso público al esquema `private`; revocación y emisión solo por autoridad autenticada.
- Folio de orden idempotente y auditoría de operador para evitar licencias duplicadas.
- Política de instalación: migraciones autorizadas directamente en Supabase Production, QA del cliente en Vercel Preview/Production según aprobación; archivo canónico con versión/hash trazable en Git/main; no `db push` general.
- No merge, despliegue productivo, migración ni activación comercial sin orden explícita del propietario de LANZO.

## Regla de parada

Si se necesita rehacer toda la autenticación o construir un segundo motor comercial, detener el proyecto y presentar la mínima solución y alternativa de posponer. Probar un caso real cuanto antes. Un solo objetivo por incremento y sin PR adicionales sin autorización.

## Referencias técnicas verificadas a 2026-11-07

- PR LANZO-POS #413: `https://github.com/fdxruli/Lanzo-POS/pull/413`, integrado en commit `e7fe3566073de56286f21ccaf82bf788b18f643c`.
- Migración onboarding `20261107152500`, SHA-256 `97c30551b5c8ed88675333585a9fd3471714c70a7b4a0043fdaede0c232d69aa`.
- `private.issue_license_onboarding_invitation(text)`, `private.revoke_license_onboarding_invitation(text)`, `public.admin_enroll_owner_with_invitation(...)`.
- `public.create_free_license_unlimited` añade dispositivo inmediatamente; NO es emisión administrativa sin dispositivo.
- Plan Free vigente `free_trial`; plan PRO vigente `pro_monthly`; función administrativa heredada `public.admin_create_license` no es apta para el panel.
