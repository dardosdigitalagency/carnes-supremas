import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8'
};

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const candidates = [requested, `${requested}.html`, path.join(requested, 'index.html')];
  const relative = candidates.find((candidate) => {
    const target = path.resolve(root, candidate);
    return target.startsWith(root) && existsSync(target) && statSync(target).isFile();
  });

  if (!relative) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Página no encontrada');
    return;
  }

  const target = path.resolve(root, relative);
  response.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream' });
  createReadStream(target).pipe(response);
}).listen(port, '0.0.0.0', () => {
  console.log(`Carnes Supremas disponible en http://localhost:${port}`);
});
