const sheetTemplate = require('../assets/cms/sheet-template.js');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

class CmsError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const invalid = (message) => { throw new CmsError(400, message); };
const object = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label}: se esperaba un objeto.`);
  return value;
};
const text = (value, label, maximum = 2000) => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid(`${label}: texto no válido o demasiado largo.`);
  return value.trim();
};
const identifier = (value) => {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(value)) invalid('Identificador no válido.');
  return value;
};
const imageUrl = (value) => {
  const result = text(value, 'Imagen', 2048);
  if (!result) return '';
  if (/^\/?(?:assets|uploads)\/[a-z0-9_./-]+$/i.test(result) && !result.split('/').some((part) => part.startsWith('.'))) return result;
  try { const parsed = new URL(result); if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) return result; } catch {}
  invalid('La imagen debe ser un archivo del sitio o una URL HTTPS.');
};

function validateProduct(input, id, previous) {
  object(input, 'Producto'); identifier(id);
  if (input.id !== undefined && input.id !== id) invalid('El identificador del producto no coincide.');
  const name = text(input.name, 'Nombre', 180);
  if (!name) invalid('Escribe el nombre del producto.');
  const slug = identifier(input.slug || id);
  if (!['res', 'cerdo', 'pollo', 'premium'].includes(input.category)) invalid('Selecciona una categoría del catálogo.');
  const order = input.sort_order ?? previous?.sort_order ?? 0;
  if (!Number.isSafeInteger(order) || order < 0 || order > 1000000) invalid('El orden debe ser un número entero positivo.');
  if (input.archived !== undefined && typeof input.archived !== 'boolean') invalid('El estado de archivo no es válido.');
  return { id, slug, name, category: input.category, image_url: imageUrl(input.image_url), image_alt: text(input.image_alt, 'Texto alternativo', 500), sort_order: order, archived: input.archived ?? false };
}

function validateSheet(input, productId) {
  object(input, 'Ficha'); identifier(productId);
  if (input.product_id !== undefined && input.product_id !== productId) invalid('El producto de la ficha no coincide.');
  if (!['draft', 'published'].includes(input.status)) invalid('El estado de la ficha no es válido.');
  const title = text(input.title, 'Título', 240);
  if (input.status === 'published' && !title) invalid('El título es obligatorio para publicar.');
  const data = object(input.data || {}, 'Contenido');
  const metadata = object(data.metadata || {}, 'Información general');
  const cleanMetadata = {};
  for (const key of ['origin', 'state', 'allergens', 'pieces', 'weight']) cleanMetadata[key] = text(metadata[key], key, 1000);
  const sections = data.sections || [];
  if (!sheetTemplate.isStandardSections(sections)) invalid('Todas las fichas deben conservar la estructura estándar: especificaciones, microbiología, empaque, conservación y control documental.');
  if (!Array.isArray(sections) || sections.length > 60) invalid('Una ficha admite hasta 60 secciones.');
  const ids = new Set();
  const cleanSections = sections.map((section, index) => {
    object(section, 'Sección');
    const id = identifier(section.id || `seccion-${index + 1}`);
    if (ids.has(id)) invalid('Los identificadores de las secciones deben ser únicos.');
    ids.add(id);
    if (!['fields', 'table', 'temperatures'].includes(section.kind)) invalid('El tipo de sección no es válido.');
    const fields = section.fields || [];
    if (!Array.isArray(fields) || fields.length > 100) invalid('Una sección admite hasta 100 campos.');
    const result = { id, title: text(section.title, 'Título de sección', 240), description: text(section.description, 'Descripción de sección', 20000), kind: section.kind, fields: fields.map((field) => {
      object(field, 'Campo');
      return { label: text(field.label, 'Etiqueta', 300), value: text(field.value, 'Valor', 5000), note: text(field.note, 'Nota', 5000) };
    }) };
    if (section.kind === 'table') {
      const columns = section.columns || [];
      if (!Array.isArray(columns) || columns.length < 1 || columns.length > 12) invalid('Una tabla necesita entre 1 y 12 columnas.');
      result.columns = columns.map((column) => text(column, 'Columna', 300));
      const rows = section.rows || [];
      if (!Array.isArray(rows) || rows.length > 200) invalid('Una tabla admite hasta 200 filas.');
      result.rows = rows.map((row) => {
        if (!Array.isArray(row) || row.length !== columns.length) invalid('Todas las filas deben tener el mismo número de columnas.');
        return row.map((cell) => text(cell, 'Celda', 5000));
      });
    }
    return result;
  });
  return { product_id: productId, title, description: text(input.description, 'Descripción', 20000), image_url: imageUrl(input.image_url), image_alt: text(input.image_alt, 'Texto alternativo', 500), sku: text(input.sku, 'SKU', 120), status: input.status, data: { metadata: cleanMetadata, sections: cleanSections } };
}

async function createStore({ root, file = path.join(root, 'data/cms-local.json'), seedFile = path.join(root, 'data/cms-seed.json') }) {
  let state;
  try { state = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = JSON.parse(await fs.readFile(seedFile, 'utf8')); }
  if (!Array.isArray(state.products) || !Array.isArray(state.sheets)) throw new Error('El archivo del CMS no tiene una estructura válida.');
  let queue = Promise.resolve();
  const update = (mutate) => {
    const work = queue.then(async () => {
      const next = structuredClone(state);
      const result = mutate(next);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${crypto.randomUUID()}.tmp`;
      try { await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, file); }
      finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
      state = next;
      return structuredClone(result);
    });
    queue = work.catch(() => {});
    return work;
  };
  return catalogOperations(() => structuredClone(state), update);
}

