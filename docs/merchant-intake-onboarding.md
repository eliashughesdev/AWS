# Merchant Intake Onboarding — Fase 1

Traza del estado del sistema desde que la plataforma del merchant manda el request hasta
que devolvemos el token de claim. Dos almacenes se siguen en cada paso: el user pool de
Cognito y `v2CustomerTable`. Todo lo que está acá es lo que el código hace hoy, no lo que
va a hacer.

| | |
|---|---|
| Endpoint | `POST /v1/accounts/onboarding` |
| Autenticación | `Signature` HMAC + header `X-Project` |
| Rol requerido | `admin` (lo da el camino de firma del authorizer) |
| Clave de idempotencia | `transaction.id` |
| Escrituras | 1 transacción, 4 items |

## El contrato

```json
{
  "externalId": "usr_9f3a2b",
  "firstName": "Juan",
  "lastName": "Perez",
  "email": "juan@example.com",
  "merchantId": "mrc_test_01",
  "transaction": {
    "id": "txn_abc123",
    "amount": 50.00,
    "currency": "EUR",
    "paidAt": "2026-09-09T10:22:31Z"
  }
}
```

`externalId` es el id del pagador **dentro de la plataforma que llama**, no el id del
merchant. El merchant es una entidad aparte que viaja como campo de la transacción.

## La traza

### 0. Antes del request

El pagador no existe para nosotros. La tarjeta ya fue cobrada en la plataforma del
merchant; ese dinero está allá, no acá.

| Cognito | v2CustomerTable |
|---|---|
| sin usuario para ese email | sin registros para ese externalId |

### 1. La plataforma del merchant firma el body y hace el POST

Manda el contrato de arriba. El header `X-Project` lleva el id de su API key;
`Authorization` lleva `Signature <timestamp>:<bodyHash>:<firma>`.

Sin cambios en ningún almacén.

### 2. API Gateway → `custom-authorizer-fn`

`/accounts/*` es un proxy con authorizer CUSTOM y `resultsCacheTtl: 0`, así que el
authorizer corre en **cada** llamada. Lee la key de `v1UserKeysTable` por el `X-Project`,
recalcula el HMAC-SHA256 sobre `path + timestamp + bodyHash` y compara. El timestamp tiene
que estar dentro de 10 segundos.

Si pasa, devuelve un policy Allow con `context = { userId: <id de la key>, role: 'admin' }`.
Ese `userId` es lo que el handler usa como `platform`.

**Si falla:** API Gateway responde 403 y el Lambda nunca arranca. No se escribe nada, no se
crea nada, no queda ni un log del handler.

Sin cambios en ningún almacén.

### 3. `mainApiFn` → `router.ts`

`loadConfig()` baja los parámetros de SSM a `process.env` (cacheado 60 s). El router busca
la ruta, chequea el método, aplica RBAC — `allowedRoles: ['admin']` contra el `role` del
authorizer — y valida que los params de primer nivel estén presentes y no sean falsy.

**Consecuencia del RBAC:** un usuario final autenticado con JWT llega con `role: 'user'` y
recibe 403 acá. Solo una key B2B firmada alcanza el handler.

Sin cambios en ningún almacén.

### 4. `OnboardingHandler` valida lo que el router no ve

El validador del router es solo de primer nivel, así que el handler chequea
`transaction.id`, que `transaction.amount` sea `number` y que `transaction.currency`
exista. El email pasa por un regex que además excluye comillas y backslashes, porque
después se interpola en el filtro de `ListUsers`.

Sin cambios en ningún almacén.

### 5. Una sola lectura decide todo el flujo

`queryRecord` busca la clave exacta `EXT#<platform>#<externalId>` con `sk = MAPPING`. Es un
lookup por clave primaria: sin GSI, sin scan, costo constante. Si aparece, el pagador ya
existe y no se toca Cognito. Si no, arranca la creación.

**Por qué la clave lleva el `platform`:** prefijar el `externalId` con el id de la API key
lo hace único sin exigir que sea único globalmente, y deja que el mismo pagador
comprándole a dos merchants de la misma plataforma sea un solo usuario NODA.

Sin cambios — es una lectura.

### 6. Se resuelve la identidad del pagador nuevo

Primero `ListUsers` filtrando por email, y hay tres desenlaces:

