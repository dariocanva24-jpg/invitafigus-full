// Notificación opcional al operador vía WhatsApp Cloud API (Meta).
// Requiere una plantilla UTILITY aprobada, p. ej. invitafigus_rsvp_v1:
// "InvitaFigus · Nueva confirmación: {{1}} ({{2}} acompañantes). Código: {{3}}."

const configured = () => Boolean(
  process.env.WHATSAPP_ACCESS_TOKEN &&
  process.env.WHATSAPP_PHONE_NUMBER_ID &&
  process.env.WHATSAPP_NOTIFY_TO &&
  process.env.WHATSAPP_TEMPLATE_NAME,
)

async function notifyRSVP(rsvp) {
  if (!configured()) return { sent: false, reason: 'not_configured' }

  const version = process.env.WHATSAPP_API_VERSION || 'v23.0'
  const url = `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`
  const status = rsvp.status === 'confirmed' ? 'confirma asistencia' : 'no podrá asistir'

  const body = {
    messaging_product: 'whatsapp',
    to: process.env.WHATSAPP_NOTIFY_TO,
    type: 'template',
    template: {
      name: process.env.WHATSAPP_TEMPLATE_NAME,
      language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'es_AR' },
      components: [{
        type: 'body',
        parameters: [rsvp.name, `${rsvp.guests || 0} (${status})`, rsvp.slug]
          .map((text) => ({ type: 'text', text: String(text) })),
      }],
    },
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      // Solo logueamos el código de error, nunca los datos del invitado.
      console.error('WhatsApp notify failed:', data?.error?.code || response.status)
      return { sent: false, reason: data?.error?.code || `http_${response.status}` }
    }
    console.log('WhatsApp notify sent')
    return { sent: true, messageId: data?.messages?.[0]?.id }
  } catch (error) {
    console.error('WhatsApp notify error:', error.message)
    return { sent: false, reason: 'network_error' }
  }
}

module.exports = { notifyRSVP, configured }
