const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FILE_PATH = path.join(__dirname, '..', 'data', 'rsvps.json');
const usePostgres = process.env.STORE !== 'file' && Boolean(process.env.DATABASE_URL);

let pool = null;
if (usePostgres) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false'
      ? false
      : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' },
  });
}

async function ensureSchema() {
  if (!usePostgres) {
    await fs.promises.mkdir(path.dirname(FILE_PATH), { recursive: true });
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rsvps (
      id SERIAL PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      status TEXT NOT NULL,
      guests INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS rsvps_slug_idx ON rsvps (slug)');
}

async function readFile() {
  try {
    return JSON.parse(await fs.promises.readFile(FILE_PATH, 'utf8'));
  } catch {
    return [];
  }
}

async function writeFile(rows) {
  await fs.promises.writeFile(FILE_PATH, JSON.stringify(rows, null, 2), 'utf8');
}

async function createRSVP(entry) {
  const record = { ...entry, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  if (usePostgres) {
    const result = await pool.query(
      `INSERT INTO rsvps (slug, name, phone, status, guests, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id, slug, name, status, guests, created_at`,
      [record.slug, record.name, record.phone, record.status, record.guests, record.notes || ''],
    );
    return result.rows[0];
  }
  const rows = await readFile();
  rows.push(record);
  await writeFile(rows);
  return { id: record.id, slug: record.slug, name: record.name, status: record.status, guests: record.guests, createdAt: record.createdAt };
}

async function listRSVPs(slug) {
  if (!slug) throw new Error('Falta el slug');
  if (usePostgres) {
    const result = await pool.query(
      'SELECT id, slug, name, status, guests, notes, created_at FROM rsvps WHERE slug = $1 ORDER BY created_at DESC',
      [slug],
    );
    return result.rows;
  }
  return (await readFile()).filter((row) => row.slug === slug);
}

module.exports = { ensureSchema, createRSVP, listRSVPs, usePostgres };
