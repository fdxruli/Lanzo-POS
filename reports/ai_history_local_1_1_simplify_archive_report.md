# FASE AI.HISTORY.LOCAL.1.1 — Simplificar historial IA y retirar botón Archivar

## 1. Problema detectado

Durante pruebas reales, el botón **“Archivar”** del historial local de análisis IA generaba confusión.

El usuario podía interpretar “Archivar” como una acción necesaria para guardar el análisis, cuando el comportamiento real era marcar el registro con `status: 'archived'` y ocultarlo de la lista principal.

Para esta fase no se necesita archivado, restauración ni vista de archivados. El objetivo del flujo debe ser más simple: el análisis se guarda automáticamente y el usuario solo lo consulta cuando lo necesite.

## 2. Decisión

Se retiró el archivado de la UI por ahora.

El servicio local conserva las funciones existentes de archivado/eliminación por compatibilidad, pero el usuario ya no ve botones de archivado en:

- tarjetas del historial,
- detalle del análisis guardado.

## 3. Archivos modificados

- `src/components/dashboard/AIAgentHistoryPanel.jsx`
- `src/components/dashboard/AIAgentHistoryPanel.css`
- `src/components/dashboard/AIAgentDashboard.jsx`
- `reports/ai_history_local_1_1_simplify_archive_report.md`

## 4. Resultado

El historial local ahora comunica explícitamente que el guardado es automático:

- El panel indica que los análisis se guardan automáticamente en este dispositivo.
- Cada tarjeta muestra badge **“Guardado automáticamente”**.
- Cada tarjeta mantiene una sola acción principal: **“Ver análisis”**.
- El detalle mantiene:
  - **“Volver al historial”**,
  - **“Generar nuevo análisis con datos actuales”**.
- El detalle ya no muestra **“Archivar análisis”**.
- El detalle aclara que consultar el análisis no consume consulta IA y que está guardado automáticamente en este dispositivo.

## 5. Compatibilidad y almacenamiento

Se mantiene el almacenamiento local en IndexedDB/Dexie.

No se modificó:

- Supabase,
- Edge Functions,
- RPCs,
- límite IA,
- planes FREE/PRO,
- flujo de consumo IA,
- servicio local de historial salvo su uso desde la UI.

Abrir un análisis guardado sigue sin llamar a `analyzeWithAI` y sin consumir consulta IA.

## 6. Limitaciones

- No hay vista de archivados.
- Análisis previamente archivados siguen ocultos de la lista principal.
- No se eliminan datos archivados existentes.
- No se implementa restauración de archivados.
- El historial sigue siendo local por dispositivo/navegador.
- Si el usuario limpia datos del navegador, reinstala la PWA o cambia de dispositivo, el historial local puede perderse.

## 7. Pruebas manuales recomendadas

### 1. Generar análisis IA

Resultado esperado:

- Se genera análisis.
- Se muestra en pantalla.
- Aparece mensaje: `Análisis guardado en este dispositivo.`
- Aparece tarjeta en historial.
- La tarjeta muestra agente, rango, fecha, resumen, badge `Guardado automáticamente` y botón `Ver análisis`.
- No aparece botón `Archivar`.

### 2. Cambiar de sección y volver

Resultado esperado:

- El análisis guardado sigue visible.
- Se puede abrir con `Ver análisis`.

### 3. Cerrar y abrir web/PWA

Resultado esperado:

- El análisis sigue visible en el mismo navegador/dispositivo.

### 4. Abrir análisis guardado

Resultado esperado:

- No llama a `analyzeWithAI`.
- No consume consulta IA.
- Muestra aviso de que corresponde a los datos disponibles cuando fue generado.
- Muestra aviso de que consultarlo no consume consulta IA.
- Muestra aviso de que está guardado automáticamente en este dispositivo.

### 5. Detalle guardado

Resultado esperado:

- Muestra `Volver al historial`.
- Muestra `Generar nuevo análisis con datos actuales`.
- No muestra `Archivar análisis`.

### 6. Móvil/PWA

Resultado esperado:

- Tarjeta clara.
- Botón `Ver análisis` grande y usable.
- No hay botón secundario confuso.
- No aparece JSON crudo.

### 7. Registros archivados existentes

Resultado esperado:

- No se borran.
- No aparecen en la lista principal.
- La app no crashea si existen registros `status: 'archived'` en IndexedDB.