function catalogOperations(read, update) {
  const checkConflict = (input, previous) => {
    object(input, 'Contenido');
    if (input.expected_updated_at !== undefined && input.expected_updated_at !== (previous?.updated_at ?? null)) throw new CmsError(409, 'Hay una versión más reciente. Recarga antes de guardar.');
  };
  const timestamp = (previous) => new Date(Math.max(Date.now(), Date.parse(previous?.updated_at || '') + 1 || 0)).toISOString();
  return {
    getState: read,
    getProducts: async () => (await read()).products.filter((product) => !product.archived).sort((a, b) => a.sort_order - b.sort_order),
    getSheet: async (id) => {
      const state = await read();
      return state.sheets.find((sheet) => sheet.product_id === id && sheet.status === 'published' && state.products.some((product) => product.id === id && !product.archived)) || null;
    },
    saveEntry: (id, input) => update((next) => {
      object(input, 'Contenido');
      const productIndex = next.products.findIndex((product) => product.id === id);
      const sheetIndex = next.sheets.findIndex((sheet) => sheet.product_id === id);
      const previousProduct = next.products[productIndex];
      const previousSheet = next.sheets[sheetIndex];
      checkConflict(input.product, previousProduct);
      checkConflict(input.sheet, previousSheet);
      const product = validateProduct(input.product, id, previousProduct);
      const sheet = validateSheet(input.sheet, id);
      if (next.products.some((item) => item.id !== id && item.slug === product.slug)) throw new CmsError(409, 'Ese enlace ya pertenece a otro producto.');
      product.updated_at = timestamp(previousProduct);
      sheet.updated_at = timestamp(previousSheet);
      if (productIndex >= 0) next.products[productIndex] = product; else next.products.push(product);
      if (sheetIndex >= 0) next.sheets[sheetIndex] = sheet; else next.sheets.push(sheet);
      return { product, sheet };
    }),
    saveProduct: (id, input) => update((next) => {
      const index = next.products.findIndex((product) => product.id === id);
      const previous = next.products[index];
      checkConflict(input, previous);
      const product = validateProduct(input, id, previous);
      if (next.products.some((item) => item.id !== id && item.slug === product.slug)) throw new CmsError(409, 'Ese enlace ya pertenece a otro producto.');
      product.updated_at = timestamp(previous);
      if (index >= 0) next.products[index] = product; else next.products.push(product);
      return product;
    }),
    saveSheet: (id, input) => update((next) => {
      if (!next.products.some((product) => product.id === id)) throw new CmsError(404, 'El producto no existe.');
      const index = next.sheets.findIndex((sheet) => sheet.product_id === id);
      const previous = next.sheets[index];
      checkConflict(input, previous);
      const sheet = { ...validateSheet(input, id), updated_at: timestamp(previous) };
      if (index >= 0) next.sheets[index] = sheet; else next.sheets.push(sheet);
      return sheet;
    }),
  };
}
module.exports = { catalogOperations, createStore, CmsError, validateProduct, validateSheet };
