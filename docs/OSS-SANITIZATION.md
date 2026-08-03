# OSS.1.3 — Saneamiento del árbol actual

## 1. Objetivo

OSS.1.3 audita y sanea únicamente el árbol actual de `fdxruli/Lanzo-POS` para
reducir rutas locales, datos operativos, referencias a entornos de trabajo y
artefactos regenerables antes de la formalización open source.

Esta tarea no reescribe el historial de Git.

## 2. Alcance

Se revisaron archivos versionados de documentación, reportes, pruebas, scripts,
configuración y nombres de artefactos. Se excluyeron `.git/`,
`node_modules/`, `dist/`, `coverage/` y artefactos generados no versionados.

No se modificaron `README.md`, Supabase remoto, Vercel, variables de entorno,
despliegues, migraciones remotas, RLS, licencias, ecommerce ni reglas
comerciales.

## 3. Base auditada

| Elemento | Resultado |
| --- | --- |
| Repositorio | `fdxruli/Lanzo-POS` |
| Base esperada | `c40f69ea9e572f586b26b76ba291ccc76778c955` |
| Base utilizada | `c40f69ea9e572f586b26b76ba291ccc76778c955` |
| Rama de trabajo | `chore/oss-current-tree-sanitization` |
| Estado inicial | Worktree limpio; sin merge, rebase o cherry-pick pendiente |
| PR #166 | El respaldo operativo retirado no existe en el árbol actual |

`git fetch origin --prune` confirmó que `origin/main` coincide con la base
esperada. La rama remota autorizada no existía antes de comenzar.

## 4. Categorías revisadas

- rutas absolutas de Windows, temporales, sesiones de Codex y referencias al
  equipo del maintainer;
- nombres de negocios, slugs, contactos, teléfonos, direcciones y fixtures;
- referencias de Supabase y Vercel, URLs de producción, previews y artefactos;
- respaldos, exports, dumps, logs, capturas y `store/dist` generado;
- fixtures y pruebas de ecommerce, checkout, tracking y migraciones;
- documentación y reportes existentes en `main`, excepto `README.md`;
- correo de soporte utilizado por la aplicación.

## 5. Cambios realizados

### Rutas y documentación

Se reemplazaron rutas absolutas de Windows, temporales de Codex y
worktrees locales en los reportes auditados por `<repo-root>`, `<temp-dir>`,
`<source-image>` o rutas relativas. `design-qa.md` ahora describe capturas
generadas localmente sin persistir rutas personales.

### Fixtures y datos de evidencia

Se reemplazó la identidad del portal real usada como fixture de render social y
de navegación PWA por `demo-store` / `Negocio de Ejemplo`. También se
generalizaron los nombres y referencias locales de productos en los reportes
de evidencia correspondientes. La semántica de las pruebas —render, imágenes,
navegación y aislamiento— permanece igual.

### Artefactos

Se eliminaron 40 archivos generados y no necesarios para el producto:

- 28 capturas PNG de `artifacts/`;
- 2 capturas de navegador de `docs/reports/ecom-public-arch-0/`;
- 10 archivos de `store/dist/`.

`.gitignore` ahora contiene patrones específicos para `artifacts/*.png` y las
capturas del reporte de arquitectura. El patrón existente para respaldos
operativos se conservó.

### Respaldo de PR #166

El respaldo antiguo no fue recuperado ni reintroducido. Se confirmó que no
existe ningún `src/RESPALDO_LANZO_*.jsonl` ni `RESPALDO_LANZO_*.jsonl` en el
árbol actual.

## 6. Elementos conservados deliberadamente

- `README.md`, sin cambios, por la modernización pendiente en
  `docs/oss-foundation-readme`.
- La marca pública `Entre Alas`, que explica el origen deliberadamente
  publicado del proyecto y no incluye datos privados.
- Las URLs oficiales de producción de Lanzo y los identificadores de proyecto
  usados por scripts de despliegue, porque son configuración pública necesaria
  para mantener separados los destinos administrativo y storefront.
