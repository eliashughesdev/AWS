# Merchant Intake Onboarding

Traza del estado del sistema desde que la plataforma del merchant manda el request hasta
que el pagador puede entrar a su cuenta.

**Estado:** fases 1 (identidad), 2 (contraseña) y 3 (email) implementadas, más la creación
de la cuenta custodial del pagador. Falta el movimiento de plata de la fase 4.

Dos almacenes se siguen en cada paso: el user pool de Cognito y `v2CustomerTable`. Todo lo
que está acá es lo que el código hace hoy, no lo que va a hacer.

## Fase 1 — El intake

| | |
|---|---|
| Endpoint | `POST /v1/accounts/onboarding` |
| Autenticación | `Signature` HMAC + header `X-Project` |
| Rol requerido | `admin` (lo da el camino de firma del authorizer) |
| Clave de idempotencia | `transaction.id` |
| Escrituras | 1 transacción: 6 items para un pagador nuevo |

## El contrato

```json
{
  "externalId": "usr_9f3a2b",
  "firstName": "Juan",
  "lastName": "Perez",
  "email": "juan@example.com",
  "merchantId": "mrc_test_01",
  "chain": "TRON",
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

### 8. Seis registros, una transacción

Un solo `TransactWriteItems`, con `attribute_not_exists(id)` en los dos que no pueden
duplicarse. Si cualquiera falla no se escribe ninguno.

| `id` | `sk` | Contenido |
|---|---|---|
| `TXN#<platform>#<txId>` | `IDEMPOTENCY` | `status: RECEIVED`, amount, currency — condicional |
| `<cognitoSub>` | `USERPROFILE` | firstName, lastName, name, `kyc: null`, `tier: unverified` |
| `EXT#<platform>#<externalId>` | `MAPPING` | userId — condicional |
| `CLAIM#<sha256>` | `CLAIM` | userId, expiresAt, `usedAt: null` |
| `<cognitoSub>` | `ACCOUNT#<accountNo>` | chain, kmsKeyId, depositAddress, vAccountId |
| `<vAccountId>` | — (`v1AccountBalanceTable`) | balance 0 |

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

Con las fases 1 a 3 deployadas y el pagador ya dentro de su cuenta, nada de esto existe.
Es la parte más importante del documento: marca exactamente dónde arranca la fase 4.

- **No hay transacciones visibles.** `v1TransactionLogsTable` está vacía para este usuario,
  así que `/accounts/transactions` devuelve una lista vacía — ya no un `100001`, porque la
  cuenta ahora existe y tiene `vAccountId`.
- **La plata no se movió.** El monto quedó anotado en el registro de idempotencia con
  `status: 'RECEIVED'` y nada más. Ningún asiento, ninguna conversión, ninguna
  transferencia al merchant.
- **El gate de KYC está escrito pero no aplicado.** `tier: 'unverified'` y `kyc: null`
  quedan en el perfil; todavía no hay ruta que los chequee.

## Fase 2 — El claim de contraseña

Dos endpoints **públicos** más una vista. El pagador llega desde el email sin sesión, sin
contraseña y sin nada que presentar salvo el token.

| | |
|---|---|
| Verificar el link | `POST /v1/onboarding/verify` |
| Fijar la contraseña | `POST /v1/onboarding/claim` |
| Pantalla | `/v2/set-password?token=…` |
| Autenticación | ninguna — el token de un solo uso es la credencial |

### Por qué no pueden vivir bajo `/accounts`

Todo `/accounts/*` exige el custom authorizer, y el pagador no tiene JWT ni API key. Así que
`backend.ts` agrega un recurso `onboarding` con `authorizationType: NONE` explícito. Es la
única pieza de infra de la fase.

`/webhook/*` también es público y habría servido sin tocar infra, pero el nombre habría
mentido sobre lo que hace la ruta.

### Por qué los dos son POST y no GET

El token es un secreto. En un GET iría en el query string, y el query string queda escrito en
el access log de API Gateway (`/aws/apigateway/LoudiblyRestApi`). En el body no.

### La traza del claim

1. `loadClaim(token)` hashea y busca `CLAIM#<sha256>`. Tres rechazos, compartidos con
   verify: no existe (`100034`), ya usado (`100036`), vencido (`100035`). Se reportan
   separados a propósito — un token de 32 bytes no es enumerable, así que no hay nada que
   esconder, y "ya se usó" contra "venció" es la diferencia entre un mensaje útil y un
   callejón sin salida.
