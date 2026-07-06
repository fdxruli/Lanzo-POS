# FASE AI.HISTORY.LOCAL.1 — Historial local de análisis IA por dispositivo

## 1. Resumen de la fase

Se agregó historial local para los análisis generados por los Agentes IA. Al terminar un análisis exitoso, el resultado final se guarda automáticamente en IndexedDB/Dexie en el dispositivo actual para que el usuario pueda consultarlo después aunque cambie de sección, cierre la web o vuelva más tarde.

La fase es estrictamente frontend/local: no agrega tablas, RPCs, migraciones, Edge Functions ni consumo adicional de Supabase.

## 2. Archivos modificados

- `src/components/dashboard/AIAgentDashboard.jsx`
- `src/components/dashboard/AIAgentStructuredResult.jsx`
- `src/components/dashboard/AIAgentHistoryPanel.jsx`
- `src/components/dashboard/AIAgentHistoryPanel.css`
- `src/services/aiAnalysisLocalHistoryService.js`
- `reports/ai_history_local_1_report.md`

## 3. Store local agregado

Se agregó un store Dexie local para historial IA:

- DB local: `DB_NAME + "_ai_history"`.
- Store: `ai_analysis_history`.
- Índices:
  - `id`
  - `agentType`
  - `generatedAt`
  - `status`
  - `[status+generatedAt]`
  - `[agentType+status+generatedAt]`

El historial vive solo en IndexedDB del dispositivo/navegador actual. No usa `localStorage` para guardar análisis.

## 4. Servicio creado

Se creó `src/services/aiAnalysisLocalHistoryService.js` con estas funciones:

- `saveLocalAIAnalysis(...)`
- `getLocalAIAnalysisHistory(...)`
- `getLocalAIAnalysisDetail(id)`
- `archiveLocalAIAnalysis(id)`
- `deleteLocalAIAnalysis(id)`

El servicio normaliza registros incompletos, genera IDs locales seguros, formatea fecha en español México, infiere formato de resultado y genera un resumen corto sin mostrar JSON crudo en las tarjetas.

## 5. Flujo de guardado automático

Después de `analyzeWithAI(...)` exitoso:

1. El resultado se mantiene visible con `setAnalysisResult(response)`.
2. Se guarda automáticamente en IndexedDB/Dexie.
3. Se guarda solo metadata ligera:
   - agente,
   - rango analizado,
   - fecha exacta,
   - resultado final,
   - resumen corto,
   - rubros normalizados,
   - resumen de herramientas internas usadas.
4. Si el guardado falla, el análisis generado sigue visible y se muestra aviso no bloqueante.

No se guardan prompts completos, payloads crudos, ventas completas, clientes completos ni productos completos.

## 6. Flujo de apertura sin consumo IA

La sección “Análisis guardados en este dispositivo” permite abrir un análisis guardado localmente.

Abrir un análisis guardado:

- no llama a `analyzeWithAI`,
- no ejecuta generación nueva,
- no consume consulta IA,
- no requiere consultar Supabase,
- renderiza el resultado con `StructuredAnalysisResult`.

El detalle muestra que el análisis corresponde a los datos disponibles cuando fue generado.

## 7. Flujo de archivado

El botón “Archivar” realiza archivo lógico:

- cambia `status` a `archived`,
- llena `archivedAt`,
- actualiza `updatedAt`,
- oculta el registro de la lista principal.

La eliminación física queda disponible mediante `deleteLocalAIAnalysis(id)`, pero la UI principal usa archivado para evitar borrados accidentales.

## 8. Limitaciones conocidas

- El historial existe solo en el dispositivo/navegador actual.
- Si el usuario limpia datos del navegador, reinstala la PWA o borra IndexedDB, el historial se pierde.
- No sincroniza entre dispositivos.
- No se guarda en Supabase.
- No modifica el límite PRO ni el consumo de consultas IA.
- FREE sigue sin obtener acceso nuevo a Agentes IA; esta fase solo conserva localmente análisis ya generados donde el flujo IA esté permitido.

## 9. Pruebas manuales recomendadas

1. Generar análisis PRO y verificar que aparezca el mensaje “Análisis guardado en este dispositivo.”
2. Confirmar que la tarjeta aparece en “Análisis guardados en este dispositivo” con agente, rango, fecha y resumen.
3. Cambiar de sección y volver; abrir el análisis guardado.
4. Cerrar y abrir la web/PWA en el mismo navegador; confirmar persistencia.
5. Cambiar agente/período; confirmar que el historial no se borra.
6. Abrir análisis guardado y confirmar que no se llama `analyzeWithAI` ni se consume consulta IA.
7. Simular límite agotado; confirmar que no permite generar nuevo análisis, pero sí abrir guardados.
8. Archivar un análisis; confirmar que desaparece de la lista principal.
9. Probar en móvil/PWA; confirmar tarjetas legibles, botones grandes y render estructurado sin JSON crudo.
10. Simular error de IndexedDB; confirmar que el análisis recién generado sigue visible y solo aparece aviso de guardado fallido.
