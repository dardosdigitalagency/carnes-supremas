(function (root) {
  'use strict';

  const LOCAL_HEADERS = { 'X-CMS-Local': '1' };
  const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const PRODUCT_COLUMNS = ['id', 'name', 'category', 'image_url', 'image_alt', 'sort_order', 'archived'];
  const SHEET_COLUMNS = ['product_id', 'title', 'description', 'image_url', 'image_alt', 'sku', 'status', 'data'];
  let config = { mode: 'unconfigured', supabaseUrl: '', publishableKey: '' };
  let session = null;
  let verified = false;
  let localUser = { id: 'local', email: 'Administrador local' };
  let initPromise;
  let refreshPromise;
  let seedPromise;

  function normalizeConfig(value) {
    const input = value || {};
    let supabaseUrl = String(input.supabaseUrl || '').trim().replace(/\/+$/, '');
    let publishableKey = String(input.publishableKey || '').trim();
    try {
      const parsed = new URL(supabaseUrl);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
      if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw new Error();
      if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error();
      if (!publishableKey.startsWith('sb_publishable_')) {
        const claims = JSON.parse(root.atob(publishableKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (claims.role !== 'anon') throw new Error();
      }
    } catch (_) { supabaseUrl = ''; publishableKey = ''; }
    return { mode: supabaseUrl && publishableKey ? 'supabase' : 'unconfigured', supabaseUrl, publishableKey };
  }

  function storageKey() { return `carnes-supremas-cms:${config.supabaseUrl}`; }
  function remember() {
    try {
      if (session) root.sessionStorage.setItem(storageKey(), JSON.stringify(session));
      else root.sessionStorage.removeItem(storageKey());
    } catch (_) { /* Browsers may disable session storage; this session still works in memory. */ }
  }
  function clearSession() { session = null; verified = false; remember(); }
  function hasSession() { return Boolean(verified && session?.access_token && session.expires_at * 1000 > Date.now()); }

  async function jsonRequest(url, options = {}) {
    const response = await root.fetch(url, { cache: 'no-store', ...options });
    let body;
    const type = response.headers?.get('content-type') || '';
    if (type.includes('json')) body = await response.json();
    else body = await response.text();
    if (!response.ok) {
      const conflict = body?.code === '40001';
      const status = conflict ? 409 : response.status;
      const invalidLogin = [400, 401].includes(status) && (url === '/api/local/login' || url.endsWith('/auth/v1/token?grant_type=password'));
      const message = typeof body === 'object' && (body.error_description || body.msg || body.message || body.error);
      const error = new Error(conflict ? 'El contenido cambió desde que lo abriste. Recarga los datos antes de volver a guardar.' : invalidLogin ? 'Usuario o contraseña incorrectos.' : status === 401 ? 'Tu sesión expiró. Inicia sesión de nuevo.' : status === 403 ? 'No tienes permiso para realizar esta acción.' : message || `No fue posible completar la solicitud (${status}).`);
      error.status = status;
      if (typeof body?.code === 'string') error.code = body.code;
      throw error;
    }
    if (typeof body !== 'object' || body === null) throw new Error('El servidor devolvió una respuesta inesperada.');
    return body;
  }

  function headers(token, json = true) {
    const result = { apikey: config.publishableKey };
    if (token) result.Authorization = `Bearer ${token}`;
    if (json) result['Content-Type'] = 'application/json';
    return result;
  }

  function storeSession(tokens) {
    if (!tokens?.access_token || !tokens.refresh_token) throw new Error('No se recibió una sesión válida.');
    session = { access_token: tokens.access_token, refresh_token: tokens.refresh_token,
      expires_at: Number(tokens.expires_at) || Math.floor(Date.now() / 1000) + Number(tokens.expires_in || 3600), user: tokens.user || null };
  }

  async function verifyAdmin() {
    const user = await jsonRequest(`${config.supabaseUrl}/auth/v1/user`, { headers: headers(session.access_token) });
    if (!user?.id) throw new Error('No se pudo verificar la sesión.');
    const members = await jsonRequest(`${config.supabaseUrl}/rest/v1/app_admins?select=user_id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`, { headers: headers(session.access_token) });
    if (!Array.isArray(members) || !members.some(member => member.user_id === user.id)) {
      throw new Error('Esta cuenta no tiene acceso al administrador. Solicita acceso al responsable del sitio.');
    }
    session.user = user;
    verified = true;
    remember();
    return user;
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      if (!session?.refresh_token) throw new Error('Inicia sesión para continuar.');
      try {
        const tokens = await jsonRequest(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST', headers: headers(), body: JSON.stringify({ refresh_token: session.refresh_token })
        });
        storeSession(tokens);
        await verifyAdmin();
      } catch (error) { clearSession(); throw error; }
    })();
    try { await refreshPromise; } finally { refreshPromise = null; }
  }

  async function ensureAdmin() {
    await init();
    if (config.mode === 'local') {
      if (config.localAuthRequired && !config.localAuthenticated) throw new Error('Inicia sesión para continuar.');
      return;
    }
    if (config.mode !== 'supabase') throw new Error('Configura Supabase para habilitar el administrador en este alojamiento.');
    if (session?.refresh_token && session.expires_at * 1000 < Date.now() + 30000) await refresh();
    if (!hasSession()) throw new Error('Inicia sesión para continuar.');
  }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const runtime = normalizeConfig(root.CMS_CONFIG);
      try {
        const server = await jsonRequest('/api/config');
        if (server.mode === 'neon' || server.mode === 'local' && ['localhost', '127.0.0.1', '[::1]'].includes(root.location?.hostname)) {
          config = { mode: 'local', provider: server.mode, supabaseUrl: '', publishableKey: '', localAuthRequired: server.localAuthRequired === true, localAuthenticated: server.localAuthenticated === true };
        }
        else config = normalizeConfig(server).mode === 'supabase' ? normalizeConfig(server) : runtime;
      } catch (error) {
        if (error.status >= 500) { initPromise = null; throw error; }
        config = runtime;
      }
      if (config.mode === 'supabase') {
        try {
          session = JSON.parse(root.sessionStorage.getItem(storageKey()) || 'null');
          if (session?.access_token && session.refresh_token) {
            if (session.expires_at * 1000 < Date.now() + 30000) await refresh();
            else await verifyAdmin();
          } else clearSession();
        } catch (_) { clearSession(); }
      }
      return Object.freeze({ ...config });
    })();
    return initPromise;
  }

  async function login(email, password) {
    await init();
    const username = String(email).trim();
    if (config.mode === 'local') {
      const result = await jsonRequest('/api/local/login', {
        method: 'POST', headers: { ...LOCAL_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password })
      });
      if (!result.authenticated) throw new Error('No se pudo verificar el acceso al administrador.');
      config = { ...config, localAuthenticated: true };
      localUser = result.user?.id ? { ...result.user } : { id: 'local', email: String(result.username || 'Admin') };
      return { ...localUser };
    }
    if (config.mode !== 'supabase') throw new Error('Primero configura la conexión de Supabase.');
    clearSession();
    try {
      const tokens = await jsonRequest(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: headers(), body: JSON.stringify({ email: username.toLowerCase() === 'admin' ? 'admin@carnessupremas.invalid' : username, password })
      });
      storeSession(tokens);
      return await verifyAdmin();
    } catch (error) { clearSession(); throw error; }
  }

  async function adminRequest(path, options = {}) {
    await ensureAdmin();
    if (config.mode === 'local') return jsonRequest(`/api/admin/${path}`, { ...options, headers: { ...LOCAL_HEADERS, ...options.headers } });
    return jsonRequest(`${config.supabaseUrl}/rest/v1/${path}`, { ...options, headers: { ...headers(session.access_token), ...options.headers } });
  }

  async function seed() {
    if (!seedPromise) seedPromise = jsonRequest('/data/cms-seed.json').catch(error => { seedPromise = null; throw error; });
    return seedPromise;
  }

  function rows(value, property) {
    const result = Array.isArray(value) ? value : value?.[property];
    if (!Array.isArray(result)) throw new Error('No se recibió una lista válida.');
    return result;
  }

  async function list() {
    await ensureAdmin();
    if (config.mode === 'local') return adminRequest('state');
    const [products, sheets] = await Promise.all([
      adminRequest('products?select=*&order=sort_order.asc,name.asc'),
      adminRequest('technical_sheets?select=*&order=updated_at.desc')
    ]);
    return { products: rows(products, 'products'), sheets: rows(sheets, 'sheets') };
  }

  async function publicProducts() {
    await init();
    let result;
    if (config.mode === 'local') result = await jsonRequest('/api/products');
    else if (config.mode === 'supabase') result = await jsonRequest(`${config.supabaseUrl}/rest/v1/products?select=*&archived=eq.false&order=sort_order.asc,name.asc`, { headers: headers(undefined, false) });
    else result = await seed();
    return rows(result, 'products').filter(product => !product.archived);
  }

  async function publicSheet(id) {
    await init();
    if (!id) return null;
    let result;
    if (config.mode === 'local') {
      try { result = await jsonRequest(`/api/sheets/${encodeURIComponent(id)}`); }
      catch (error) { if (error.status === 404) return null; throw error; }
      result = result.sheet || result;
    } else if (config.mode === 'supabase') {
      const values = await jsonRequest(`${config.supabaseUrl}/rest/v1/technical_sheets?select=*&product_id=eq.${encodeURIComponent(id)}&status=eq.published&limit=1`, { headers: headers(undefined, false) });
      result = rows(values, 'sheets')[0];
    } else result = (await seed()).sheets.find(sheet => sheet.product_id === id);
    return result?.status === 'published' ? result : null;
  }

  async function save(table, item, key) {
    if (!item || typeof item[key] !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(item[key])) throw new Error('El identificador del producto no es válido.');
    const saved = { ...item };
    delete saved.updated_at;
    if (config.mode === 'local') {
      const result = await adminRequest(`${table === 'products' ? 'products' : 'sheets'}/${encodeURIComponent(item[key])}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saved)
      });
      return result.product || result.sheet || result;
    }
    const columns = table === 'products' ? PRODUCT_COLUMNS : SHEET_COLUMNS;
    const payload = Object.fromEntries(columns.filter(column => Object.prototype.hasOwnProperty.call(saved, column)).map(column => [column, saved[column]]));
    const expected = item.expected_updated_at;
    const update = typeof expected === 'string' && Boolean(expected);
    const endpoint = update ? `${table}?${key}=eq.${encodeURIComponent(item[key])}&updated_at=eq.${encodeURIComponent(expected)}` : table;
    const result = await adminRequest(endpoint, {
      method: update ? 'PATCH' : 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload)
    });
    if (!Array.isArray(result) || !result[0]) {
      throw new Error(update ? 'El contenido cambió desde que lo abriste. Recarga los datos antes de volver a guardar.' : 'El servidor no confirmó el guardado.');
    }
    return result[0];
  }

  function entryPayload(item, columns) {
    const payload = Object.fromEntries(columns.filter(column => Object.prototype.hasOwnProperty.call(item, column)).map(column => [column, item[column]]));
    payload.expected_updated_at = item.expected_updated_at ?? null;
    return payload;
  }

  async function saveEntry(entry) {
    const product = entry?.product;
    const sheet = entry?.sheet;
    if (!product || typeof product.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(product.id)) {
      throw new Error('El identificador del producto no es válido.');
    }
    if (!sheet || sheet.product_id !== product.id) throw new Error('La ficha técnica debe pertenecer al producto que estás editando.');
    await ensureAdmin();
    const productData = entryPayload(product, PRODUCT_COLUMNS);
    const sheetData = entryPayload(sheet, SHEET_COLUMNS);
    let result;
    if (config.mode === 'local') {
      result = await adminRequest(`entries/${encodeURIComponent(product.id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product: productData, sheet: sheetData })
      });
    } else {
      result = await adminRequest('rpc/save_cms_entry', {
        method: 'POST', body: JSON.stringify({ product_data: productData, sheet_data: sheetData })
      });
    }
    if (result?.product?.id !== product.id || result?.sheet?.product_id !== product.id) {
      throw new Error('El servidor no confirmó el guardado completo del producto y su ficha.');
    }
    return { product: result.product, sheet: result.sheet };
  }

  async function upload(file) {
    if (!file || !IMAGE_TYPES[file.type]) throw new Error('Elige una imagen JPG, PNG o WebP.');
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error('La imagen debe pesar entre 1 byte y 5 MB.');
    await ensureAdmin();
    if (config.mode === 'local') return jsonRequest('/api/admin/uploads', { method: 'POST', headers: { ...LOCAL_HEADERS, 'Content-Type': file.type }, body: file });
    const name = `${root.crypto.randomUUID()}.${IMAGE_TYPES[file.type]}`;
    await jsonRequest(`${config.supabaseUrl}/storage/v1/object/product-images/${name}`, {
      method: 'POST', headers: { ...headers(session.access_token, false), 'Content-Type': file.type, 'x-upsert': 'false' }, body: file
    });
    return { url: `${config.supabaseUrl}/storage/v1/object/public/product-images/${name}` };
  }

  async function logout() {
    if (config.mode === 'local') {
      await jsonRequest('/api/local/logout', { method: 'POST', headers: { ...LOCAL_HEADERS, 'Content-Type': 'application/json' }, body: '{}' });
      config = { ...config, localAuthenticated: false };
      localUser = { id: 'local', email: 'Administrador local' };
      return;
    }
    const token = session?.access_token;
    clearSession();
    if (config.mode === 'supabase' && token) {
      try { await root.fetch(`${config.supabaseUrl}/auth/v1/logout`, { method: 'POST', headers: headers(token) }); } catch (_) { /* Local credentials are cleared even when offline. */ }
    }
  }

  root.CMS = Object.freeze({ init, login, logout, list, publicProducts, publicSheet, upload, saveEntry,
    saveProduct: async product => { await ensureAdmin(); return save('products', product, 'id'); },
    saveSheet: async sheet => { await ensureAdmin(); return save('technical_sheets', sheet, 'product_id'); },
    get config() { return Object.freeze({ ...config }); },
    get authenticated() { return config.mode === 'local' ? !config.localAuthRequired || config.localAuthenticated : hasSession(); },
    get user() { return config.mode === 'local' ? (!config.localAuthRequired || config.localAuthenticated ? { ...localUser } : null) : session?.user ? { ...session.user } : null; }
  });
  if (typeof module === 'object' && module.exports) module.exports = { normalizeConfig };
})(typeof window === 'undefined' ? globalThis : window);
