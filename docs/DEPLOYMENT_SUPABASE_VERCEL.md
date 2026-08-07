# Despliegue temporal con Supabase PostgreSQL y Vercel

Fecha de corte: 2026-06-21

Esta guia explica como ejecutar CoreStack usando Supabase solo como PostgreSQL gestionado y Vercel como plataforma temporal para web/API. La logica de negocio debe seguir en NestJS. El frontend debe seguir hablando con la API NestJS. No se usa Supabase Auth, Supabase REST ni acceso directo a tablas desde el frontend en esta fase.

## 1. Arquitectura temporal

```text
Usuario
  -> Vercel Web: apps/web, Next.js
  -> Vercel API: apps/api, NestJS como Vercel Function
  -> Supabase PostgreSQL: Prisma usa DATABASE_URL/DIRECT_URL
```

Responsabilidades:

- `apps/web`: UI, login visual, dashboard, POS, formularios, facturas, caja y llamadas HTTP a NestJS mediante `NEXT_PUBLIC_API_URL`.
- `apps/api`: base de datos, auth JWT propio, Prisma, guards, permisos, CORS, backend, caja, POS, facturacion, inventario y reglas de negocio.
- `packages/database`: Prisma schema, migrations, seed y cliente generado.
- Supabase: base PostgreSQL temporal.

Supabase se usa solo como Postgres porque el sistema ya tiene auth, permisos, aislamiento por tenant y reglas de negocio en NestJS.

Regla de mantenimiento:

- `corestack-api`: base de datos, Auth, Prisma, JWT, CORS, backend y logica de negocio.
- `corestack-web`: UI, login page, dashboard, POS, formularios y `NEXT_PUBLIC_API_URL`.
- Cambios de codigo: push/merge a `main` redeploya los proyectos configurados en Vercel.
- Cambios de variables: actualizar Vercel Settings > Environment Variables y redeploy manual.
- Cambios de Prisma schema: crear migracion local, revisar SQL, aplicar con `db:migrate:deploy` en Supabase y redeployar API si hace falta.

## 2. Proyecto Supabase

Valores publicos/no secretos:

```text
Project Ref: ofiajrknxhtquctgrysr
Project URL: https://ofiajrknxhtquctgrysr.supabase.co
REST URL: https://ofiajrknxhtquctgrysr.supabase.co/rest/v1/
JWKS URL: https://ofiajrknxhtquctgrysr.supabase.co/auth/v1/.well-known/jwks.json
Database host directo: db.ofiajrknxhtquctgrysr.supabase.co
Database: postgres
Database user: postgres
Pooler host: aws-1-us-east-2.pooler.supabase.com
```

No escribas la contrasena real en codigo, README, documentacion ni commits. Si la contrasena contiene `@`, en URLs PostgreSQL debe ir como `%40`.

## 3. Variables requeridas para API

Configurar en `.env`, `.env.local`, `.env.production.local` o en Vercel Environment Variables:

```env
DATABASE_URL="postgresql://postgres.ofiajrknxhtquctgrysr:YOUR_URL_ENCODED_PASSWORD@aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require"
DIRECT_URL="postgresql://postgres.ofiajrknxhtquctgrysr:YOUR_URL_ENCODED_PASSWORD@aws-1-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require"
JWT_SECRET="replace-with-corestack-secret"
JWT_EXPIRES_IN="8h"
CORS_ORIGIN="http://localhost:3000,https://YOUR_FRONTEND_VERCEL_URL"
NODE_ENV="production"
```

Opcionales para futuro, no usados para la logica principal actual:

```env
SUPABASE_URL="https://ofiajrknxhtquctgrysr.supabase.co"
SUPABASE_SECRET_KEY="replace-with-secret-key"
SUPABASE_JWKS_URL="https://ofiajrknxhtquctgrysr.supabase.co/auth/v1/.well-known/jwks.json"
```

Reglas:

- `JWT_SECRET` debe ser propio de CoreStack, no el JWT secret de Supabase.
- `SUPABASE_SECRET_KEY` nunca debe estar en frontend ni empezar con `NEXT_PUBLIC_`.
- No usar `*` en `CORS_ORIGIN` en produccion.

## 4. Variables requeridas para web

```env
NEXT_PUBLIC_API_URL="https://YOUR_API_VERCEL_URL"
# Opcional: URL publica del web para QR de captura OCR. Si se omite, se usa el origen actual.
NEXT_PUBLIC_APP_URL="https://YOUR_FRONTEND_VERCEL_URL"
NODE_ENV="production"
```

