const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { createStore, CmsError } = require('./cms-store.cjs');

const ROOT = path.resolve(__dirname, '..');
const types = { '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.gif': 'image/gif', '.avif': 'image/avif' };
const publicRootFiles = new Set(['.html', '.css', '.js', '.ico']);
const localHosts = new Set(['localhost', '127.0.0.1']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const LOCAL_SESSION_SECONDS = 8 * 60 * 60;
const LOCAL_FAILURE_WINDOW = 15 * 60 * 1000;
const scrypt = promisify(crypto.scrypt);
const json = (response, status, data) => { response.writeHead(status, { 'Content-Type': types['.json'], 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };

async function readBody(request, maximum) {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maximum) throw new CmsError(413, 'El archivo o contenido es demasiado grande.');
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) throw new CmsError(413, 'El archivo o contenido es demasiado grande.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw new CmsError(415, 'Envía el formulario como JSON.');
  const body = await readBody(request, 512 * 1024);
  try { return JSON.parse(body.toString('utf8')); } catch { throw new CmsError(400, 'El contenido JSON no es válido.'); }
}
function validHost(request) {
  try {
    const url = new URL(`http://${request.headers.host}`);
    return localHosts.has(url.hostname) && Number(url.port || '80') === request.socket.localPort && url.host === request.headers.host;
  } catch { return false; }
}
function sameOrigin(request, site) {
  try {
    const origin = new URL(request.headers.origin);
    return origin.origin === (site?.origin || `http://${request.headers.host}`) && request.headers.origin === origin.origin;
  } catch { return false; }
}
function authorizedAdmin(request, site) {
  if (request.headers['x-cms-local'] !== '1') return false;
  if (request.headers.origin) return sameOrigin(request, site);
  // Browsers omit Origin on same-origin GET requests. Fetch metadata still rules out cross-site requests.
  return request.method === 'GET' && ['same-origin', 'none'].includes(request.headers['sec-fetch-site']);
}
function imageExtension(body, mime) {
  if (mime === 'image/jpeg' && body.length > 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return '.jpg';
  if (mime === 'image/png' && body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png';
  if (mime === 'image/webp' && body.length >= 12 && body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  throw new CmsError(415, 'Selecciona una imagen JPEG, PNG o WebP válida.');
}
function localCredentials(env, mode) {
  if (mode !== 'local' || (!env.CMS_LOCAL_USERNAME && !env.CMS_LOCAL_PASSWORD_HASH)) return null;
  const username = env.CMS_LOCAL_USERNAME;
  const encoded = env.CMS_LOCAL_PASSWORD_HASH || '';
  const match = encoded.match(/^scrypt:([a-f0-9]{32,128}):([a-f0-9]{128})$/i);
  if (typeof username !== 'string' || !username.trim() || username.length > 160 || !match || match[1].length % 2) throw new Error('Configura CMS_LOCAL_USERNAME y CMS_LOCAL_PASSWORD_HASH con formato scrypt:saltHex:hashHex.');
  return { username, salt: Buffer.from(match[1], 'hex'), hash: Buffer.from(match[2], 'hex') };
}
function cookieToken(request) {
  const value = (request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('cms_local_session='))?.slice('cms_local_session='.length);
  return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
}
const tokenKey = (token) => crypto.createHash('sha256').update(token).digest('hex');
const safeTextEqual = (one, two) => crypto.timingSafeEqual(crypto.createHash('sha256').update(one).digest(), crypto.createHash('sha256').update(two).digest());

function createServer(options = {}) {
  const root = options.root || ROOT;
  const env = options.env || process.env;
  const supabaseUrl = env.SUPABASE_URL || '';
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.PUBLISHABLE_KEY || '';
  const useNeon = Boolean(env.DATABASE_URL);
  const site = env.CMS_PUBLIC_ORIGIN ? new URL(env.CMS_PUBLIC_ORIGIN) : null;
  if (site && (site.protocol !== 'https:' || !useNeon)) throw new Error('CMS_PUBLIC_ORIGIN requiere HTTPS y DATABASE_URL.');
  const hosted = env.NODE_ENV === 'production' || options.hosted;
  const readOnly = hosted && !site && !useNeon;
  if (hosted && useNeon && !site) throw new Error('Configura CMS_PUBLIC_ORIGIN para producción.');
  const mode = readOnly ? 'unconfigured' : !useNeon && supabaseUrl && publishableKey ? 'supabase' : 'local';
  const credentials = localCredentials(env, mode);
  if (useNeon && !credentials) throw new Error('Configura las credenciales del administrador antes de activar Neon.');
  const sessions = new Map();
  const failures = new Map();
  const hasSession = (request) => {
    const token = cookieToken(request);
    if (!token) return false;
    const key = tokenKey(token);
    const expires = sessions.get(key);
    if (!expires || expires <= Date.now()) { sessions.delete(key); return false; }
    return true;
  };
  const storePromise = useNeon ? require('./neon-catalog.cjs').openNeonCatalog({ connectionString: env.DATABASE_URL, root }) : mode === 'local' ? createStore({ root, file: options.dataFile, seedFile: options.seedFile }) : null;
  // Requests await this same initialization promise and handle failures through the API.
  storePromise?.catch(() => {});
  const uploadsDirectory = options.uploadsDirectory || path.join(root, 'uploads');
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    try {
      if (site ? request.headers.host !== site.host : !readOnly && !validHost(request)) throw new CmsError(403, 'Servidor disponible únicamente desde localhost.');
      if (!readOnly && request.headers.origin && !sameOrigin(request, site)) throw new CmsError(403, 'Origen no permitido.');
      let pathname;
      try { pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname); }
      catch { throw new CmsError(400, 'La ruta no es válida.'); }
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some((part) => part.startsWith('.'))) throw new CmsError(404, 'No encontrado.');
      if (readOnly && (pathname.startsWith('/uploads/') || (pathname.startsWith('/api/') && pathname !== '/api/config'))) throw new CmsError(404, 'No disponible.');
      if (pathname.startsWith('/api/')) {
        if (pathname === '/api/config' && request.method === 'GET' && useNeon) await storePromise;
        if (pathname === '/api/config' && request.method === 'GET') return json(response, 200, { mode: useNeon ? 'neon' : mode, supabaseUrl: supabaseUrl || null, publishableKey: publishableKey || null, localAuthRequired: Boolean(credentials), localAuthenticated: mode === 'local' && (!credentials || hasSession(request)) });
        if (pathname === '/api/local/login' && request.method === 'POST') {
          if (!credentials) throw new CmsError(404, 'El acceso con contraseña local no está configurado.');
          if (!authorizedAdmin(request, site)) throw new CmsError(403, 'Abre el administrador desde este sitio para continuar.');
          const client = request.socket.remoteAddress;
          let attempts = failures.get(client);
          if (attempts && attempts.expires <= Date.now()) { failures.delete(client); attempts = null; }
          if (attempts?.count >= 5) {
            response.setHeader('Retry-After', Math.ceil((attempts.expires - Date.now()) / 1000));
            throw new CmsError(429, 'Demasiados intentos. Vuelve a intentar en 15 minutos.');
          }
          const body = await readJson(request);
          if (!body || typeof body.username !== 'string' || typeof body.password !== 'string' || body.username.length > 160 || body.password.length > 1024) throw new CmsError(400, 'Escribe usuario y contraseña.');
          const calculated = await scrypt(body.password, credentials.salt, credentials.hash.length);
          const validPassword = crypto.timingSafeEqual(calculated, credentials.hash);
          const validUsername = safeTextEqual(body.username, credentials.username);
          if (!validPassword || !validUsername) {
            const record = failures.get(client) || { count: 0, expires: Date.now() + LOCAL_FAILURE_WINDOW };
            record.count += 1;
            failures.set(client, record);
            throw new CmsError(401, 'Usuario o contraseña incorrectos.');
          }
          failures.delete(client);
          for (const [key, expires] of sessions) if (expires <= Date.now()) sessions.delete(key);
          const previous = cookieToken(request);
          if (previous) sessions.delete(tokenKey(previous));
          const token = crypto.randomBytes(32).toString('hex');
          sessions.set(tokenKey(token), Date.now() + LOCAL_SESSION_SECONDS * 1000);
          response.setHeader('Set-Cookie', `cms_local_session=${token}; HttpOnly; SameSite=Strict; Path=/; ${site ? 'Secure; ' : ''}Max-Age=${LOCAL_SESSION_SECONDS}`);
          return json(response, 200, { authenticated: true, username: credentials.username });
        }
        if (pathname === '/api/local/logout' && request.method === 'POST') {
          if (mode !== 'local') throw new CmsError(404, 'No encontrado.');
          if (!authorizedAdmin(request, site)) throw new CmsError(403, 'Abre el administrador desde este sitio para continuar.');
          const token = cookieToken(request);
          if (token) sessions.delete(tokenKey(token));
          response.setHeader('Set-Cookie', 'cms_local_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
          return json(response, 200, { authenticated: false });
        }
        if (pathname.startsWith('/api/admin/')) {
          if (mode !== 'local') throw new CmsError(404, 'La administración local está desactivada.');
          if (!authorizedAdmin(request, site)) throw new CmsError(403, 'Abre el administrador desde este sitio para continuar.');
          if (credentials && !hasSession(request)) throw new CmsError(401, 'Inicia sesión para administrar las fichas.');
          const store = await storePromise;
          if (pathname === '/api/admin/state' && request.method === 'GET') return json(response, 200, await store.getState());
          const entry = pathname.match(/^\/api\/admin\/entries\/([a-z0-9][a-z0-9-]{0,119})$/);
          if (entry && request.method === 'PUT') return json(response, 200, await store.saveEntry(entry[1], await readJson(request)));
          const product = pathname.match(/^\/api\/admin\/products\/([a-z0-9][a-z0-9-]{0,119})$/);
          if (product && request.method === 'PUT') return json(response, 200, await store.saveProduct(product[1], await readJson(request)));
          const sheet = pathname.match(/^\/api\/admin\/sheets\/([a-z0-9][a-z0-9-]{0,119})$/);
          if (sheet && request.method === 'PUT') return json(response, 200, await store.saveSheet(sheet[1], await readJson(request)));
          if (pathname === '/api/admin/uploads' && request.method === 'POST') {
            const mime = (request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new CmsError(415, 'Usa una imagen JPEG, PNG o WebP de hasta 5 MB.');
            const body = await readBody(request, MAX_IMAGE_BYTES);
            const extension = imageExtension(body, mime);
            
            const filename = `${crypto.randomUUID()}${extension}`;
            if (useNeon) await store.saveImage(filename, body);
            else {
              await fs.mkdir(uploadsDirectory, { recursive: true });
              await fs.writeFile(path.join(uploadsDirectory, filename), body, { flag: 'wx' });
            }
            return json(response, 201, { url: `/uploads/${filename}` });
          }
          throw new CmsError(404, 'No encontrado.');
        }
        if (mode === 'supabase') throw new CmsError(404, 'Usa la base de datos configurada para leer el contenido.');
        const store = await storePromise;
        if (pathname === '/api/products' && request.method === 'GET') return json(response, 200, await store.getProducts());
        const sheet = pathname.match(/^\/api\/sheets\/([a-z0-9][a-z0-9-]{0,119})$/);
        if (sheet && request.method === 'GET') {
          const result = await store.getSheet(sheet[1]);
          if (!result) throw new CmsError(404, 'Este producto todavía no tiene una ficha publicada.');
          return json(response, 200, result);
        }
        throw new CmsError(404, 'No encontrado.');
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw new CmsError(405, 'Método no permitido.');
      const pages = { '/': '/index.html', '/empresas': '/hoteles-restaurantes.html', '/nosotros': '/nosotros.html', '/hoteles-restaurantes': '/hoteles-restaurantes.html', '/admin': '/admin.html', '/ficha-bistec': '/ficha-bistec-editorial.html' };
      const canonical = pathname === '/index.html' ? '/' : /^\/(empresas|admin|ficha-bistec)(?:\.html|\/)$/.exec(pathname)?.[1];
      if (canonical !== undefined) {
        response.writeHead(308, { Location: (canonical === '/' ? '/' : `/${canonical}`) + new URL(request.url, 'http://localhost').search, 'Cache-Control': 'no-cache' });
        return response.end();
      }
      const requested = pages[pathname] || pathname;
      const extension = path.extname(requested).toLowerCase();
      const publicAsset = requested.startsWith('/assets/') && Boolean(types[extension]) && extension !== '.html';
      const publicUpload = /^\/uploads\/[a-f0-9-]+\.(jpg|png|webp)$/.test(requested);
      const publicDocument = ['/robots.txt','/sitemap.xml','/llms.txt'].includes(requested) || requested.split('/').length === 2 && publicRootFiles.has(extension);
      const publicSeed = requested === '/data/cms-seed.json';
      if (!publicAsset && !publicUpload && !publicDocument && !publicSeed) throw new CmsError(404, 'No encontrado.');
      if (publicUpload && useNeon) {
        const bytes = await (await storePromise).readImage(path.basename(requested));
        if (!bytes) throw new CmsError(404, 'Imagen no disponible.');
        response.writeHead(200, { 'Content-Type': types[extension], 'Cache-Control': 'public, max-age=86400' });
        return response.end(request.method === 'HEAD' ? undefined : bytes);
      }
      const base = publicUpload ? uploadsDirectory : root;
      const file = publicUpload ? path.join(base, path.basename(requested)) : path.resolve(root, `.${requested}`);
      const real = await fs.realpath(file);
      const realBase = await fs.realpath(base);
      if (!real.startsWith(`${realBase}${path.sep}`)) throw new CmsError(404, 'No encontrado.');
      const info = await fs.stat(real);
      if (!info.isFile()) throw new CmsError(404, 'No encontrado.');
      const body = await fs.readFile(real);
      response.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': publicUpload || publicAsset ? 'public, max-age=3600' : 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (response.headersSent) return response.end();
      const status = error.status || (['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500);
      if (status === 500) console.error('CMS request failed:', error);
      json(response, status, { error: status === 500 ? 'No se pudo completar la operación. Intenta de nuevo.' : error.message });
    }
  });
  if (useNeon) server.on('close', () => storePromise.then(store => store.close()).catch(() => {}));
  return server;
}
module.exports = { createServer };
