# CoreStack

CoreStack is the SaaS/ERP foundation used by the independent EligioValdez Comercial demo for business management in the Dominican Republic. This repository intentionally does not use Odoo, Supabase Auth, fake DGII logic, microservices, or premature infrastructure complexity.

## Stack

- Monorepo with pnpm workspaces.
- Frontend: Next.js, TypeScript, Tailwind CSS, shadcn/ui style components, React Hook Form, Zod, TanStack Query, Recharts.
- Backend: NestJS, TypeScript, REST API, Prisma, DTO validation, tenant-aware modules.
- Database: PostgreSQL 16 through Docker Compose.
- ORM and migrations: Prisma in `packages/database`.

## Architecture

The first foundation uses a modular monolith backend and a separated frontend:

```text
apps/
  api/        NestJS REST API
  web/        Next.js frontend
packages/
  database/   Prisma schema, migrations, seed and generated client
  config/     Shared configuration placeholder
  types/      Shared domain types placeholder
  utils/      Shared utility placeholder
```

Turborepo is not included in this first phase. pnpm workspaces are enough for a clean start and keep the team focused on the product foundation.

## Requirements

- Node.js 22+ recommended.
- pnpm 10+. If pnpm is not installed, run `corepack enable`.
- Docker Desktop or Docker Engine.

On Windows, if `corepack enable` cannot write the global pnpm shim, use `corepack pnpm <command>` for the first install. After dependencies are installed, this repo also has pnpm available locally for workspace scripts.

## Local Setup

```bash
corepack enable
pnpm install
Copy-Item .env.example .env
pnpm db:generate
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

On macOS/Linux, replace `Copy-Item .env.example .env` with `cp .env.example .env`.

## Commands

- `pnpm dev`: starts API and web.
- `pnpm dev:api`: starts NestJS on port `4000`.
- `pnpm dev:web`: starts Next.js on port `3000`.
- `pnpm build`: builds API and web.
- `pnpm lint`: runs TypeScript checks for API and web.
- `pnpm format`: formats source files.
- `pnpm db:generate`: generates Prisma client.
- `pnpm db:migrate`: creates/applies local migrations.
- `pnpm db:migrate:deploy`: applies committed migrations.
- `pnpm db:seed`: loads demo development data.
- `pnpm db:studio`: opens Prisma Studio.

## Environment

Use `.env.example` as the template. Do not commit `.env` or real secrets.

The initial API uses `x-tenant-id` as a temporary development tenant context. This is deliberate and must be replaced by real authentication plus membership checks in the next phase.

For the temporary Supabase PostgreSQL and Vercel deployment flow, see `docs/DEPLOYMENT_SUPABASE_VERCEL.md`.

## API Validation

After running migrations and seed:

```bash
curl http://localhost:4000/health
```

Demo credentials for the isolated EligioValdez Comercial seed:

```text
EligioValdez admin: admin@eligiovaldez.local / DemoPassword123!
EligioValdez cashier: cajero@eligiovaldez.local / DemoPassword123!
EligioValdez almacen: almacen@eligiovaldez.local / DemoPassword123!
```

Login and call protected endpoints:

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@eligiovaldez.local","password":"DemoPassword123!"}' | jq -r .accessToken)

TENANT_ID=$(curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@eligiovaldez.local","password":"DemoPassword123!"}' | jq -r '.memberships[0].tenantId')

curl -H "Authorization: Bearer $TOKEN" \
  -H "x-tenant-id: $TENANT_ID" \
  http://localhost:4000/dashboard/summary
```

Tenant-scoped business endpoints require both `Authorization: Bearer <token>` and `x-tenant-id`.

## Frontend Validation

- Open `http://localhost:3000/login` for the visual login.
- Open `http://localhost:3000/dashboard` for the main dashboard.
- The dashboard stores the demo JWT in local storage and fetches real summary data from the API.
- Operational modules for dashboard, POS, products, customers, invoices, employees, cash logs, cash sessions, imports and fiscal sequences read/write through the API using PostgreSQL data.

## EligioValdez Demo Data And CoreStack Platform

The current seed creates the operational tenant `EligioValdez Comercial` and a separate internal provider tenant `CoreStack`.

EligioValdez users only operate their tenant data: POS, invoices, customers, products, inventory, employees, cash sessions, cash movements and fiscal sequences all require tenant context. CoreStack is the platform/core provider and remains separate from the customer branding.

The seed data is persisted in PostgreSQL and is not hardcoded in the frontend. It is a fictional development starting dataset for EligioValdez operations: hardware-store products, barcodes, opening stock, customers, cash session, fiscal sequences, paid/pending/cancelled invoices, payments and employee logs. It is not production data. When the client provides real catalog/customers/opening inventory, it should be loaded through the API or the prepared import module.

## Multitenancy

This foundation uses one PostgreSQL database with shared tables and `tenantId` on business records. Backend modules must filter by tenant. Never return operational data without tenant context.

## DGII / e-CF

The schema includes `ElectronicDocument` with provider/status fields so future DGII/e-CF integration has a place to evolve. This foundation does not implement real DGII XML, digital signatures, submission, or fiscal validation.

## Supabase

Supabase is used only as an optional temporary managed PostgreSQL target for deployment. It does not replace NestJS, JWT auth, tenant guards, Prisma, or backend-owned business logic. Do not use Supabase Auth, Supabase REST, or direct frontend table access in this phase; follow `docs/DEPLOYMENT_SUPABASE_VERCEL.md`.

## Auth Strategy

The foundation now includes backend-owned auth with email/password, bcrypt hash verification, JWT access tokens, active membership validation, tenant guards, and role guards.

Still pending for production hardening: refresh token rotation, password recovery, MFA-ready login events, rate limiting, and secure cookie/session strategy.

## Authorization

Business modules are protected by tenant membership. Write operations also require appropriate roles:

- Customers: company admin, manager, accountant.
- Products: company admin, manager, inventory.
- Inventory movements: company admin, manager, inventory.
- Invoices: company admin, manager, accountant, cashier depending on action.
- Audit logs: company admin or manager.

`SUPER_ADMIN` / `QORVEX_SUPER_ADMIN` are platform-level roles. EligioValdez tenant employees use roles such as `ADMIN`, `CASHIER`, `INVENTORY` and permission booleans like `canUsePos`, `canOpenCashSession`, `canManageProducts`, and `canManageEmployees`.

## Audit

Write actions for customers, products, inventory movements, invoices, POS sales, cash sessions and employee administration create either `AuditLog` or `EmployeeActivityLog` records with tenant, user, action, entity, entity id, and small metadata.

POS-created invoices recalculate totals in the backend, reserve a fiscal sequence, create invoice items, payments, cash movements, inventory `SALE` movements, electronic-document placeholders and employee activity logs in the same backend transaction.

## Billing Provider

The backend includes a `BillingProvider` abstraction and a `MockBillingProvider`. This is only a future integration seam; it does not implement real DGII XML, signatures, fiscal validation, submission, or cancellation.

## Development Flow

- `main`: stable.
- `development`: integration.
- `feature/*`: task branches.

Recommended foundation commit:

```text
feat: initialize CoreStack custom SaaS foundation
```

## Next Modules

- Real authentication and membership-aware tenant selection.
- Role and permission guards.
- Invoice creation workflow.
- Inventory adjustment workflows.
- Audit events for write operations.
- Billing provider abstraction for future e-CF work.
