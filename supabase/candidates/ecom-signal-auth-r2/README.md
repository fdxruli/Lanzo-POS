# Candidata Ecom Signal R2 — HOLD

Estos archivos NO están en `supabase/migrations` y no deben aplicarse con `db push`.
La CLI generó el identificador `20261020220455`; el SQL se retuvo aquí para impedir
desplegar una candidata que mantiene B-01/B-02/B-03 abiertos.

- Fundación: rol exclusivo, esquema privado propio, allowlist sintética, concesiones,
  verificador online canónico, helper de recepción y política SELECT delimitada.
- `public-rpc-acl-proposal.sql`: propuesta SEPARADA de seis REVOKE a PUBLIC,
  por firma exacta, conservando grants explícitos de los consumidores existentes.
  Sólo se simuló dentro de una transacción revertida. Requiere revisión específica.
- `rollback.sql`: retirada explícita sin CASCADE si alguna vez se instalara la
  fundación. No es necesario ejecutarlo ahora; no existen los objetos remotos.

Preparar la prueba (genera SQL, no conecta ni ejecuta):

```powershell
node scripts/supabase/prepare-ecom-signal-auth-r2.mjs --project-ref odlrhijtfyavryeqivaa
node scripts/supabase/prepare-ecom-signal-auth-r2.mjs --project-ref odlrhijtfyavryeqivaa --with-acl-proposal
```

Revisar el SQL resultante en `.tmp/ecom-signal-auth-r2/` y ejecutarlo íntegro contra
el único proyecto autorizado. Conservar `BEGIN`, timeouts y `ROLLBACK`. La primera
versión registra el FAIL real de PUBLIC; la segunda añade una simulación de su
corrección sin ocultar el FAIL inicial.

Los tests usan `GRANT receptor TO postgres` sólo dentro de esa transacción para
permitir SET ROLE al runner. El receptor no hereda ningún rol. Esto no certifica
cómo Hosted Realtime establece el rol, ni autoriza membresías a authenticator.

Todos los topics son `ecom:qa-probe:r2:<grant_id>` y el stage es `qa_probe`.
No hay emisor JWT, publicador, servicio cliente ni activación comercial.
La generación declarada se vincula a la concesión; no autentica hardware ni
convierte por sí misma el Actor Runtime local en una identidad del servidor.

Informe y evidencia: `docs/reports/ECOM.FREE.ORDERS.REALTIME.AUTH.PRODUCTION.R2.md`.