- La funcionalidad de respaldos, sus componentes y pruebas; “backup” en esos
  archivos es una capacidad del producto, no un respaldo operativo encontrado.
- Fixtures UUID, `license_id`, claves anon públicas y valores de idempotencia
  ya clasificados previamente como fixtures o falsos positivos.

## 7. Falsos positivos

- `<fixture-home>\...` en pruebas es una ruta neutral, determinista y no
  vinculada al equipo del maintainer.
- `supabase.co`, `vercel.app`, URLs públicas y claves anon de Supabase no se
  trataron automáticamente como secretos.
- Teléfonos, licencias, UUID y folios presentes en pruebas con nombres como
  `fixture`, `Cliente prueba` o `Cliente QA` se clasificaron como fixtures
  deterministas; no se encontró evidencia de que correspondan a operaciones
  reales.
- Los nombres de componentes de diagnóstico y backup pertenecen al producto y
  no son artefactos operativos por sí mismos.

## 8. Decisiones diferidas

- `VITE_SUPPORT_EMAIL` y su fallback se conservaron porque el correo participa
  actualmente en el flujo de soporte. Cambiarlo requiere confirmar una
  dirección oficial alternativa y valorar el impacto para usuarios reales.
- Las migraciones correctivas que apuntan a un portal de producción y la prueba
  de consistencia asociada se conservaron para no alterar una reparación,
  contrato o evidencia operativa. Generalizarlas requiere una decisión sobre
  reproducibilidad de migraciones históricas.
- Reportes históricos aún contienen algunos identificadores de proyectos,
  deployments y previews de Vercel/Supabase. No son credenciales activas, pero
  forman parte de la trazabilidad técnica de esos reportes; una redacción
  completa requiere una revisión documental independiente.

## 9. Riesgo histórico residual

OSS.1.3 sanea solamente el árbol actual. No reescribe el historial de Git. El
respaldo operativo antiguo continúa en commits históricos, y la limpieza
histórica se realizará como tarea independiente. No se ejecutaron
`git filter-repo`, BFG, force push ni eliminación de tags o ramas.

## 10. Relación con OSS.1.1

OSS.1.1 ya validó previamente la ausencia de secretos activos en el árbol y el
historial remoto, clasificó los JWT anon de Supabase y los fixtures, y confirmó
la revocación de la clave Gemini antigua. OSS.1.3 no repite TruffleHog ni
Gitleaks y no recupera credenciales revocadas.

## 11. Validaciones ejecutadas

- `git fetch origin --prune` y confirmación de `origin/main`.
- Confirmación de repositorio, rama, worktree limpio y ausencia de la rama
  remota de destino antes de crearla.
- Búsquedas dirigidas de rutas personales, nombres locales, respaldos,
  artefactos, datos de negocio e identificadores de infraestructura.
- `git diff --check`.
- `npx vitest run src/pwa/__tests__/adminUpgradeBridge.test.js` — 4/4 PASS.
- `npx vitest run store/tests/social-preview/storeOgRender.test.js --pool=forks --maxWorkers=1` — 7/7 PASS.
- `npx eslint scripts/audit-vercel-build-output.mjs src/pwa/__tests__/adminUpgradeBridge.test.js store/tests/social-preview/storeOgRender.test.js` — PASS.
- Confirmación de que no se creó `LICENSE`, no se modificaron workflows,
  licencias, ecommerce, RLS, Supabase, Vercel, precios, planes ni despliegues.

No se ejecutaron builds ni suites globales porque el saneamiento productivo es
documental, de fixtures y de artefactos; las pruebas focalizadas cubren los dos
fixtures modificados.

## 12. Estado final

**PASS — árbol actual saneado y listo para revisión humana.**

El resultado se publicará mediante un único commit en
`chore/oss-current-tree-sanitization`. No se abrirá Pull Request en esta
ejecución.