2. **Se quema el token antes de tocar Cognito**, con un update condicional, así dos claims
   concurrentes no pueden pasar los dos. La condición es
   `attribute_not_exists(usedAt) OR attribute_type(usedAt, :nullType)`: la fase 1 escribe
   `usedAt: null`, o sea el atributo **existe** con tipo NULL, y `attribute_not_exists` solo
   nunca matchearía.
3. `AdminSetUserPassword` con `Permanent: true`. Eso además saca al usuario de
   `FORCE_CHANGE_PASSWORD` y lo deja en `CONFIRMED`, que es lo que permite un `signIn`
   normal inmediatamente después.
4. Si la contraseña no pasa la policy del pool, **se devuelve el token** (`usedAt` vuelve a
   NULL) y se responde `100037` con el mensaje de Cognito. Una contraseña débil no puede
   costarle el link al pagador.
5. `AdminUpdateUserAttributes(email_verified: true)`, no fatal. Acá se cierra la decisión de
   la fase 1 de crear el usuario con `false`: el click en el link es la prueba de que el
   pagador tiene ese email.
6. Devuelve el email, que el frontend usa para el `signIn` automático.

### La vista

`/v2/set-password` no lleva `requiresAuth`, así que el guard del router la deja pasar.

Al montar saca el token del query string y **lo borra de la barra de direcciones** con
`history.replaceState`, para que no quede en el historial ni viaje en un header `Referer`.
Después llama a verify y saluda por nombre, lo que le confirma al pagador que el link es
suyo antes de pedirle nada.

El email se muestra fijo, no editable: identifica la cuenta y el pagador no puede cambiarlo
— que era el requisito original del cliente, resuelto sin poner el `externalId` en la URL.

Al enviar: claim → `signIn` → dashboard. Si el claim falla por vencido o ya usado, la
pantalla pasa a estado muerto en vez de dejar un formulario que no va a funcionar. Si el
claim sale bien pero el `signIn` falla, redirige a `/auth` con el email precargado en vez de
dejar al pagador trabado.

### Lo que falta en la fase 2

- **No hay reenvío de link.** Si el token vence a los 7 días, la pantalla dice "pedí un link
  nuevo" pero no existe el endpoint que lo emita.
- **Los términos son texto, no links.** No hay páginas de Terms ni Privacy todavía.
- **Sin rate limit propio.** `/onboarding/*` es público y pega a DynamoDB y a Cognito. El
  token no es adivinable, así que no hay riesgo de fuerza bruta, pero tampoco hay usage plan
  ni throttle por encima del default de la cuenta.

## Fase 3 — El email de invitación

Después del commit de la transacción, y solo para pagadores nuevos, el intake manda un email
con el link `{FRONTEND_URL}/v2/set-password?token=…`.

| | |
|---|---|
| Quién lo manda | `OnboardingHandler.sendInvite`, dentro del mismo request del intake |
| Plantilla | `amplify/utils/emailTemplates.ts` → `claimInviteEmail` |
| Marca | `brandName()` — `BRAND_NAME` en SSM, sin default |
| Link | `FRONTEND_URL` en SSM + el token en claro |
| Cuándo | solo si hay claim: pagador nuevo u huérfano adoptado. Nunca en el replay ni para un pagador ya conocido |

### Por qué después del commit

Si se mandara antes, un fallo de la transacción dejaría en el inbox un link cuyo `CLAIM` no
existe.

### Por qué no es fatal, y qué es `emailSent`

Los registros ya están escritos y el token también vuelve en la respuesta, así que la
plataforma del merchant puede mostrar el link al final del checkout. Un fallo de SES no
justifica un 500: haría reintentar a la plataforma, y el reintento caería en el replay, que
no puede reenviar nada porque solo tenemos el hash del token.

La respuesta del intake suma `emailSent` (campo nuevo en el contrato). Si es `false`, la
plataforma sabe que el checkout es el único canal por el que el pagador va a ver el link.

### El nombre se escapa

`firstName` viene de la plataforma del merchant. Sin escape, cualquiera con una key B2B podría
meter un `<a href>` en un email que sale desde nuestro dominio. Todo lo que se interpola en el
HTML pasa por `escapeHtml`.

### UTF-8 explícito y multipart

