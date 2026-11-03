# Restaurante: paquete backend Archive + Bridge v1

## Alcance y evidencia

Paquete independiente del frontend de #352, basado en main
`56a5274d1dba79a19978bb0c3a6c535c0962a19e`. No activa Admin ni contrato v2.

| Orden | Migración | SHA-256 de los bytes SQL |
|---|---|---|
| 1 | `20261101235323_repair_pos_sync_archive_operation_contract.sql` | `9e89b368be660dd31a975a5afd87082944bb0601f045c33be6e134476e2cf5ab` |
| 2 | `20261102065554_restaurant_cloud_transition_bridge_v1.sql` | `555c718c18da25e0fb6d7ed02ff68f16f04129530707ff7f9b81ab4534e9c97f` |

Archive conserva las 18 operaciones y admite `archive`. Bridge conserva el cuerpo
validado, incluyendo compatibilidad Staff/legacy, discovery, capabilities, upsert
versionado y contrato 1. Su nuevo nombre se generó con `supabase migration new`
de CLI 2.79.0; el comentario histórico del cuerpo se preservó por identidad.
3D.14 es dependencia previa, con blob Git
`e1ab62ed387a3da7798d03d46e2c0723d12526a8`, sin modificaciones.

Se reutiliza [R6.41, intento 1](https://github.com/fdxruli/Lanzo-POS/actions/runs/41381445439):
PostgreSQL 17.6 (`170006`), instalación/rollback de estos cuerpos exactos,
Archive auténtico y replay, Staff, Admin OFF, Cocina A–H, clientes y pruebas
secuenciales financieras. No equivale a integración Productiva completa. La
continuación F1 falló en un lookup del harness (`legacy_idempotency_key`);
F1 completo/F2/C1–C6 no se certifican aquí. No se modifica ese harness.

## Historial: recuperación privada, sin replay

`docs/fixtures/restaurant-backend-release.json` fija el baseline Productivo:
333 versiones, última `20261026214837`, y un SHA-256 agregado sobre cada versión,
nombre, tamaño y hash del SQL serializado por CLI 2.79.0. Se contrastó mediante
SELECT de metadatos, sin recuperar datos comerciales. El manifiesto enumera
las 14 versiones remotas sin archivo y fija los blobs de las tres exclusiones:

- 3D.1 antiguo, aplicado realmente como `20261006224032`.
- 3D.13 antiguo, aplicado realmente como `20261008030859`.
- `20261008180000_create_legal_policy_previews.sql`, exclusivo de Preview.

No se cambia el ledger ni se declara reconstruible desde cero el historial QA.
No se incorporan sus sentencias a Git. La ruta explícita
`restaurant_backend_v1` adapta el overlay privado ya existente en R5:

1. Recupera las migraciones aplicadas con `migration fetch --linked` en un
   directorio temporal privado del runner. La operación es de lectura.
2. Verifica íntegramente inventario y hashes contra el baseline fijado. Rechaza
   migraciones desconocidas, drift, candidatos alterados o exclusiones distintas.
3. Copia solamente las dos migraciones nuevas, con sus bytes exactos.
4. Ejecuta el guard canónico existente, sin modificarlo: solo esas dos versiones
   pueden quedar pendientes. Antes de APPLY vuelve a verificar snapshot y ledger.
5. Elimina SQL histórico y metadatos de conexión siempre, sin subir artefactos.

Las 333 versiones recuperadas son **ya aplicadas** y no se ejecutan de nuevo.
Los archivos antiguos y Preview del checkout nunca entran en el directorio de
despliegue. El modo `canonical` por defecto mantiene el rechazo original de drift;
no es la ruta de instalación de este paquete.

Comportamiento verificado en el código oficial fijado de CLI 2.79.0:
[fetch](https://github.com/supabase/cli/blob/v2.79.0/internal/migration/fetch/fetch.go),
[selección de pendientes](https://github.com/supabase/cli/blob/v2.79.0/internal/migration/up/up.go),
[dry-run y push](https://github.com/supabase/cli/blob/v2.79.0/internal/db/push/push.go).
No se usan `--include-all`, `migration repair`, seeds ni roles.

## Secuencia para el propietario: autorizaciones pendientes

1. Revisar/publicar esta rama backend y autorizar su integración a main por separado
   del frontend. No contiene cambios de aplicación ni activa despliegues SQL al
   hacer merge: el workflow es exclusivamente `workflow_dispatch`.
2. Conservar la candidata frontend reducida
   `f8d8086a1e1f54cebbe062d3172f1a7f61f8261f`. No desplegarla en Production antes
   del backend. Un rebuild del frontend actual por cambios de main no añade las RPC.
3. Autorizar DRY_RUN del workflow `Canonical Supabase Production Migrations` desde
   main con su **nuevo SHA exacto**, `release_package=restaurant_backend_v1`,
   `mode=DRY_RUN`,
   `expected_versions=20261101235323,20261102065554`.
4. Revisar que la selección contiene exclusivamente esos dos archivos, en ese orden,
   sin histórico pendiente ni Preview. Si cambia main o el ledger, detenerse.
5. Autorizar separadamente APPLY con el mismo SHA/paquete/versiones y confirmación
   literal `APPLY 20261101235323,20261102065554`. El workflow vuelve a verificar
   proyecto, SHA, baseline, hashes, dry-run y conjunto exacto antes de instalar.
6. Comprobar por lectura: ledger con ambas versiones, CHECK validado de 19
   operaciones, RPC discovery/capabilities/upsert presentes, contrato 1 sin pausa,
   supervisión Admin desactivada, y metadatos ACL/RLS esperados. No hacer pruebas
   comerciales de escritura en Production.
7. Publicar la candidata frontend reducida en #352 mediante una autorización propia,
   conservar la historia, revisar Preview Vercel con Staff/legacy/versionado y Admin
   OFF y resolver los checks/revisión de release pendientes. Solo entonces solicitar
   autorización de merge de #352. Activar Admin queda fuera de este release.

## Fallo y recuperación

Las dos migraciones no constituyen una transacción única. Archive puede quedar
instalada aunque falle Bridge. En ese caso detenerse, inspeccionar catálogo y
ledger mediante lectura y revisar una actualización del baseline/selección antes
de cualquier reintento. No reparar ledger, repetir automáticamente ni aplicar
todo lo pendiente del checkout. Si ambas terminan, el guard posterior exige las
335 versiones sin pendientes. La ruta fijada a 333 rechazará nuevos intentos:
un despliegue posterior requiere su propio baseline revisado.

Ante fallo de instalación, conservar la protección transaccional de cada cuerpo
aceptado y verificar el estado efectivo antes de decidir recuperación. No prometer
atomicidad conjunta ni borrar objetos/datos como rollback automático.

## Validación local R6.42

- Node: contratos del overlay R5 adaptados y del guard canónico; positivos, drift,
  hashes, exclusiones, pendientes desconocidas/v2 y verificación previa a APPLY.
- Identidades SQL aceptadas comprobadas byte a byte; histórico 3D.14 intacto.
- CLI 2.79.0 oficial verificada por checksum y utilizada para generar la versión.
- Actionlint 1.7.12, sintaxis Bash, YAML, `node --check`, `git diff --check` y escaneo focal.
- No nueva ejecución PostgreSQL ni dry-run contra Production en esta fase. Se
  reutiliza la instalación real de los mismos cuerpos de R6.41; la nueva ruta de
  despliegue tiene pruebas Node, no se etiqueta `CLI_ISOLATED_PASS`.

Preparado para solicitar autorización de publicación e instalación; este documento
no autoriza ninguna escritura remota ni certifica Production ya modificada.
