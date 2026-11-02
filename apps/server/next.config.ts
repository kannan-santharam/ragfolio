import type { NextConfig } from 'next';
import { withBotId } from 'botid/next/config';

/**
 * Origins allowed to frame this app: the adopter's own site(s), from the same
 * TRUSTED_ORIGINS list the server uses to decide what a visitor may see. One
 * list, deliberately — two would drift. This header is the browser-enforced
 * half of origin trust; the `x-embed-origin` check is only a preference.
 */
function frameAncestors(): string {
  const origins = (process.env.TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return ["'self'", ...origins].join(' ');
}

const nextConfig: NextConfig = {
  // unpdf ships a serverless-safe pdfjs build; keep it external so Next does not
  // try to bundle the worker into the route handler chunk.
  serverExternalPackages: ['unpdf', 'mammoth'],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          /**
           * `frame-ancestors` is clickjacking. `connect-src 'self'` is about the
           * visitor's API key: it can only ever reach this app's own server, and
           * that is enforced by the browser rather than merely true because every
           * fetch happens to be a relative path.
           */
          { key: 'Content-Security-Policy', value: `frame-ancestors ${frameAncestors()}; connect-src 'self'` },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // The embed script is loaded cross-origin by adopters' pages.
        source: '/embed.js',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=300, stale-while-revalidate=86400' },
        ],
      },
    ];
  },
};

/**
 * BotID (lib/botCheck.ts): adds the rewrites that proxy the browser challenge
 * through this origin, which is also why `connect-src 'self'` still holds.
 */
export default withBotId(nextConfig);