`SesEmailProvider` ahora manda `Charset: 'UTF-8'` en el asunto y en los cuerpos, porque los
nombres llegan con acentos. Y manda multipart: texto plano de fallback más HTML. El parámetro
`html` es opcional, así que `account.ts` sigue llamando con texto solo sin cambios.

### El link nunca se loguea

Lleva el token en claro. `sendInvite` loguea el email del destinatario, nunca el link.

### Marca neutral en el HTML

El botón usa los mismos estilos neutros del email de confirmación de Cognito. Solo el nombre es
configurable; poner el teal de NODA acá sería hardcodear la marca otra vez.

### El test usa el simulador de SES

`AccountsOnboardingTest.ts` ahora usa `success+<stamp>@simulator.amazonses.com` en vez de
`@example.com`. Según la documentación de SES, el simulador acepta envíos aun con la cuenta en
sandbox y no cuenta para la reputación de envío; mandar a `example.com` fuera del sandbox
generaría bounces. Para ver el email de verdad: `ONBOARDING_EMAIL=<inbox verificado>`, una vez
por dirección (la segunda corrida con la misma dirección da `100032`).

### Lo que falta en la fase 3

- **SES fuera del sandbox y dominio noda.money verificado.** En sandbox solo se entrega a
  direcciones verificadas y al simulador. Es un paso de consola, no de código.
- **`SES_FROM_EMAIL` tiene que ser una identidad verificada en `us-east-2`**, la región del
  Lambda. Si no, SES rechaza el envío y `emailSent` sale `false`.
- **Sin reenvío.** Un email perdido no se recupera: el replay no tiene el token en claro. Es el
  mismo hueco de la fase 2 y ahora es el siguiente paso natural.
- **El email al merchant ("llegó la transferencia") no es de esta fase:** no hay transferencia
  hasta la fase 4.
- El email está en inglés, como el de confirmación de Cognito y la app.

## La cuenta del pagador (primera parte de la fase 4)

El intake ahora crea además una cuenta custodial para el pagador. El `chain` viene en el
payload y es **obligatorio**.

| | |
|---|---|
| Campo nuevo | `chain` — `TRON`, `SOL`, `USDT_TRON` o `TEST_USDT_TRON` |
| Provisión | `amplify/utils/custodialAccount.ts` → `provisionCustodialAccount` |
| Provider | fijo del lado servidor (`ProviderName.Tatum`), no lo elige el merchant |
| `accountingCurrency` | `transaction.currency` |
| Respuesta | suma `accountNo` y `depositAddress` |

### Por qué no se reusó `/accounts/account`

Parecía que alcanzaba con llamar al endpoint que ya existía, pero tenía tres problemas:

1. **Sobrescribía el `USERPROFILE`.** Su `transactWriteItems` incluía un put del perfil, y un
   `Put` de DynamoDB reemplaza el item completo. Para un pagador ya registrado habría borrado
   `firstName`, `lastName`, `platform`, `externalId`, `merchantId`, `onboarding`, `kyc` y
   `tier`. El login habría seguido funcionando, así que el daño no se notaba hasta que alguien
   buscara de qué merchant vino un pagador.
2. **El `userId` salía del authorizer**, que con la key del merchant es el id de la key, no el
   `sub` del pagador. La cuenta habría quedado a nombre de la plataforma.
3. Son cuatro llamadas externas encadenadas y no hay JWT del pagador para autenticarlas.

La solución fue extraer la provisión a un util que recibe el `userId` explícito, **no escribe
nada** y devuelve los registros. Cada caller los mete en su propia transacción, así los dos
conservan atomicidad: `/accounts/account` sigue escribiendo perfil + cuenta + balance en un
solo `TransactWriteItems`, y el intake mete cuenta + balance junto con identidad e idempotencia.

### Por qué `chain` es obligatorio y sin default

Un default del servidor convertiría "el merchant no mandó el campo" en "creamos la cuenta
equivocada", y eso no se deshace: quedan una key de KMS, una virtual account, una deposit
address y una suscripción. Un request rechazado no cuesta nada. Es el mismo criterio de
`BRAND_NAME`.

Son dos rechazos distintos y ninguno crea nada: falta el campo y el router devuelve `100029`;
el valor no está en `currencies.ts` y el handler devuelve `100009`.

### Reparación de pagadores viejos