- **No existe** → `AdminCreateUser` con `MessageAction: SUPPRESS` (Cognito no manda su
  propio mail de contraseña temporal) y `email_verified: false`. Nosotros no elegimos
  ninguna contraseña, así que el usuario queda en `FORCE_CHANGE_PASSWORD`. Después
  `AdminAddUserToGroup(user)`.
- **Existe y tiene `USERPROFILE`** → ese email pertenece a otra persona. 400 con
  `error_code 100032` y no se escribe nada.
- **Existe y no tiene `USERPROFILE`** → es un huérfano de un intento anterior que falló
  después del `AdminCreateUser`. Se adopta el `sub` existente; si no, ese pagador nunca más
  podría registrarse.

**La única ventana donde los dos almacenes no coinciden.** Entre este paso y el siguiente
el usuario existe en Cognito pero no en Dynamo. Si el Lambda muere justo acá queda un
huérfano — y es exactamente el caso que la rama de adopción resuelve en el reintento.

| Cognito | v2CustomerTable |
|---|---|
| username = email (el pool usa `usernameAttributes`)<br>status = `FORCE_CHANGE_PASSWORD`<br>`email_verified` = false<br>grupo: `user` | todavía vacío |

### 7. Se genera el token de claim

32 bytes aleatorios en base64url, más su `sha256` y un `expiresAt` a 7 días. Se persiste
**solo el hash**: la tabla tiene stream activo y el stream handler loguea el registro
completo, así que un token en claro terminaría en CloudWatch.

**Decisión de diseño:** el `externalId` no autoriza nada. Viaja en el email, en el checkout
y en los logs, así que no es un secreto. Lo que autoriza fijar la contraseña es este token,
de un solo uso y con vencimiento.

Sin cambios — el token vive en memoria.

### 8. Cuatro registros, una transacción

Un solo `TransactWriteItems`, con `attribute_not_exists(id)` en los dos que no pueden
duplicarse. Si cualquiera falla no se escribe ninguno.

| `id` | `sk` | Contenido |
|---|---|---|
| `TXN#<platform>#<txId>` | `IDEMPOTENCY` | `status: RECEIVED`, amount, currency — condicional |
| `<cognitoSub>` | `USERPROFILE` | firstName, lastName, name, `kyc: null`, `tier: unverified` |
| `EXT#<platform>#<externalId>` | `MAPPING` | userId — condicional |
| `CLAIM#<sha256>` | `CLAIM` | userId, expiresAt, `usedAt: null` |

**Si la transacción se cancela:** significa que el `transaction.id` o el mapping ya
existían, o sea es una reentrega, no un error. El handler relee el registro de idempotencia
y devuelve 200 con `replayed: true` en vez de un 500, para que la plataforma deje de
reintentar.

### 9. El token cruza el cable una sola vez

201 con `userId`, `isNew: true`, `claimToken` y `claimExpiresAt`. Ese es el único momento en
que el token en claro existe fuera de la memoria del Lambda: la plataforma del merchant lo
recibe para poder armar el link al final del checkout.

## Los cinco desenlaces

| Entrada | HTTP | Cognito | v2CustomerTable | Body |
|---|---|---|---|---|
| Pagador nuevo | 201 | 1 usuario creado | 4 items | `isNew: true` + `claimToken` |
| Pagador ya conocido | 200 | sin tocar | 1 item (`IDEMPOTENCY`) | `isNew: false` |
| Reentrega del mismo `transaction.id` | 200 | sin tocar | nada | `replayed: true` |
| Email de otro usuario | 400 | sin tocar | nada | `error_code 100032` |
| Firma inválida o vencida | 403 | sin tocar | nada | el Lambda no corre |

## Lo que todavía no es cierto

Con la fase 1 deployada y el 201 devuelto, nada de esto existe. Es la parte más importante
del documento: marca exactamente dónde arrancan las fases 2, 3 y 4.

- **El usuario no puede entrar.** Está en `FORCE_CHANGE_PASSWORD` y nadie conoce ninguna
  contraseña, ni él ni nosotros.
- **No se mandó ningún email.** El token existe pero solo lo tiene la plataforma del
  merchant, en la respuesta HTTP.
