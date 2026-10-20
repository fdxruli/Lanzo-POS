# About Free: QA visual aislado

Este fixture monta `AboutPage` y `Navbar` reales con sus estilos y un negocio
sintético. Los aliases reemplazan el store, actor, respaldos y runtimes remotos.
No se monta `Layout` con sus efectos operativos, no hay credenciales y no se
concede autorización en la aplicación POS. La configuración normal de Vite no
importa este fixture.

Desde la raíz:

```powershell
node node_modules/vite/bin/vite.js --config scripts/qa/about-free/vite.config.mjs
```

Abrir `http://127.0.0.1:5178/`, o `/?theme=dark`. Build independiente:

```powershell
node node_modules/vite/bin/vite.js build --config scripts/qa/about-free/vite.config.mjs
python -m http.server 5180 --bind 127.0.0.1 --directory .tmp-about-free-preview
```

El build se guarda en un directorio temporal ignorado. Los flujos reales de
autorización/offline y el zoom del navegador deben revisarse además en el Preview
con una licencia de QA del propietario. La versión `v0.0.0 (local)` de las
capturas corresponde al fixture, que no inyecta las variables del build POS.

En esta sesión el navegador integrado cargó el HTML pero no ejecutó los módulos
locales. Para capturar se sirvió **el mismo bundle compilado** como script
clásico `defer` en el HTML temporal. No se modificó el bundle ni el build POS.
Un navegador normal puede usar los comandos anteriores sin ese ajuste.
