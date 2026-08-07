/** @type {import('next').NextConfig} */
const nextConfig = {
  // Mantiene aislados los artefactos de `next dev` y `next build`.
  // Sin esta separación, una compilación de producción puede reemplazar los
  // chunks que un servidor de desarrollo ya tiene abiertos.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  typedRoutes: false,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: buildSecurityHeaders(),
      },
    ];
  },
  webpack(config, { isServer }) {
    if (isServer) {
      config.output = config.output || {};
      // Ensure server chunks are emitted under the `chunks/` folder
      config.output.chunkFilename = 'chunks/[id].js';
    }
    return config;
  },
};

function buildSecurityHeaders() {
  const isProduction = process.env.NODE_ENV === 'production';

  const headers = [
    {
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin',
    },
    {
      key: 'X-Content-Type-Options',
      value: 'nosniff',
    },
    {
      key: 'X-Frame-Options',
      value: 'DENY',
    },
    {
      key: 'X-DNS-Prefetch-Control',
      value: 'off',
    },
    {
      key: 'X-Robots-Tag',
      value: 'noindex, nofollow',
    },
    {
      key: 'Permissions-Policy',
      value: 'camera=(self), microphone=(), geolocation=(), payment=()',
    },
  ];

  if (isProduction) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=15552000; includeSubDomains',
    });
  }

  return headers;
}

export default nextConfig;
