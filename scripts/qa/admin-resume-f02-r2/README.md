# F02 R2 QA

Run the Vitest commands in docs/reports/LANZO.ADMIN.PWA.RESUME.EXPIRY.F02.EVIDENCE.R2.md with the repository lockfile dependencies. The browser runners additionally use external Playwright through CODEX_PRIMARY_RUNTIME_NODE_MODULES and a Chromium executable through ACTOR_QA_CHROMIUM_EXECUTABLE. They only serve isolated synthetic fixtures on loopback; never use a commercial browser profile.

browser.mjs compares the merged-M01 main's exact health/lifecycle code with F02, using actual React/hook/controller/bridge/storage/policy. compatibility-browser.mjs reruns storage boundaries, explicitly preserving known LC13 FAILs. Exit zero in that collector means no harness errors, not that all security properties passed. The lifecycle collector fails on an unexpected candidate failure; its main expiry FAILs are the reproduced defect.

Evidence is losslessly gzip-compressed. Originals, normalized comparator inputs, commands, limits and SHA-256 manifest are preserved. No QA entrypoint or synthetic credential provider is imported into the commercial build. No financial E2E, physical sleep/hibernation, production login or device registration is claimed. Merge is not authorized.