No poner secretos ni variables `NEXT_PUBLIC_SUPABASE_*` en el frontend. El frontend no debe consultar tablas de Supabase ni usar Supabase REST como backend alterno; toda operacion de negocio debe pasar por `NEXT_PUBLIC_API_URL`.

### Captura OCR desde teléfono

La opción **Capturar con el teléfono** genera un QR temporal de 10 minutos. El teléfono hace el OCR en su propio navegador y solo devuelve los datos estructurados para revisión en la computadora; la foto no se sube ni se almacena.

- `CORS_ORIGIN` del API debe incluir exactamente la URL final del web de Vercel.
- El API ya permite el encabezado técnico `x-mobile-ocr-token`; no se agrega manualmente en Vercel.
- La cámara exige HTTPS. Para probar desde teléfono no sirve `localhost`: usa un Preview/Production de Vercel o un túnel HTTPS.
- Si hay allowlist de IP en Vercel Firewall, permite el acceso del teléfono a la URL pública del web y al API. La aplicación limita esta excepción a la sesión QR temporal y al token de un solo uso.

## 5. DATABASE_URL y DIRECT_URL

`DATABASE_URL` usa el pooler transaction-mode y es la URL para runtime/serverless:

```env
DATABASE_URL="postgresql://postgres.ofiajrknxhtquctgrysr:YOUR_URL_ENCODED_PASSWORD@aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require"
```

`DIRECT_URL` se usa para migraciones Prisma:

```env
DIRECT_URL="postgresql://postgres.ofiajrknxhtquctgrysr:YOUR_URL_ENCODED_PASSWORD@aws-1-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require"
```

Resumen:

| Variable       | Uso                                      | Puerto | PgBouncer |
| -------------- | ---------------------------------------- | ------ | --------- |
| `DATABASE_URL` | Runtime NestJS/Prisma, Vercel serverless | `6543` | Si        |
| `DIRECT_URL`   | Prisma migrate/deploy/studio             | `5432` | No        |

## 6. Prisma

El datasource debe mantenerse asi:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

Comandos contra Supabase:

```bash
corepack pnpm db:generate
corepack pnpm db:migrate:deploy
```

Opcional para inspeccion:

```bash
corepack pnpm db:studio
```

No ejecutes seed contra Supabase real/produccion salvo que sea una base staging/demo y entiendas que borra datos.

## 7. Seed

El seed de desarrollo borra tablas y recrea datos demo de CoreStack/Ferreteria RIVNU. Ahora esta protegido:

```text
NODE_ENV=production
```

bloquea el seed salvo que exista:

```env
ALLOW_PRODUCTION_SEED=true
```

Usalo solo para staging/demo controlado. No lo ejecutes automaticamente en Vercel.

## 8. Desarrollo local con Docker Postgres

El flujo local sigue siendo:

```bash
corepack pnpm install
docker compose up -d
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm dev
```

Variables locales Docker:

```env
DATABASE_URL="postgresql://corestack:corestack@localhost:5432/corestack?schema=public"
DIRECT_URL="postgresql://corestack:corestack@localhost:5432/corestack?schema=public"
NEXT_PUBLIC_API_URL="http://localhost:4000"
# Para probar con un teléfono, reemplazar por una URL HTTPS pública temporal.
NEXT_PUBLIC_APP_URL=""
CORS_ORIGIN="http://localhost:3000"
NODE_ENV="development"
```

## 9. Diferencias entre entornos

| Entorno           | DB                | Migraciones                      | Seed           | API             |
| ----------------- | ----------------- | -------------------------------- | -------------- | --------------- |
| Local Docker      | Postgres local    | `db:migrate`                     | Permitido      | `pnpm dev:api`  |
| Supabase temporal | Supabase Postgres | `db:migrate:deploy`              | No recomendado | Local o Vercel  |
| Vercel            | Supabase Postgres | Ejecutar antes/deploy controlado | No automatico  | Vercel Function |

## 10. Vercel monorepo

### Proyecto web

```text
Name: corestack-web
Root Directory: apps/web
Framework: Next.js
Install Command: cd ../.. && corepack pnpm install --frozen-lockfile
Build Command: corepack pnpm build
```

Variables:

```text
NEXT_PUBLIC_API_URL=https://YOUR_API_VERCEL_URL
NEXT_PUBLIC_APP_URL=https://YOUR_FRONTEND_VERCEL_URL
NODE_ENV=production
```

