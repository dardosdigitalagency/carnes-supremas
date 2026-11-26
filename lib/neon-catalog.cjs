const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { catalogOperations } = require('./cms-store.cjs');

async function openNeonCatalog({ connectionString, root }) {
  const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 10000 });
  pool.on('error', error => console.error('Conexión PostgreSQL interrumpida:', error.code));
  const client = await pool.connect();
  let initialized = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(18655217)');
    if (!(await client.query('SELECT 1 FROM carnes_cms_catalog WHERE id = 1')).rowCount) {
      let initial;
      try {
        initial = await fs.readFile(path.join(root, 'data/cms-local.json'), 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        initial = await fs.readFile(path.join(root, 'data/cms-seed.json'), 'utf8');
      }
      const state = JSON.parse(initial);
      if (!Array.isArray(state.products) || !Array.isArray(state.sheets)) throw new Error('Catálogo inicial inválido.');
      const photos = new Set([...state.products, ...state.sheets].map(entry => entry.image_url));
      for (const url of photos) {
        if (!/^\/?uploads\/[a-f0-9-]+\.(jpg|webp|png)$/.test(url)) continue;
        const name = path.basename(url);
        const bytes = await fs.readFile(path.join(root, 'uploads', name));
        await client.query('INSERT INTO carnes_cms_images VALUES ($1,$2) ON CONFLICT DO NOTHING', [name, bytes]);
      }
      await client.query('INSERT INTO carnes_cms_catalog VALUES (1,$1)', [initial]);
    }
    await client.query('COMMIT');
    initialized = true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    if (!initialized) await pool.end();
  }
  const select = 'SELECT content FROM carnes_cms_catalog WHERE id = 1';
  const read = async () => (await pool.query(select)).rows[0].content;
  async function update(mutate) {
    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');
      const state = (await conn.query(select + ' FOR UPDATE')).rows[0].content;
      const result = mutate(state);
      await conn.query('UPDATE carnes_cms_catalog SET content=$1 WHERE id=1', [state]);
      await conn.query('COMMIT');
      return result;
    } catch (error) {
      await conn.query('ROLLBACK');
      throw error;
    } finally {
      conn.release();
    }
  }
  return {
    ...catalogOperations(read, update),
    saveImage: (name, bytes) => pool.query('INSERT INTO carnes_cms_images VALUES ($1,$2)', [name, bytes]),
    readImage: async name => (await pool.query('SELECT content FROM carnes_cms_images WHERE name=$1', [name])).rows[0]?.content,
    close: () => pool.end()
  };
}
module.exports = { openNeonCatalog };
