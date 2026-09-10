# RIVNU terminal agent

Local Windows service for the AZUL Ingenico Lane 7000. It is deliberately separate from the VM2 API: the Lane 7000 and its USB/COM driver are attached to the cashier workstation, while VM2 owns the sale, tenant, invoice, cash session and audit records.

## Current status

- `mock`: usable before the terminal arrives; approves a local test transaction without contacting AZUL.
- `azul-ingenico`: calls the AZUL WebAPI installed locally by `AutoLane7000-2.0.0.3.exe`.
- Binds to `127.0.0.1` by default; it must not be exposed on the LAN or Internet.
- Requires one active transaction per idempotency key and limits request bodies to 16 KiB.

## Development

From the repository root:

```text
corepack pnpm --filter @qorvex/terminal-agent build
```

Run a local mock:

```text
TERMINAL_AGENT_ALLOWED_ORIGIN=http://localhost:3000 TERMINAL_AGENT_PROVIDER=mock corepack pnpm --filter @qorvex/terminal-agent dev
```

Health check and sale request:

```text
curl -H "Origin: http://localhost:3000" http://127.0.0.1:9110/health
curl -X POST -H "Origin: http://localhost:3000" -H "Content-Type: application/json" \
  http://127.0.0.1:9110/v1/terminals/lane-7000/sale \
  -d '{"amount":100,"idempotencyKey":"test-001"}'
```

The real adapter is enabled only after installing and configuring the AZUL WebAPI on the cashier PC:

```text
TERMINAL_AGENT_PROVIDER=azul-ingenico
AZUL_WEB_API_URL=http://127.0.0.1:9000
TERMINAL_AGENT_ALLOWED_ORIGIN=https://<approved-rivnu-web-origin>
```

The endpoint paths and response mapping must be verified against AZUL's test environment before production use. The agent intentionally does not persist card data or store raw payment responses.
