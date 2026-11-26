# InvitaFigus API

Backend Express + PostgreSQL. **La UI today todavía no usa esta API**: usa Google Apps Script/Sheets. Esta API es la base para la migración.

## Arranque

```bash
cp .env.example .env   # completar valores reales
npm install
npm start
```

`GET /health` es público. Todas las rutas `/api/*` requieren header `x-api-key` con `API_TOKEN`.

## ⚠️ Pasos de contención pendientes (lector de este repo)

El repo público contenía `.env` con credenciales reales y `node_modules` versionados. Ya se agregaron a `.gitignore` y se sacaron del índice, **pero el historial de Git todavía los tiene**. Con permisos de push, ejecutar:

```bash
# 1) ROTAR la contraseña de la DB en el proveedor YA (la actual se considera comprometida)
# 2) Limpiar historial (esto reescribe commits; coordinar con otros colaboradores)
pip install git-filter-repo   # o: brew install git-filter-repo
git filter-repo --path .env --invert-paths
git filter-repo --path node_modules --invert-paths
git push origin --force --all
git push origin --force --tags
# 3) Regenerar API_TOKEN y CORS_ORIGIN en el entorno de deploy
```

Alternativa con BFG:

```bash
bfg --delete-files .env --delete-folders node_modules
git push --force
```

Después de rotar, verificar que la URL pública del repo ya no devuelve el archivo `.env`.

## Cambios de seguridad aplicados

- `.gitignore` con `.env`, `.env.*`, `node_modules/`.
- CORS restringido a `CORS_ORIGIN` (antes: abierto).
- `API_TOKEN` obligatorio con comparación timing-safe en `/api/*`.
- `pg` agregado correctamente a dependencias (antes `require('pg')` fallaba en install limpio).
- SSL con verificación activada por defecto; se puede relajar explícitamente con variables de entorno.
- Errores: se loguea `error.message`, nunca el objeto completo (evita filtrar la connection string).

## Verificación de pagos (MercadoPago)

`POST /api/payments/start` registra la intención de pago con estado `pending` usando el `slug` como código.
Abrir el link de pago **nunca** marca el pedido como pagado.

Para verificación automática:

1. Configurar `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET`.
2. Crear las preferencias de pago con `external_reference` igual al `slug` de la invitación.
3. Registrar en MercadoPago el webhook `https://TU-API/webhooks/mercadopago` (eventos `payment`).
4. El usuario también puede pegar el número de operación en la pantalla posterior al checkout;
   `POST /api/payments/verify` consulta `GET /v1/payments/{id}` y solo aprueba si `status=approved`.

Sin esas variables el endpoint devuelve `status: manual` y la UI pide el comprobante por WhatsApp
con el prefijo `[InvitaFigus · PAGO]`. Nunca se muestra "pago confirmado" sin respuesta de MercadoPago.
