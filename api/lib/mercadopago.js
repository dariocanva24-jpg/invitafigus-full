const crypto = require('crypto');

const TOKEN = () => process.env.MP_ACCESS_TOKEN || '';
const WEBHOOK_SECRET = () => process.env.MP_WEBHOOK_SECRET || '';

// Verifica la firma del webhook de MercadoPago (x-signature ts=...,v1=...).
function verifyWebhookSignature(header, requestId, paymentId, rawBody) {
  const secret = WEBHOOK_SECRET();
  if (!secret || !header) return false;
  const parts = Object.fromEntries(
    String(header).split(',').map((chunk) => chunk.trim().split('=')).filter((pair) => pair.length === 2),
  );
  const ts = parts.ts, v1 = parts.v1;
  if (!ts || !v1) return false;
  const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const a = Buffer.from(String(v1), 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Consulta el pago a la API de MercadoPago. NUNCA devuelve "aprobado" sin esta respuesta.
async function getPayment(paymentId) {
  if (!TOKEN()) return { status: 'unconfigured' };
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${TOKEN()}` },
  });
  if (response.status === 404) return { status: 'not_found' };
  if (!response.ok) throw new Error(`MercadoPago respondió ${response.status}`);
  const data = await response.json();
  return {
    status: data.status,                     // approved | pending | rejected | cancelled | refunded
    amount: data.transaction_amount,
    code: data.external_reference || '',
    currencyId: data.currency_id,
    id: String(data.id),
  };
}

const isApproved = (payment) =>
  payment.status === 'approved' &&
  ( payment.currencyId === 'ARS' || !payment.currencyId) &&
  (!payment.code || !payment.amount || payment.amount >= 9500);

module.exports = { getPayment, isApproved, verifyWebhookSignature, hasToken: () => Boolean(TOKEN()) };
