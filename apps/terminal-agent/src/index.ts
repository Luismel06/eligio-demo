import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const host = process.env.TERMINAL_AGENT_HOST ?? '127.0.0.1';
const port = Number(process.env.TERMINAL_AGENT_PORT ?? 9110);
const runtimeEnvironment = process.env.TERMINAL_AGENT_ENV ?? 'preview';
const provider = process.env.TERMINAL_AGENT_PROVIDER ?? 'mock';
const azulBaseUrl = (process.env.AZUL_WEB_API_URL ?? 'http://127.0.0.1:9000').replace(/\/$/, '');
const allowedOrigin = process.env.TERMINAL_AGENT_ALLOWED_ORIGIN ?? '';
const activeTransactions = new Set<string>();

if (runtimeEnvironment === 'production') {
  throw new Error('The terminal agent is test-only and cannot run in production.');
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('TERMINAL_AGENT_PORT must be a valid TCP port.');
}

if (
  provider === 'azul-ingenico' &&
  !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(azulBaseUrl)
) {
  throw new Error('AZUL_WEB_API_URL must point to the local AZUL WebAPI.');
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': allowedOrigin || 'null',
    'Access-Control-Allow-Headers': 'content-type, x-terminal-agent-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  });
  response.end(JSON.stringify(body));
}

function isAllowedOrigin(request: IncomingMessage) {
  return Boolean(allowedOrigin) && request.headers.origin === allowedOrigin;
}

async function readJson(request: IncomingMessage) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 16_384) {
      throw new Error('Request body is too large.');
    }
  }
  return raw ? JSON.parse(raw) : {};
}

function amountFrom(body: Record<string, unknown>) {
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be a positive number.');
  }
  return amount.toFixed(2);
}

function idempotencyKeyFrom(body: Record<string, unknown>) {
  const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (!key || key.length > 120) {
    throw new Error('idempotencyKey is required.');
  }
  return key;
}

async function callAzul(path: string) {
  const response = await fetch(`${azulBaseUrl}${path}`, {
    signal: AbortSignal.timeout(75_000),
  });
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = JSON.parse(text);
  } catch {
    // Preserve non-JSON diagnostics for the local test harness.
  }
  return { httpStatus: response.status, approved: response.ok, payload };
}

async function transact(operation: 'sale' | 'void' | 'refund', body: Record<string, unknown>) {
  const idempotencyKey = idempotencyKeyFrom(body);
  if (activeTransactions.has(idempotencyKey)) {
    throw new Error('A transaction with this idempotencyKey is already running.');
  }
  activeTransactions.add(idempotencyKey);
  try {
    if (provider === 'mock') {
      return {
        provider: 'mock',
        operation,
        approved: true,
        idempotencyKey,
        transactionReference: `MOCK-${idempotencyKey}`,
        amount: operation === 'void' ? null : amountFrom(body),
      };
    }

    if (provider !== 'azul-ingenico') {
      throw new Error(`Unsupported TERMINAL_AGENT_PROVIDER: ${provider}`);
    }

    if (operation === 'sale') {
      return { provider, operation, idempotencyKey, ...(await callAzul(`/api/transaction/lane/sale/${amountFrom(body)}`)) };
    }
    if (operation === 'refund') {
      return { provider, operation, idempotencyKey, ...(await callAzul(`/api/transaction/lane/refund/${amountFrom(body)}`)) };
    }

    const invoiceNumber = typeof body.invoiceNumber === 'string' ? body.invoiceNumber.trim() : '';
    if (!invoiceNumber || invoiceNumber.length > 120) {
      throw new Error('invoiceNumber is required for a void.');
    }
    return { provider, operation, idempotencyKey, ...(await callAzul(`/api/transaction/lane/void/${encodeURIComponent(invoiceNumber)}`)) };
  } finally {
    activeTransactions.delete(idempotencyKey);
  }
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }
  if (!isAllowedOrigin(request)) {
    sendJson(response, 403, { error: 'Origin is not allowed.' });
    return;
  }
  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { status: 'ok', provider, activeTransactions: activeTransactions.size });
    return;
  }
  if (request.method !== 'POST') {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }

  try {
    const body = (await readJson(request)) as Record<string, unknown>;
    const url = new URL(request.url ?? '/', `http://${host}:${port}`);
    const match = url.pathname.match(/^\/v1\/terminals\/([^/]+)\/(sale|void|refund)$/);
    if (!match) {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }
    const result = await transact(match[2] as 'sale' | 'void' | 'refund', body);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : 'Request failed.' });
  }
});

server.listen(port, host, () => {
  console.log(
    `Terminal agent listening on http://${host}:${port} (${runtimeEnvironment}, ${provider})`,
  );
});