### Proyecto API

```text
Name: corestack-api
Root Directory: apps/api
Runtime: Node.js / Vercel Functions
Install Command: cd ../.. && corepack enable && corepack pnpm install --frozen-lockfile
Build Command: cd ../.. && corepack pnpm db:generate && corepack pnpm --filter @qorvex/database build && corepack pnpm --filter @qorvex/api build
```

Variables:

```text
DATABASE_URL
DIRECT_URL
JWT_SECRET
JWT_EXPIRES_IN
CORS_ORIGIN
NODE_ENV
```

La API incluye:

- `apps/api/api/index.ts`: entrypoint serverless.
- `apps/api/vercel.json`: enruta todo hacia NestJS con `rewrites`, usa `framework: null` y define comandos de install/build desde la raiz del monorepo.
- `apps/api/src/bootstrap.ts`: bootstrap compartido local/serverless.
- `@qorvex/database`: workspace package compilado a `packages/database/dist` antes de construir la API. Exporta el Prisma Client generado y los enums usados por NestJS.

`@qorvex/database` debe permanecer en `dependencies` de `apps/api/package.json` porque la API usa valores runtime como `PrismaClient`, enums y `Prisma.Decimal`. No moverlo a `devDependencies`.

`apps/api/package.json` marca `@qorvex/database` como `dependenciesMeta.injected=true`, y `pnpm-workspace.yaml` mantiene `injectWorkspacePackages=true`, `dedupeInjectedDeps=false` y `syncInjectedDepsAfterScripts=["build"]`. Esto evita que Vercel empaquete la Serverless Function con symlinks hacia `packages/database`.

`apps/api/vercel.json` tambien fija `installCommand` y `buildCommand` para que Vercel no dependa de comandos viejos guardados en el dashboard.

## 11. CORS

La API lee:

```env
CORS_ORIGIN="http://localhost:3000,https://YOUR_FRONTEND_VERCEL_URL"
```

Soporta multiples origins separados por coma. Headers permitidos:

- `Authorization`
- `x-tenant-id`
- `Content-Type`

En produccion se bloquea `*`.

## 12. Pruebas basicas

Health:

```bash
curl https://YOUR_API_VERCEL_URL/health
```

Login:

```bash
curl -X POST https://YOUR_API_VERCEL_URL/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@rivnu.local\",\"password\":\"DemoPassword123!\"}"
```

Dashboard:

```bash
curl https://YOUR_API_VERCEL_URL/dashboard/summary \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-tenant-id: YOUR_TENANT_ID"
```

Productos:

```bash
curl https://YOUR_API_VERCEL_URL/products \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-tenant-id: YOUR_TENANT_ID"
```

Caja actual:

```bash
curl https://YOUR_API_VERCEL_URL/cash/sessions/current \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-tenant-id: YOUR_TENANT_ID"
```

POS preview:

```bash
curl -X POST https://YOUR_API_VERCEL_URL/pos/sales/preview \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-tenant-id: YOUR_TENANT_ID" \
  -d "{\"paymentMethod\":\"CASH\",\"items\":[{\"productId\":\"PRODUCT_ID\",\"quantity\":1}]}"
```

## 13. Validaciones recomendadas

```bash
corepack pnpm db:generate
corepack pnpm db:migrate:deploy
corepack pnpm lint
corepack pnpm build
```

Para local con Docker usar `db:migrate` en vez de `db:migrate:deploy` cuando estes creando migraciones nuevas.

## 14. Riesgos conocidos

- Vercel serverless puede tener cold starts.
- Prisma en serverless requiere pooler y `DATABASE_URL` con `pgbouncer=true`.
- Si se usa una sola base Supabase para demo y pruebas, el seed puede borrar datos si se fuerza.
- No hay Supabase Auth en esta fase; el auth sigue siendo JWT propio.
- No hay Supabase Storage para imagenes; `Product.imageUrl` sigue guardando URL/ruta.
- No usar Supabase REST para saltarse permisos del backend.

## 15. Plan futuro

- Evaluar infraestructura propia/privada para produccion definitiva.
- Agregar refresh tokens y recuperacion de contrasena.
- Agregar almacenamiento real de imagenes si se necesita.
- Evaluar Supabase Storage solo si conviene.
- Mantener la logica de negocio en NestJS.
- Implementar DGII/e-CF real antes de operar fiscalmente en produccion.
