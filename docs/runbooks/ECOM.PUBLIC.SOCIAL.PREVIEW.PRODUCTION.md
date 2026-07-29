# ECOM.PUBLIC.SOCIAL.PREVIEW — Despliegue productivo

Este runbook se ejecuta únicamente en
`ECOM.PUBLIC.SOCIAL.PREVIEW.1.9`, después de una autorización humana explícita.
La minifase 1.8 sólo prepara un manifiesto saneado
`READY_FOR_MANUAL_APPROVAL`; no autoriza ni ejecuta producción.

## Precondiciones

- PR aprobado y todavía sin cambios posteriores a la aprobación.
- Evidencia real `ECOM.PUBLIC.SOCIAL.PREVIEW.1.7 = PASS`.
- Gate `ECOM.PUBLIC.SOCIAL.PREVIEW.1.8 = READY_FOR_MANUAL_APPROVAL`.
- `PR127 Global Comparison` del HEAD aprobado concluido en `success`.
- Ninguna migración ni modificación de Supabase.
- Producción confirmada como no modificada durante 1.7 y 1.8.
- Aprobación humana explícita para iniciar 1.9.

## Artefacto productivo

El artefacto productivo se construye desde `main` después del merge. No se
reutiliza el prebuilt de la rama del PR ni su preview.

```text
git switch main
git pull --ff-only
npm ci --no-audit --no-fund
npx vitest run store/tests/social-preview
npx vitest run src/architecture/__tests__/publicBuildArchitecture.test.js
npx vitest run src/architecture/__tests__/publicGitDeploymentArchitecture.test.js
npx vitest run src/architecture/__tests__/vercelPrebuiltDeployment.test.js
npm run build:store:vercel
```

Después se genera un prebuilt nuevo desde ese `main` y se repite su auditoría
antes de cualquier operación productiva.

## Proyecto y autorización

Verificar de forma explícita:

```text
projectName = lanzo-store
```

`lanzo-pos` es un proyecto separado y nunca se utiliza para este despliegue.
La 1.8 no autoriza ni ejecuta `vercel deploy --prod`, `vercel promote` o
`vercel alias`; esas operaciones quedan reservadas para 1.9 y requieren la
instrucción explícita del usuario.

## Smoke test posterior

Comprobar en el deployment productivo de 1.9:

- tienda válida, metadata única, canonical e imagen OG;
- imagen PNG y políticas de caché;
- ruta de tracking y `noindex`;
- assets estáticos y funciones esperadas;
- tienda inexistente y slug inválido;
- ausencia de datos privados, código administrativo y secretos;
- consola, respuestas HTTP y logs saneados de las funciones.

Una comprobación crítica fallida bloquea la conclusión de 1.9.

## Rollback

Conservar la referencia del deployment productivo estable anterior y no
eliminarlo antes de terminar el smoke test. Si falla una comprobación crítica,
restaurar ese deployment estable según el procedimiento autorizado de 1.9 y
repetir toda la auditoría posterior. El rollback de esta iniciativa no modifica
Supabase ni crea o revierte migraciones.
