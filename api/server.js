const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const rsvpStore = require('./lib/rsvpStore');
const paymentStore = require('./lib/paymentStore');
const mercadopago = require('./lib/mercadopago');
const whatsapp = require('./lib/whatsapp');

const app = express();

// --- CORS restringido (antes: cors() abierto a cualquier origen) ---
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '100kb' }));

// --- Base de datos: SSL configurable, sin desactivar verification por defecto ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 8000,
  ssl: process.env.DATABASE_SSL === 'false'
    ? false
    : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' },
});

// --- Autenticación simple por token para todas las rutas /api ---
function requireApiKey(req, res, next) {
  const expected = process.env.API_TOKEN;
  if (!expected) {
    return res.status(500).json({ error: 'API_TOKEN no configurado en el servidor' });
  }
  const provided = req.get('x-api-key') || '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'invitafigus-api' }));

// Webhook de MercadoPago: sin API key, validado por firma HMAC con MP_WEBHOOK_SECRET.
app.post('/webhooks/mercadopago', async (req, res) => {
  const paymentId = req.body?.data?.id || req.body?.id;
  if (!paymentId) return res.status(400).json({ error: 'Sin id de pago' });
  if (!mercadopago.verifyWebhookSignature(
    req.get('x-signature'), req.get('x-request-id'), String(paymentId), req.body,
  )) return res.status(401).json({ error: 'Firma inválida' });
  try {
    const payment = await mercadopago.getPayment(paymentId);
    if (mercadopago.isApproved(payment) && payment.code) {
      await paymentStore.markPaid(payment.code, payment.id, payment.amount);
    }
    return res.json({ received: true });
  } catch (err) {
    console.error('Webhook MP:', err.message);
    return res.status(502).json({ error: 'No se pudo consultar MercadoPago' });
  }
});

app.use('/api', requireApiKey);

// --- Pagos: el frontend NUNCA marca un pedido como pagado por haber abierto el link ---
app.post('/api/payments/start', async (req, res) => {
  const code = String(req.body?.code || '').trim();
  const amount = Number(req.body?.amount) || 10000;
  if (!/^[a-z0-9-]{3,120}$/i.test(code)) return res.status(400).json({ error: 'Código inválido' });
  try {
    return res.status(201).json(await paymentStore.start(code, amount));
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo iniciar el registro de pago' });
  }
});

app.get('/api/payments/status', async (req, res) => {
  const code = String(req.query.code || '');
  if (!/^[a-z0-9-]{3,120}$/i.test(code)) return res.status(400).json({ error: 'Código inválido' });
  try {
    const row = await paymentStore.get(code);
    return res.json({ status: row?.status || 'unknown', paymentId: row?.paymentId || null });
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo consultar el estado' });
  }
});

app.post('/api/payments/verify', async (req, res) => {
  const code = String(req.body?.code || '').trim();
  const paymentId = String(req.body?.paymentId || '').trim();
  if (!/^[a-z0-9-]{3,120}$/i.test(code)) return res.status(400).json({ error: 'Código inválido' });
  if (!/^\d{5,20}$/.test(paymentId)) return res.status(400).json({ error: 'ID de pago inválido' });
  try {
    const payment = await mercadopago.getPayment(paymentId);
    if (payment.status === 'unconfigured') {
      return res.json({ status: 'manual', message: 'Verificación automática no configurada' });
    }
    if (payment.status === 'not_found') return res.json({ status: 'not_found' });
    if (payment.code && payment.code !== code) return res.json({ status: 'mismatch' });
    if (!mercadopago.isApproved(payment)) return res.json({ status: payment.status || 'pending' });
    await paymentStore.markPaid(code, payment.id, payment.amount);
    return res.json({ status: 'paid', paymentId: payment.id });
  } catch (err) {
    console.error('Verificación MP:', err.message);
    return res.status(502).json({ error: 'No se pudo verificar con MercadoPago' });
  }
});

app.post('/api/invitations', async (req, res) => {
  const { name, age, team, playerName, eventDate, eventTime, eventLocation, parentPhone, paid } = req.body || {};
  if (!name || !eventDate) {
    return res.status(400).json({ error: 'name y eventDate son obligatorios' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO invitations
       (name, age, team, player_name, event_date, event_time, event_location, parent_phone, paid, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       RETURNING *`,
      [name, age, team, playerName, eventDate, eventTime, eventLocation, parentPhone, paid || false],
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating invitation:', error.message);
    return res.status(500).json({ error: 'Error creating invitation' });
  }
});

app.get('/api/invitations', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM invitations ORDER BY created_at DESC');
    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching invitations:', error.message);
    return res.status(500).json({ error: 'Error fetching invitations' });
  }
});

app.get('/api/invitations/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM invitations WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Invitation not found' });
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching invitation:', error.message);
    return res.status(500).json({ error: 'Error fetching invitation' });
  }
});

// --- RSVP: persistencia real (PostgreSQL o archivo local en desarrollo) ---
function validateRSVP(body) {
  const slug = String(body?.slug || '').trim();
  const name = String(body?.name || '').trim();
  const phone = String(body?.phone || '').replace(/\D/g, '');
  const status = String(body?.status || '');
  const guests = Number(body?.guests || 0);
  const notes = String(body?.notes || '').trim();

  if (!/^[a-z0-9-]{1,120}$/i.test(slug)) return { error: 'Slug inválido' };
  if (name.length < 2 || name.length > 80) return { error: 'El nombre debe tener entre 2 y 80 caracteres' };
  if (phone.length < 6 || phone.length > 20) return { error: 'El WhatsApp no es válido' };
  if (!['confirmed', 'declined'].includes(status)) return { error: 'Estado inválido' };
  if (!Number.isInteger(guests) || guests < 0 || guests > 20) return { error: 'Cantidad de acompañantes inválida' };
  if (notes.length > 300) return { error: 'La nota es demasiado larga' };

  return { value: { slug, name, phone, status, guests, notes } };
}

app.post('/api/rsvps', async (req, res) => {
  const { error, value } = validateRSVP(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const saved = await rsvpStore.createRSVP(value);
    const notified = await whatsapp.notifyRSVP({ ...value, ...saved });
    return res.status(201).json({ ok: true, rsvp: saved, notified: notified.sent, notifyReason: notified.reason });
  } catch (err) {
    console.error('Error guardando RSVP:', err.message);
    return res.status(500).json({ error: 'No se pudo guardar la confirmación' });
  }
});

app.get('/api/rsvps', async (req, res) => {
  const slug = String(req.query.slug || '');
  if (!/^[a-z0-9-]{1,120}$/i.test(slug)) return res.status(400).json({ error: 'Slug inválido' });
  try {
    return res.json(await rsvpStore.listRSVPs(slug));
  } catch (err) {
    console.error('Error leyendo RSVPs:', err.message);
    return res.status(500).json({ error: 'No se pudieron leer las confirmaciones' });
  }
});

app.get('/api/rsvps/count', async (req, res) => {
  const slug = String(req.query.slug || '');
  if (!/^[a-z0-9-]{1,120}$/i.test(slug)) return res.status(400).json({ error: 'Slug inválido' });
  try {
    const rows = await rsvpStore.listRSVPs(slug);
    const confirmed = rows.filter((row) => row.status === 'confirmed');
    return res.json({
      total: rows.length,
      confirmed: confirmed.length,
      guests: confirmed.reduce((sum, row) => sum + Number(row.guests || 0), 0),
    });
  } catch (err) {
    console.error('Error contando RSVPs:', err.message);
    return res.status(500).json({ error: 'No se pudo contar las confirmaciones' });
  }
});

async function createTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invitations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        age INTEGER,
        team VARCHAR(255),
        player_name VARCHAR(255),
        event_date VARCHAR(50),
        event_time VARCHAR(50),
        event_location VARCHAR(500),
        parent_phone VARCHAR(50),
        paid BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Table ready');
  } catch (error) {
    console.error('Error creating table:', error.message);
  }
}

const PORT = process.env.PORT || 3001;
async function bootstrap() {
  if (process.env.STORE !== 'file') await createTable();
  await rsvpStore.ensureSchema();
  await paymentStore.ensureSchema();
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT} (store: ${rsvpStore.usePostgres ? 'postgres' : 'file'})`));
}
bootstrap().catch((error) => {
  console.error('No se pudo iniciar el servidor:', error.message);
  process.exit(1);
});
