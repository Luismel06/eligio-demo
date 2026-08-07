import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

export async function createQorvexApiApp() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });
  const config = app.get(ConfigService);
  const expressApp = app.getHttpAdapter().getInstance();

  assertSecurityConfiguration(config);

  expressApp.set('trust proxy', getTrustProxy(config));

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      frameguard: {
        action: 'deny',
      },
      hsts:
        process.env.NODE_ENV === 'production'
          ? {
              maxAge: 15552000,
              includeSubDomains: true,
              preload: false,
            }
          : false,
    }),
  );

  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  app.use('/auth', (_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    next();
  });

  app.use((request: Request, response: Response, next: NextFunction) => {
    if (isPublicMobileOcrCaptureRequest(request)) {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Pragma', 'no-cache');
    }
    next();
  });

  app.use(createInternalAccessMiddleware(config));

  // A phone can be outside the office IP allowlist while its paired desktop is
  // inside it. Only the two token-protected handoff routes bypass that
  // allowlist, and they have a dedicated low rate limit below.
  const publicMobileOcrCaptureRateLimiter = rateLimit({
    windowMs: getNumberConfig(config, 'MOBILE_OCR_PUBLIC_RATE_LIMIT_WINDOW_MS', 10 * 60 * 1000),
    limit: getNumberConfig(config, 'MOBILE_OCR_PUBLIC_RATE_LIMIT_MAX', 30),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (request) => request.method === 'OPTIONS',
    message: {
      statusCode: 429,
      message: 'Too many mobile OCR attempts. Try again in a few minutes.',
    },
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (!isPublicMobileOcrCaptureRequest(request)) {
      next();
      return;
    }
    publicMobileOcrCaptureRateLimiter(request, response, next);
  });

  app.use(
    rateLimit({
      windowMs: getNumberConfig(config, 'API_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
      limit: getNumberConfig(config, 'API_RATE_LIMIT_MAX', 600),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: (request) => request.path === '/' || request.path === '/health',
      message: {
        statusCode: 429,
        message: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.',
      },
    }),
  );

  app.use(
    '/auth/login',
    rateLimit({
      windowMs: getNumberConfig(config, 'AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
      limit: getNumberConfig(config, 'AUTH_RATE_LIMIT_MAX', 10),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        statusCode: 429,
        message:
          'Demasiados intentos de inicio de sesion. Espera unos minutos y vuelve a intentarlo.',
      },
    }),
  );

  app.use(json({ limit: getStringConfig(config, 'API_JSON_BODY_LIMIT', '1mb') }));
  app.use(
    urlencoded({ extended: false, limit: getStringConfig(config, 'API_FORM_BODY_LIMIT', '1mb') }),
  );

  app.enableCors({
    origin: getAllowedOrigins(config),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'x-tenant-id', 'x-mobile-ocr-token', 'Content-Type'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  return app;
}

function assertSecurityConfiguration(config: ConfigService) {
  const jwtSecret = config.get<string>('JWT_SECRET')?.trim() ?? '';

  if (!jwtSecret) {
    throw new Error('JWT_SECRET is required.');
  }

  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const insecureSecrets = new Set([
    'change-me',
    'replace-with-corestack-secret',
    'secret',
    'your-secret-key',
  ]);

  if (jwtSecret.length < 32 || insecureSecrets.has(jwtSecret.toLowerCase())) {
    throw new Error('JWT_SECRET must be a unique production secret with at least 32 characters.');
  }

  const corsOrigins = config
    .get<string>('CORS_ORIGIN', '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!corsOrigins.length) {
    throw new Error('CORS_ORIGIN must contain at least one production web origin.');
  }

  for (const origin of corsOrigins) {
    if (origin === '*' || origin.includes('YOUR_')) {
      throw new Error(`CORS_ORIGIN contains an unsafe placeholder: ${origin}`);
    }

    const parsedOrigin = new URL(origin);

    if (parsedOrigin.protocol !== 'https:') {
      throw new Error(`CORS_ORIGIN must use HTTPS in production: ${origin}`);
    }
  }
}

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

function createInternalAccessMiddleware(config: ConfigService) {
  const rules = parseAllowedIpRules(config.get<string>('INTERNAL_ALLOWED_IPS', ''));

  return (request: Request, response: Response, next: NextFunction) => {
    if (isPublicMobileOcrCaptureRequest(request)) {
      next();
      return;
    }

    if (!rules.length) {
      next();
      return;
    }

    const clientIp = getClientIp(request);

    if (clientIp && isIpAllowed(clientIp, rules)) {
      next();
      return;
    }

    response.status(404).json({
      statusCode: 404,
      message: 'Not found',
      path: request.originalUrl ?? request.url,
      timestamp: new Date().toISOString(),
    });
  };
}

const publicMobileOcrCapturePath =
  /^\/mobile-ocr-captures\/[A-Za-z0-9_-]{10,191}\/mobile(?:\/result)?\/?$/;

function isPublicMobileOcrCaptureRequest(request: Request) {
  return (
    (request.method === 'GET' || request.method === 'POST' || request.method === 'OPTIONS') &&
    publicMobileOcrCapturePath.test(request.path)
  );
}

function getTrustProxy(config: ConfigService) {
  const rawValue = config.get<string>(
    'TRUST_PROXY',
    process.env.NODE_ENV === 'production' ? '1' : 'false',
  );

  if (rawValue === 'true') {
    return true;
  }

  if (rawValue === 'false') {
    return false;
  }

  const numericValue = Number(rawValue);
  return Number.isFinite(numericValue) ? numericValue : rawValue;
}

function getNumberConfig(config: ConfigService, key: string, fallback: number) {
  const value = Number(config.get<string | number>(key, fallback));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getStringConfig(config: ConfigService, key: string, fallback: string) {
  const value = config.get<string>(key);
  return value?.trim() || fallback;
}

function getAllowedOrigins(config: ConfigService) {
  const rawOrigins =
    config.get<string>('CORS_ORIGIN') ??
    config.get<string>('WEB_ORIGIN') ??
    'http://localhost:3000';
  const origins = rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (process.env.NODE_ENV === 'production' && origins.includes('*')) {
    throw new Error('CORS_ORIGIN cannot include * in production.');
  }

  return (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (origins.includes(origin)) {
      callback(null, true);
      return;
    }

    // An unknown browser origin must simply receive no CORS permission. Raising
    // an error here reaches the global HTTP exception filter as a misleading
    // 500 response instead of letting the browser block the cross-origin call.
    callback(null, false);
  };
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

function getClientIp(request: Request) {
  const forwardedFor = request.headers['x-forwarded-for'];
  const firstForwardedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const candidate =
    firstForwardedIp?.split(',')[0] ?? request.ip ?? request.socket.remoteAddress ?? '';
  return normalizeIp(candidate);
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

export async function listenQorvexApi(app: INestApplication) {
  const config = app.get(ConfigService);
  const port = config.get<number>('API_PORT', 4000);
  await app.listen(port);
  console.log(`CoreStack API listening on http://localhost:${port}`);
}
