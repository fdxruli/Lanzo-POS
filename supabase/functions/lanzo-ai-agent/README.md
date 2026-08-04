# `lanzo-ai-agent`

Edge Function server-side que conserva el contrato usado por `src/services/aiService.js`.
No guarda prompts, respuestas ni tokens de autenticación.

## Operaciones

`POST` con `Content-Type: application/json`.

```json
{
  "action": "usage",
  "auth": {
    "licenseKey": "...",
    "deviceFingerprint": "...",
    "deviceSecurityToken": "...",
    "staffSessionToken": null
  }
}
```

`usage` llama únicamente a `get_ai_agent_usage`. No requiere configuración del proveedor de IA.

```json
{
  "auth": {
    "licenseKey": "...",
    "deviceFingerprint": "...",
    "deviceSecurityToken": "...",
    "staffSessionToken": null
  },
  "agentType": "inventoryAuditor",
  "systemPrompt": "...",
  "userPrompt": "...",
  "options": { "temperature": 0.2, "maxTokens": 2048 }
}
```

El análisis valida la solicitud y la configuración, reserva con `begin_ai_agent_analysis`,
llama una vez al proveedor, y finaliza la reserva exactamente una vez con
`complete_ai_agent_analysis`, como `completed` o `failed`.

## Límites y proveedor

- Body máximo: 256 KiB.
- `systemPrompt`: 32.000 caracteres máximo.
- `userPrompt`: 96.000 caracteres máximo.
- Prompts combinados: 128.000 caracteres máximo.
- `temperature`: número finito entre 0 y 2; default `0.2`.
- `maxTokens`: entero entre 1 y 4.096; default `2048`.
- Timeout del proveedor: 55 segundos.
- Respuesta del proveedor: 512 KiB máximo.
- Tipos permitidos: `inventoryAuditor`, `financialAnalyst`, `customerStrategist` y `unknown`.

`AI_API_URL` debe ser la URL HTTP completa de `/responses` o `/chat/completions`.
No se adivinan formatos para endpoints desconocidos. El cuerpo enviado contiene sólo
modelo, prompts, opciones validadas y `stream: false`.

`AI_API_KEY` tiene prioridad. `OPENAI_API_KEY` sólo se usa como fallback cuando la primera
no está definida. Las claves y `SUPABASE_SERVICE_ROLE_KEY` se leen únicamente desde
`Deno.env`; nunca se aceptan desde el request.

El cliente Supabase server-side usa el endpoint RPC REST con sesión persistente y refresh
automático desactivados. Las RPC están fijadas en el código; el cliente no puede elegir
una RPC arbitraria.

## Validación

Las pruebas de `index.test.ts` usan mocks de RPC, reloj, request ID, fetch y variables de
entorno. No usan Docker, Supabase remoto ni un proveedor real.
