# OSS release boundary

OSS.1.4.4 defines a deterministic, source-only candidate export. The official
repository and its production build remain unchanged; the candidate is a
generated copy under `.oss-release/lanzo-pos-oss` and is not tracked by Git.

## Authority and restricted assets

The machine-readable authority is
`scripts/oss/restricted-assets.manifest.json`. It contains the nine baseline
SHA-256 values, the five `omit` paths, the four `replace` paths, required
consumers, placeholder policy, identity rules and allowlist. The pipeline never
reads the restricted list from Markdown.

The five omitted paths are `icono/icono.png`, `public/icono.png`,
`icono/icono-web.png`, `public/icono-web.png` and `public/log.svg`. The four
same-path replacements are `public/pwa-192x192.png`, `public/pwa-512x512.png`,
`public/logIcon.svg` and `public/boticon.svg`.

## Commands

From the repository root:

```text
npm run oss:release:prepare
npm run oss:release:audit -- --output-root .oss-release/lanzo-pos-oss
```

The administrative candidate build uses the existing Vite installation from the
repository while keeping its output outside the source candidate:

```text
node node_modules/vite/bin/vite.js build --config vite.config.js --outDir ..\admin-build --emptyOutDir
node node_modules/vite/bin/vite.js build --config vite.store.config.js --outDir ..\store-build --emptyOutDir
npm run oss:release:verify -- --output-root .oss-release/lanzo-pos-oss --admin-build .oss-release/admin-build --store-build .oss-release/store-build
```

For reproducibility, prepare two authorized directories and compare their
relative paths, sizes and SHA-256 values:

```text
npm run oss:release:prepare -- --output-root .oss-release/run-a
npm run oss:release:prepare -- --output-root .oss-release/run-b
npm run oss:release:verify -- --output-root .oss-release/run-a --admin-build .oss-release/admin-build --store-build .oss-release/store-build --compare-root-a .oss-release/run-a --compare-root-b .oss-release/run-b
```

The generated `OSS_RELEASE_BOUNDARY.json` is timestamp-free and records the
omissions, replacement hashes, exact identity transformations, allowlist and
audit result. `REBRANDING_REQUIRED.md` explains that placeholders are neutral,
that forks need their own identity and that the candidate must not be presented
as official Lanzo-POS software.

## Fail-closed checks

Prepare rejects a changed baseline, unsafe or traversing output paths, unsafe
tracked symlinks and secret-like tracked paths. It copies only `git ls-files
-z`, then generates deterministic SVG/PNG placeholders with `sharp`. It never
modifies `src`, `store`, `index.html`, official assets or production
configuration.

Audit verifies omitted paths, replacement dimensions and hashes, exact official
byte absence, C2PA marker absence, PWA icon resolution, favicons, precache
source references, AssistantBot resolution, secret paths, PR #171 markers and
identity classification. Unknown runtime-visible identity references and
unexpected transformation counts fail the run.

The administrative build must resolve `manifest.webmanifest`, both PWA icons,
`logIcon.svg` and `sw.js`. The store build must resolve its generated favicon
and contain neutral visible identity. Neither build is a substitute for the
source-export audit.

## Scope and legal boundary

The placeholders are classified `NEUTRAL EXPORT PLACEHOLDER - NOT OFFICIAL
BRAND`; they are geometric, neutral, deterministic and contain no C2PA or
external material. Compatibility identifiers, tests and historical
documentation remain only through explicit allowlist entries.

This task does not create `LICENSE`, does not activate AGPL, does not publish a
release or artifact, does not deploy, and does not grant permission over the
official assets. `BRAND_ASSETS.md` remains the record of the reserved identity.
This document is not legal advice.
