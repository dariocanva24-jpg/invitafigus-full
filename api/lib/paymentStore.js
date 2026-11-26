const fs = require('node:fs');
const path = require('node:path');

const FILE_PATH = path.join(__dirname, '..', 'data', 'payments.json');
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
    CREATE TABLE IF NOT EXISTS payments (
      code TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_id TEXT,
      amount REAL,
      updated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function readFile() {
  try { return JSON.parse(await fs.promises.readFile(FILE_PATH, 'utf8')); }
  catch { return []; }
}

async function writeFile(rows) {
  await fs.promises.writeFile(FILE_PATH, JSON.stringify(rows, null, 2), 'utf8');
}

async function start(code, amount) {
  const row = { code, status: 'pending', paymentId: null, amount, updatedAt: new Date().toISOString() };
  if (usePostgres) {
    await pool.query(
      `INSERT INTO payments (code, status, amount) VALUES ($1,'pending',$2)
       ON CONFLICT (code) DO UPDATE SET amount = $2, updated_at = NOW()`,
      [code, amount],
    );
  } else {
    const rows = (await readFile()).filter((item) => item.code !== code);
    rows.push(row);
    await writeFile(rows);
  }
  return { code, status: 'pending' };
}

async function markPaid(code, paymentId, amount) {
  const row = { code, status: 'paid', paymentId: String(paymentId), amount, updatedAt: new Date().toISOString() };
  if (usePostgres) {
    await pool.query(
      `UPDATE payments SET status='paid', payment_id=$2, amount=COALESCE($3, amount), updated_at=NOW() WHERE code=$1`,
      [code, row.paymentId, amount ?? null],
    );
  } else {
    const rows = await readFile();
    const index = rows.findIndex((item) => item.code === code);
    if (index >= 0) rows[index] = { ...rows[index], ...row };
    else rows.push(row);
    await writeFile(rows);
  }
  return row;
}

async function get(code) {
  if (usePostgres) {
    const result = await pool.query('SELECT code, status, payment_id, amount FROM payments WHERE code=$1', [code]);
    return result.rows[0] || null;
  }
  return (await readFile()).find((item) => item.code === code) || null;
}

module.exports = { ensureSchema, start, markPaid, get };