Si el pagador ya existe pero no tiene ninguna fila `ACCOUNT#`, el intake le provisiona una en
su siguiente transacción. Así los pagadores creados antes de este cambio se arreglan solos, sin
migración.

### Lo que falta acá

- **Una carrera concurrente puede filtrar recursos.** La provisión ocurre antes de la
  transacción, así que si dos entregas simultáneas del mismo `transaction.id` compiten, la que
  pierde ya creó una key de KMS y una virtual account que quedan huérfanas. Es raro y no
  corrompe datos, pero cuesta: cada key de KMS son unos 1 USD por mes.
- **`USDT_TRON` es solo de depósito.** `withdraw` y el depósito con tarjeta lo rechazan con
  `100009`, así que hay que decidir si la cuenta del pagador es la de USDT o una nativa.
- **El `chain` debería venir de una configuración por merchant**, no del payload de cada
  transacción. Hoy `merchantId` es solo un string y no existe registro de merchants; cuando
  exista, esa decisión se muda ahí.

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
| `amplify/service/routes/onboarding/verify.ts` | fase 2 | Reporta si el link sirve y para quién. No consume el token. |
| `amplify/service/routes/onboarding/claim.ts` | fase 2 | Quema el token, fija la contraseña, revierte si la policy la rechaza. |
| `vue-app/src/views/SetPasswordView.vue` | fase 2 | La pantalla. Verifica, saluda por nombre, fija la contraseña y entra. |
| `vue-app/src/router/index.ts` | fase 2 | Ruta `/set-password`, sin `requiresAuth`. |
| `amplify/utils/claimToken.ts` | fase 2 | `loadClaim` — la validación compartida por los dos endpoints. |
| `amplify/utils/cognito.ts` | fase 2 | `adminSetUserPassword`, `adminSetEmailVerified`. |
| `amplify/service/routes/e2e/accounts/OnboardingClaimTest.ts` | fase 2 | verify ×2 → claim → claim de nuevo → verify. |
| `amplify/utils/emailTemplates.ts` | fase 3 | `claimInviteEmail`: asunto, texto y HTML, con escape. |
| `amplify/providers/email/EmailProvider.ts` | fase 3 | `html` opcional en `sendEmail`. |
| `amplify/providers/email/ses/SesEmailProvider.ts` | fase 3 | Multipart texto + HTML, UTF-8. |
| `amplify/service/routes/accounts/onboarding.ts` | fase 3 | `sendInvite` después del commit, `emailSent` en la respuesta. |
| `amplify/service/routes/e2e/accounts/AccountsOnboardingTest.ts` | fase 3 | Simulador de SES; `ONBOARDING_EMAIL` para un inbox real. |
| `amplify/utils/custodialAccount.ts` | cuenta | `provisionCustodialAccount`: KMS + Tatum, devuelve registros sin escribir. |
| `amplify/service/routes/accounts/account.ts` | cuenta | Usa el util; mismo comportamiento, 157 → 83 líneas. |
| `amplify/service/routes/accounts/onboarding.ts` | cuenta | `chain` obligatorio, provisión y reparación, `accountNo` en la respuesta. |
| `amplify/service/router.ts` | cuenta | `chain` en `requiredParams`. |

**Antes de probar:** la ruta no puede funcionar sin deploy — `COGNITO_USER_POOL_ID` y los
permisos de Cognito se agregan en `backend.ts`, así que hace falta un
`ampx pipeline-deploy`. Después, `AccountsOnboardingTest.ts` corrido dos veces seguidas
verifica el camino nuevo y el replay con el mismo `transaction.id`.

## Dónde sigue

Queda el movimiento de plata: crédito, conversión a USDT, transferencia al merchant y el
email al merchant. Sigue esperando respuestas del cliente sobre de qué cuenta sale el asiento,
porque el provider de Tatum no tiene ninguna operación de acreditar, solo `transferFunds` entre
dos VAs. La cuenta del pagador ya existe, así que esa transferencia ya tiene destino.

Antes de eso, lo que más falta es el reenvío del link: sin él, un email perdido o un link
vencido deja al pagador sin forma de entrar.

**Confirmado en el primer test de la fase 2 (2026-09-11):** `AdminSetUserPassword` y
`AdminUpdateUserAttributes` reciben el `sub` como `Username` — en este pool el username de
Cognito es el sub. El sign-in posterior devolvió `email_verified: true` y
`cognito:groups: ["user"]`.
