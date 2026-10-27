import http from 'node:http';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import contactHandler from '../api/contact.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function loadEnvironment() {
  const filename = path.join(PROJECT_ROOT, '.env');
  if (!existsSync(filename)) return;
  for (const line of readFileSync(filename, 'utf8').split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Z_][A-Z_0-9]*)\s*=\s*(.*?)\s*$/u);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/u, '$2');
  }
}
loadEnvironment();

export function createSiteServer(root = PROJECT_ROOT) {
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end('Invalid URL.');
      return;
    }
    if (pathname === '/projects/bloom-co.' || pathname === '/projects/bloom-co./') {
      response.writeHead(301, {
        Location: '/projects/bloom-co' + new URL(request.url, 'http://localhost').search,
      });
      response.end();
      return;
    }
    if (pathname === '/api/contact') {
      await contactHandler(request, response);
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const permitted =
      pathname === '/' ||
      pathname === '/index.html' ||
      pathname === '/404.html' ||
      /^\/(assets|about|contact|projects|legal|404)(\/|$)/u.test(pathname);
    if (!permitted || pathname.split('/').some((part) => part.startsWith('.'))) {
      await notFound(response, root, request.method);
      return;
    }
    let filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root + path.sep) && filename !== root) {
      response.writeHead(403).end();
      return;
    }
    try {
      let details = await stat(filename);
      if (details.isDirectory()) {
        filename = path.join(filename, 'index.html');
        details = await stat(filename);
      }
      const contentType = MIME_TYPES[path.extname(filename)] || 'application/octet-stream';
      response.setHeader('Content-Type', contentType);
      response.setHeader(
        'Cache-Control',
        pathname.startsWith('/assets/') ? 'public, max-age=3600' : 'no-cache',
      );
      response.setHeader('Accept-Ranges', 'bytes');
      if (request.headers.range && contentType.startsWith('video/')) {
        const range = request.headers.range.match(/^bytes=(\d*)-(\d*)$/u);
        if (!range) {
          response.writeHead(416, { 'Content-Range': `bytes */${details.size}` }).end();
          return;
        }
        const start = range[1] ? Number(range[1]) : Math.max(0, details.size - Number(range[2]));
        const end =
          range[1] && range[2] ? Math.min(Number(range[2]), details.size - 1) : details.size - 1;
        if (!Number.isSafeInteger(start) || start > end || start >= details.size) {
          response.writeHead(416, { 'Content-Range': `bytes */${details.size}` }).end();
          return;
        }
        response.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${details.size}`,
          'Content-Length': end - start + 1,
        });
        if (request.method === 'HEAD') response.end();
        else createReadStream(filename, { start, end }).pipe(response);
        return;
      }
      const accepted = String(request.headers['accept-encoding'] || '');
      for (const [encoding, extension] of [
        ['br', '.br'],
        ['gzip', '.gz'],
      ]) {
        if (accepted.includes(encoding) && existsSync(filename + extension)) {
          filename += extension;
          details = await stat(filename);
          response.setHeader('Content-Encoding', encoding);
          response.setHeader('Vary', 'Accept-Encoding');
          break;
        }
      }
      response.setHeader('Content-Length', details.size);
      if (request.method === 'HEAD') response.end();
      else createReadStream(filename).pipe(response);
    } catch {
      await notFound(response, root, request.method);
    }
  });
}

async function notFound(response, root, method) {
  response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  if (method === 'HEAD') {
    response.end();
    return;
  }
  const filename = path.join(root, '404/index.html');
  if (existsSync(filename)) createReadStream(filename).pipe(response);
  else response.end('Page not found.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const production = process.argv.includes('--production');
  const root = production ? path.join(PROJECT_ROOT, 'dist') : PROJECT_ROOT;
  if (production && !existsSync(root))
    throw new Error('Run npm run build before starting the production server.');
  const port = Number(process.env.PORT || 3000);
  createSiteServer(root).listen(port, '0.0.0.0', () =>
    console.log(`Ember is running at http://localhost:${port}`),
  );
}
