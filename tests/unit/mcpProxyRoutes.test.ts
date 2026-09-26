import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The Claude connector URL is https://app.easyshifthq.com/mcp. Vercel (and
// Netlify previews) proxy it to the mcp edge function. The rules must come
// before the SPA catch-all, or /mcp would serve index.html.
const FUNCTION_URL = 'https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/mcp';

describe('vercel.json mcp rewrites', () => {
  const config = JSON.parse(readFileSync(resolve(__dirname, '../../vercel.json'), 'utf8')) as {
    rewrites: Array<{ source: string; destination: string }>;
  };
  const indexOf = (source: string) => config.rewrites.findIndex((r) => r.source === source);
  const catchAll = indexOf('/(.*)');

  it.each([
    ['/mcp', FUNCTION_URL],
    ['/mcp/:path*', `${FUNCTION_URL}/:path*`],
    ['/.well-known/oauth-protected-resource/mcp', `${FUNCTION_URL}/.well-known/oauth-protected-resource`],
  ])('proxies %s before the SPA catch-all', (source, destination) => {
    const i = indexOf(source);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(config.rewrites[i].destination).toBe(destination);
    expect(i).toBeLessThan(catchAll);
  });
});

describe('public/_redirects mcp proxy', () => {
  const lines = readFileSync(resolve(__dirname, '../../public/_redirects'), 'utf8')
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((parts) => parts[0]);
  const indexOf = (source: string) => lines.findIndex((parts) => parts[0] === source);

  it.each([
    ['/mcp', FUNCTION_URL],
    ['/mcp/*', `${FUNCTION_URL}/:splat`],
  ])('proxies %s with status 200 before the SPA catch-all', (source, destination) => {
    const i = indexOf(source);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(lines[i].slice(1)).toEqual([destination, '200']);
    expect(i).toBeLessThan(indexOf('/*'));
  });
});
