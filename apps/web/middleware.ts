import { NextResponse, type NextRequest } from 'next/server';
import { sessionCookieName } from './lib/auth-constants';

type IpRule =
  | {
      type: 'exact';
      value: string;
    }
  | {
      type: 'cidr';
      base: number;
      mask: number;
    };

const protectedPrefixes = [
  '/dashboard',
  '/pos',
  '/orders',
  '/operations',
  '/products',
  '/employees',
  '/cash',
  '/invoices',
  '/inventory',
  '/customers',
  '/credit-approvals',
  '/quotations',
  '/returns',
  '/payables',
  '/purchase-orders',
  '/receipts',
  '/receivables',
  '/settings',
  '/supplier-invoices',
  '/suppliers',
  '/tax-identity-approvals',
];

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);

  const internalAccessResponse = enforceInternalAccess(request);

  if (internalAccessResponse) {
    return withContentSecurityPolicy(
      internalAccessResponse,
      contentSecurityPolicy,
      request.nextUrl.pathname,
    );
  }

  const { pathname, search } = request.nextUrl;
  const hasSessionCookie = Boolean(request.cookies.get(sessionCookieName)?.value);

  if (pathname === '/login' && hasSessionCookie) {
    return withContentSecurityPolicy(
      NextResponse.redirect(new URL('/dashboard', request.url)),
      contentSecurityPolicy,
      pathname,
    );
  }

  const isProtectedRoute = protectedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (!isProtectedRoute || hasSessionCookie) {
    return withContentSecurityPolicy(
      NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      }),
      contentSecurityPolicy,
      pathname,
    );
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', `${pathname}${search}`);

  return withContentSecurityPolicy(
    NextResponse.redirect(loginUrl),
    contentSecurityPolicy,
    pathname,
  );
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};

function buildContentSecurityPolicy(nonce: string) {
  const isProduction = process.env.NODE_ENV === 'production';
  const ocrAssetOrigin = 'https://cdn.jsdelivr.net';
  // El OCR se ejecuta en el navegador; este origen solo entrega el motor y los
  // modelos de idioma. La imagen de la factura no se envía fuera del dispositivo.
  const connectSources = ["'self'", ocrAssetOrigin];
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

  if (apiUrl) {
    connectSources.push(new URL(apiUrl).origin);
  }

  if (!isProduction) {
    connectSources.push('http://localhost:4000', 'ws:', 'wss:');
  }

  return [
    "default-src 'self'",
    // OpenCV.js y Tesseract ejecutan WebAssembly localmente. `wasm-unsafe-eval`
    // permite compilar WASM sin habilitar el inseguro `unsafe-eval` en producción.
    `script-src 'self' ${ocrAssetOrigin} 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${isProduction ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${[...new Set(connectSources)].join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `worker-src 'self' blob: ${ocrAssetOrigin}`,
    ...(isProduction ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

function withContentSecurityPolicy(
  response: NextResponse,
  contentSecurityPolicy: string,
  pathname?: string,
) {
  response.headers.set('Content-Security-Policy', contentSecurityPolicy);
  if (pathname && isPublicMobileOcrCapturePath(pathname)) {
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Referrer-Policy', 'no-referrer');
  }
  return response;
}

function enforceInternalAccess(request: NextRequest) {
  if (isPublicMobileOcrCapturePath(request.nextUrl.pathname)) {
    return null;
  }

  const rules = parseAllowedIpRules(process.env.INTERNAL_ALLOWED_IPS ?? '');

  if (!rules.length || isLocalDevelopmentRequest(request)) {
    return null;
  }

  const clientIp = getClientIp(request);

  if (clientIp && isIpAllowed(clientIp, rules)) {
    return null;
  }

  return new NextResponse('Not found', {
    status: 404,
  });
}

function isPublicMobileOcrCapturePath(pathname: string) {
  return /^\/ocr\/capture\/[A-Za-z0-9_-]{10,191}\/?$/.test(pathname);
}

function isLocalDevelopmentRequest(request: NextRequest) {
  return (
    process.env.NODE_ENV !== 'production' &&
    ['localhost', '127.0.0.1', '::1'].includes(request.nextUrl.hostname)
  );
}

function parseAllowedIpRules(value: string) {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return entries.map((entry) => {
    if (entry.includes('/')) {
      const [baseIp, rawMask] = entry.split('/');
      const base = ipv4ToNumber(normalizeIp(baseIp));
      const maskBits = Number(rawMask);

      if (base === null || !Number.isInteger(maskBits) || maskBits < 0 || maskBits > 32) {
        throw new Error(`Invalid INTERNAL_ALLOWED_IPS entry: ${entry}`);
      }

      const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
      return {
        type: 'cidr',
        base,
        mask,
      } satisfies IpRule;
    }

    return {
      type: 'exact',
      value: normalizeIp(entry),
    } satisfies IpRule;
  });
}

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const cloudflareIp = request.headers.get('cf-connecting-ip');
  return normalizeIp(forwardedFor?.split(',')[0] ?? realIp ?? cloudflareIp ?? '');
}

function normalizeIp(value: string) {
  const normalized = value.trim().replace(/^::ffff:/, '');
  return normalized === '::1' ? '127.0.0.1' : normalized;
}

function isIpAllowed(clientIp: string, rules: IpRule[]) {
  const clientIpNumber = ipv4ToNumber(clientIp);

  return rules.some((rule) => {
    if (rule.type === 'exact') {
      return clientIp === rule.value;
    }

    return clientIpNumber !== null && (clientIpNumber & rule.mask) === (rule.base & rule.mask);
  });
}

function ipv4ToNumber(value: string) {
  const parts = value.split('.');

  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => Number(part));

  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }

  return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}
