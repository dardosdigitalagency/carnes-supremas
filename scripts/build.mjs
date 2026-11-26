import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist', 'client');
const files = [
  'admin.html', 'admin.js', 'admin.css', 'cms-api.js', 'cms-config.js', 'catalogo-cms.js',
  'index.html',
  'hoteles-restaurantes.html',
  'nosotros.html',
  'ficha-tecnica.html',
  'ficha-bistec-tabs.html',
  'ficha-bistec-editorial.html',
  'styles.css',
  'script.js',
  'robots.txt',
  'sitemap.xml',
  'llms.txt'
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });
await mkdir(path.join(output, "data"), { recursive: true });
await cp(path.join(root, "data/cms-seed.json"), path.join(output, "data/cms-seed.json"));
await Promise.all(files.map((file) => cp(path.join(root, file), path.join(output, file))));

console.log(`Sitio compilado en ${path.relative(root, output)}`);
