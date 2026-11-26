# InvitaFigus + InvitaStudio — entrega completa

Todo está implementado, build OK y commiteado localmente. **No se hizo push** (no hay credenciales de GitHub en esta sesión). El ZIP trae los parches aplicables y los archivos de la API.

## Contenido

- `figus/` — 6 patches para `dariocanva24-jpg/invitafigus` (seguridad, visual, RSVP, tags WhatsApp, tarjeta Alma, fix de pago + fotos).
- `studio/` — 1 patch para `dariostone31-pixel/invitastudio` (tags WhatsApp + link recíproco).
- `api/` — archivos completos para `dariocanva24-jpg/invitafigus-api` (seguridad, RSVP, WhatsApp, verificación de pago).
- `fotos-originales/` — las 4 fotos generadas antes de convertir a WebP.

## Aplicar

```bash
# Extraé el ZIP primero.

# InvitaFigus
git clone https://github.com/dariocanva24-jpg/invitafigus.git
cd invitafigus
git am /ruta/invitafigus-completo/figus/*.patch
git push origin main

# InvitaStudio
git clone https://github.com/dariostone31-pixel/invitastudio.git
cd invitastudio
git am /ruta/invitafigus-completo/studio/*.patch
git push origin main

# API (los patches de node_modules pesan ~108 MB; mejor copiar archivos)
git clone https://github.com/dariocanva24-jpg/invitafigus-api.git
cd invitafigus-api
cp -r /ruta/invitafigus-completo/api/. .
git rm -r --cached node_modules
git add -A
git commit -m "security + RSVP + WhatsApp + pago verificado"
git push origin main
```

Si `git am` da conflictos: `git am --abort`, `git pull`, y volvé a intentar.

## Qué quedó arreglado

1. **Falso éxito de pago**: abrir MercadoPago ya NO muestra "pedido recibido". Ahora dice *"Tu figurita está lista… el pago todavía NO fue acreditado"*. Hay un campo para el número de operación y un botón **Verificar pago** que consulta la API de MercadoPago. Solo se muestra "¡Pago confirmado!" si MP devuelve `approved`. Sin `MP_ACCESS_TOKEN`, la UI ofrece enviar el comprobante por WhatsApp con `[InvitaFigus · PAGO]`.
2. **Webhook** `POST /webhooks/mercadopago` con firma HMAC (`MP_WEBHOOK_SECRET`) y consulta al pago; solo marca `paid` si coincide el `external_reference` con el slug. Para que funcione, crear las preferencias con `external_reference = slug`.
3. **Enlace a Invita con el Alma**: tarjeta marfil/dorado con isotipo SVG solo en la pantalla posterior al checkout y mención sobria en el footer. El link usa `VITE_ALMA_URL` (default `https://invitastudio-vert.vercel.app`) y abre con `target="_blank" rel="noopener noreferrer"`.
4. **Fotos reales**: los 4 ejemplos (`thiago`, `benicio`, `zoe`, `lautaro`) son retratos foto-realistas generados con IA, no caricaturas. 512×512 WebP, 26–48 KB cada una.
5. **Tags de WhatsApp intactos**: `[InvitaFigus · INTENCIÓN]` e `[InvitaStudio · INTENCIÓN]`.

## Variables nuevas en producción

- Frontend (Vercel): `VITE_ALMA_URL=https://invitastudio-vert.vercel.app`
- API: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` (opcionales; sin ellos el flujo queda en verificación manual).
- API: `CORS_ORIGIN` debe incluir `https://invitafigus.vercel.app`.

## Pendiente de seguridad (importante)

El `.env` con credenciales reales sigue en el historial público del repo de la API. **Rotar la contraseña de PostgreSQL** y, si se quiere limpiar el historial, usar `git filter-repo` antes de que otras personas clonen el repo. Las instrucciones básicas están en el README de la API.
