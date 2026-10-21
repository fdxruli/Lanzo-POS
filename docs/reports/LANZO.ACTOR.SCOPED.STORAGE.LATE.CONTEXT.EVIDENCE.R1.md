# Evidencia — mini-fase 3.2A.1

Datos de fixtures aislados; sin datos de negocio. Salidas reales de esta ejecución.

## Baseline EXP-F02-14

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

 RUN  v4.0.14 /workspace/scratch/786fcf99182f/Lanzo-POS

stdout | src/services/auth/__tests__/actorLateContext.integration.test.js > late actor-context integration — reconstructed EXP-F02-14 only > EXP-F02-14 / LC-01 / LC-09 / LC-20: preserves the later legitimate Admin grant after an obsolete storage notification
EXP-F02-14 {"before":{"status":"granted","actorType":"admin","actorId":"admin-a","actorKey":"admin:admin-a","sessionId":"session-b","permissions":["*"],"tenant":{"opaqueId":"t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","databaseName":"LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","generation":1},"deviceRef":"device-a","authorizationExpiresAt":1790812810000,"generation":6,"reason":"authenticated_session_granted"},"after":{"status":"locked","actorType":null,"actorId":null,"actorKey":null,"sessionId":null,"permissions":[],"tenant":null,"deviceRef":null,"authorizationExpiresAt":null,"generation":7,"reason":"actor_context_changed_in_other_tab"},"durableNewRecordPreserved":true,"writesSuspended":true}

 ❯ src/services/auth/__tests__/actorLateContext.integration.test.js (1 test | 1 failed) 23ms
     × EXP-F02-14 / LC-01 / LC-09 / LC-20: preserves the later legitimate Admin grant after an obsolete storage notification 22ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/services/auth/__tests__/actorLateContext.integration.test.js > late actor-context integration — reconstructed EXP-F02-14 only > EXP-F02-14 / LC-01 / LC-09 / LC-20: preserves the later legitimate Admin grant after an obsolete storage notification
AssertionError: expected { status: 'locked', …(10) } to deeply equal { status: 'granted', …(10) }

- Expected
+ Received

  {
-   "actorId": "admin-a",
-   "actorKey": "admin:admin-a",
-   "actorType": "admin",
-   "authorizationExpiresAt": 1790812810000,
-   "deviceRef": "device-a",
-   "generation": 6,
-   "permissions": [
-     "*",
-   ],
-   "reason": "authenticated_session_granted",
-   "sessionId": "session-b",
-   "status": "granted",
-   "tenant": {
-     "databaseName": "LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
-     "generation": 1,
-     "opaqueId": "t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
-   },
+   "actorId": null,
+   "actorKey": null,
+   "actorType": null,
+   "authorizationExpiresAt": null,
+   "deviceRef": null,
+   "generation": 7,
+   "permissions": [],
+   "reason": "actor_context_changed_in_other_tab",
+   "sessionId": null,
+   "status": "locked",
+   "tenant": null,
  }

 ❯ src/services/auth/__tests__/actorLateContext.integration.test.js:104:19
    102|     expect(() => oldRuntime.assertCurrent()).toThrow();
    103|     expect(() => oldStorage.assertCurrent()).toThrow();
    104|     expect(after).toEqual(granted);
       |                   ^
    105|     expect(getActorScopedStorageState().writesSuspended).toBe(false);
    106|     expect(() => newRuntime.assertCurrent()).not.toThrow();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed (1)
   Start at  03:34:00
   Duration  860ms (transform 179ms, setup 89ms, import 183ms, tests 23ms, environment 421ms)


```

## Checkpoint focal

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

 RUN  v4.0.14 /workspace/scratch/786fcf99182f/Lanzo-POS

 ✓ src/services/auth/__tests__/actorScopedStorage.test.js (10 tests) 17ms
stdout | src/services/auth/__tests__/actorLateContext.integration.test.js > late actor-context integration — reconstructed EXP-F02-14 only > EXP-F02-14 / LC-01 / LC-09 / LC-20: preserves the later legitimate Admin grant after an obsolete storage notification
EXP-F02-14 {"before":{"status":"granted","actorType":"admin","actorId":"admin-a","actorKey":"admin:admin-a","sessionId":"session-b","permissions":["*"],"tenant":{"opaqueId":"t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","databaseName":"LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","generation":1},"deviceRef":"device-a","authorizationExpiresAt":1790812810000,"generation":6,"reason":"authenticated_session_granted"},"after":{"status":"granted","actorType":"admin","actorId":"admin-a","actorKey":"admin:admin-a","sessionId":"session-b","permissions":["*"],"tenant":{"opaqueId":"t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","databaseName":"LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","generation":1},"deviceRef":"device-a","authorizationExpiresAt":1790812810000,"generation":6,"reason":"authenticated_session_granted"},"durableNewRecordPreserved":true,"writesSuspended":false}

 ✓ src/services/auth/__tests__/actorLateContext.integration.test.js (1 test) 14ms

 Test Files  2 passed (2)
      Tests  11 passed (11)
   Start at  03:37:50
   Duration  1.53s (transform 200ms, setup 147ms, import 219ms, tests 31ms, environment 851ms)


```

## Chromium

Runner termina con exit code 1: LC13 permanece rojo. Generaciones 1 de A y B intencionalmente iguales; no se consideran reloj global. Las pruebas de StorageEvent son entrega sintética; LC13 usa dos documentos reales y localStorage real.

```json
{
  "chromium": "143.0.7499.0",
  "base": "f48aab53634663438a06dc5187fa7e6d17b74fb3",
  "results": [
    {
      "case": "stale-event-baseline",
      "writesSuspended": true,
      "durablePreserved": true,
      "status": "FAIL"
    },
    {
      "case": "stale-event-candidate",
      "writesSuspended": false,
      "durablePreserved": true,
      "status": "PASS"
    },
    {
      "case": "LC-13-baseline-A-baseline-B",
      "deniedOld": true,
      "durableBPreserved": false,
      "handleCurrent": false,
      "durableStatus": "locked",
      "status": "FAIL"
    },
    {
      "case": "LC-13-candidate-A-candidate-B",
      "deniedOld": true,
      "durableBPreserved": false,
      "handleCurrent": false,
      "durableStatus": "locked",
      "status": "FAIL"
    },
    {
      "case": "LC-13-baseline-A-candidate-B",
      "deniedOld": true,
      "durableBPreserved": false,
      "handleCurrent": false,
      "durableStatus": "locked",
      "status": "FAIL"
    }
  ]
}

```