- **No hay cuenta.** Sin virtual account en Tatum, sin key en KMS, sin deposit address, sin
  suscripción de webhook.
- **No hay balance.** Ni una fila en `v1AccountBalanceTable`.
- **No hay transacciones visibles.** `v1TransactionLogsTable` está vacía para este usuario,
  y `/accounts/transactions` le devolvería `100001`.
- **La plata no se movió.** El monto quedó anotado en el registro de idempotencia con
  `status: 'RECEIVED'` y nada más. Ningún asiento, ninguna conversión, ninguna
  transferencia al merchant.
- **El gate de KYC está escrito pero no aplicado.** `tier: 'unverified'` y `kyc: null`
  quedan en el perfil; todavía no hay ruta que los chequee.

## Lo que encontré y no toqué

**El authorizer nunca verifica que el `bodyHash` corresponda al body**
(`amplify/fn/authorizer/handler.js`). El hash entra en el string que se firma, pero nadie lo
recalcula contra el payload recibido. Una firma válida sirve para cualquier body durante los
10 segundos de la ventana. En este endpoint el body lleva el email y el monto. Arreglarlo
rompe a todos los clientes actuales, así que es una decisión aparte.

**Todo `/webhook/*` corre sin authorizer** (`amplify/backend.ts`, línea del
`webhooksPath.addProxy`). El proxy se agrega sin `proxyAuthOptions`: el authorizer no es que
deje pasar, es que no se ejecuta. Por eso la ruta de intake vive bajo `/accounts/`. Vale
dejarlo anotado para que nadie la mueva "porque es un webhook".

**`processError` tira excepción con códigos no definidos** (`amplify/errors/http.ts`). Hace
`httpErrors[code](params)` sin chequear. Los códigos `100002`, `100004` y `100030` se usan
en rutas existentes pero nunca se definieron, así que salen como 500 genéricos en vez del
400 con mensaje. Se definió `100003` porque el onboarding lo usa; los otros tres siguen
abiertos.

**Reentrega concurrente exacta.** Dos requests idénticos en paralelo: el segundo pierde con
`UsernameExistsException` de Cognito y sale como 500. Se resuelve en el reintento, que ya
encuentra el mapping. Nunca se crean dos usuarios ni se acredita dos veces — el invariante
se sostiene, la respuesta es fea.

## Qué cambió

| Archivo | | Qué |
|---|---|---|
| `amplify/service/routes/accounts/onboarding.ts` | nuevo | El handler: validación, branch, identidad, transacción, replay. |
| `amplify/utils/claimToken.ts` | nuevo | Generar y hashear el token de un solo uso. |
| `amplify/utils/cognito.ts` | nuevo | `ListUsers`, `AdminCreateUser` con SUPPRESS, `AdminAddUserToGroup`. |
| `amplify/service/routes/e2e/accounts/AccountsOnboardingTest.ts` | nuevo | Firma con la key `e2e-hmac` que ya existe. |
| `amplify/utils/db.ts` | modificado | `transactWriteItems` ahora acepta `conditionExpression` por item, descarta undefined y devuelve el error. Sin esto la idempotencia no era atómica. |
| `amplify/backend.ts` | modificado | `COGNITO_USER_POOL_ID` en `mainApiFn` (no lo tenía) y permisos `cognito-idp` acotados al ARN del pool, no a `*`. |
| `amplify/service/router.ts` | modificado | La ruta, con `allowedRoles: ['admin']`. |
| `amplify/errors/http.ts` | modificado | Códigos 100003, 100031, 100032, 100033. |
| `package.json` | modificado | `@aws-sdk/client-cognito-identity-provider`. |

**Antes de probar:** la ruta no puede funcionar sin deploy — `COGNITO_USER_POOL_ID` y los
permisos de Cognito se agregan en `backend.ts`, así que hace falta un
`ampx pipeline-deploy`. Después, `AccountsOnboardingTest.ts` corrido dos veces seguidas
verifica el camino nuevo y el replay con el mismo `transaction.id`.

## Dónde sigue

Fase 1 de 4. La 2 es el claim de contraseña (endpoint público + vista `/v2/set-password`),
la 3 el email, la 4 el dinero — crédito, conversión a USDT y transferencia al merchant, que
es la que sigue esperando respuestas del cliente sobre de qué cuenta sale el asiento.
