import { ConfigService } from '@nestjs/config';

const minimumSecretBytes = 32;
const insecureSecrets = new Set([
  'change-me',
  'replace-with-corestack-secret',
  'replace-with-tax-identity-hmac-secret',
  'replace-with-tax-identity-hmac-secret-of-at-least-32-bytes',
  'secret',
  'your-secret-key',
]);

/**
 * Resolve the key used to bind tax documents without persisting the document.
 * Production requires a separate key so rotating JWT sessions cannot silently
 * invalidate outstanding overrides and a leaked JWT key is not reused here.
 */
export function getTaxIdentityHmacSecret(config: ConfigService) {
  const configured = config.get<string>('TAX_IDENTITY_HMAC_SECRET')?.trim() ?? '';
  const jwtSecret = config.get<string>('JWT_SECRET')?.trim() ?? '';
  if (!configured && process.env.NODE_ENV === 'production') {
    throw new Error('TAX_IDENTITY_HMAC_SECRET is required in production.');
  }

  const secret = configured || jwtSecret;
  if (Buffer.byteLength(secret, 'utf8') < minimumSecretBytes) {
    throw new Error('TAX_IDENTITY_HMAC_SECRET must contain at least 32 bytes.');
  }
  if (process.env.NODE_ENV === 'production' && insecureSecrets.has(secret.toLowerCase())) {
    throw new Error('TAX_IDENTITY_HMAC_SECRET must be a unique production secret.');
  }
  if (process.env.NODE_ENV === 'production' && secret === jwtSecret) {
    throw new Error('TAX_IDENTITY_HMAC_SECRET must be different from JWT_SECRET in production.');
  }

  return secret;
}
