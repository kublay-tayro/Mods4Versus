# Guía de despliegue — Mods4Versus Analytics

## Requisitos previos

- Cuenta de Cloudflare (plan gratuito es suficiente)
- Node.js 18+ instalado
- Wrangler CLI: `npm install -g wrangler`

---

## Paso 1 — Autenticarse en Cloudflare

```bash
wrangler login
```

---

## Paso 2 — Crear la base de datos D1

```bash
wrangler d1 create mods4versus-analytics
```

Cloudflare devolverá algo como:

```
✅ Successfully created DB 'mods4versus-analytics'
{
  "uuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  ...
}
```

Copia el UUID y pégalo en `analytics-worker/wrangler.toml`:

```toml
[[d1_databases]]
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   # ← aquí
```

---

## Paso 3 — Aplicar la migración SQL

```bash
cd analytics-worker
wrangler d1 migrations apply mods4versus-analytics
```

Verificar que la tabla existe:

```bash
wrangler d1 execute mods4versus-analytics --command "SELECT name FROM sqlite_master WHERE type='table';"
```

---

## Paso 4 — Configurar el secreto del dashboard

```bash
wrangler secret put DASHBOARD_SECRET
```

Escribe una contraseña segura (mínimo 20 caracteres aleatorios recomendado). Este secreto se inyecta en `env.DASHBOARD_SECRET` dentro del Worker; **nunca** aparece en el código fuente.

Guarda esta contraseña en un gestor de contraseñas — la necesitarás para acceder al dashboard.

---

## Paso 5 — Desplegar el Worker

```bash
cd analytics-worker
wrangler deploy
```

Cloudflare devolverá la URL del Worker:

```
✅ Deployed mods4versus-analytics to https://mods4versus-analytics.TU-SUBDOMINIO.workers.dev
```

---

## Paso 6 — Actualizar URLs en el frontend

Abre `frontend/analytics.js` y reemplaza:

```js
// Antes:
const ANALYTICS_WORKER_URL = 'https://REPLACE_WITH_YOUR_WORKER.workers.dev/v1/events';

// Después:
const ANALYTICS_WORKER_URL = 'https://mods4versus-analytics.TU-SUBDOMINIO.workers.dev/v1/events';
```

Abre `analytics-dashboard/app.js` y reemplaza:

```js
// Antes:
const WORKER_BASE_URL = 'https://REPLACE_WITH_YOUR_WORKER.workers.dev';

// Después:
const WORKER_BASE_URL = 'https://mods4versus-analytics.TU-SUBDOMINIO.workers.dev';
```

---

## Paso 7 — Ajustar la CSP de Tauri (opcional, pero recomendado)

Una vez conoces la URL exacta del Worker, abre `src-tauri/tauri.conf.json` y sustituye el wildcard `*.workers.dev` por tu dominio específico:

```json
"connect-src": "'self' https://mods4versus-analytics.TU-SUBDOMINIO.workers.dev"
```

Esto reduce la superficie de la CSP al mínimo necesario.

---

## Paso 8 — Recompilar y distribuir la aplicación

```bash
npm run build
```

---

## Paso 9 — Verificar que el Worker recibe eventos

Envía un evento de prueba manualmente:

```bash
curl -X POST https://mods4versus-analytics.TU-SUBDOMINIO.workers.dev/v1/events \
  -H "Content-Type: application/json" \
  -d '{
    "batch": [{
      "event_id":        "00000000-0000-4000-8000-000000000001",
      "installation_id": "00000000-0000-4000-8000-000000000002",
      "session_id":      "00000000-0000-4000-8000-000000000003",
      "event_name":      "app_open",
      "timestamp":       "2026-01-01T00:00:00.000Z",
      "app_version":     "1.2.0",
      "properties":      { "is_first_open": false }
    }]
  }'
```

Respuesta esperada: `{"accepted":1,"rejected":0}`

Verificar en D1:

```bash
wrangler d1 execute mods4versus-analytics --command "SELECT * FROM events LIMIT 5;"
```

---

## Paso 10 — Abrir el dashboard

Abre `analytics-dashboard/index.html` directamente en el navegador (doble clic) e introduce el `DASHBOARD_SECRET` configurado en el Paso 4.

Opcionalmente puedes desplegarlo en Cloudflare Pages para acceder desde cualquier lugar:

```bash
cd analytics-dashboard
wrangler pages deploy . --project-name mods4versus-dashboard
```

---

## Pruebas locales con Wrangler Dev

```bash
cd analytics-worker
wrangler dev --local
```

El Worker estará disponible en `http://localhost:8787`. Actualiza temporalmente `ANALYTICS_WORKER_URL` en `analytics.js` para apuntar a `http://localhost:8787/v1/events` durante el desarrollo.

---

## Límites del plan gratuito de Cloudflare

| Recurso | Límite gratuito | Notas |
|---|---|---|
| Workers — requests/día | 100,000 | ~100k eventos diarios; reinicia cada 24h |
| Workers — CPU por request | 10ms | Suficiente para validación + D1 batch |
| D1 — lecturas/día | 5,000,000 | Holgado para dashboard privado |
| D1 — escrituras/día | 100,000 | Equivale a ~100k eventos/día |
| D1 — almacenamiento | 5 GB | Miles de millones de eventos |
| Workers KV | No requerido | No se usa en esta implementación |

**¿Qué ocurre si se superan los límites?**
- Workers devuelve `429 Too Many Requests` durante el resto del día.
- El cliente de analíticas (`analytics.js`) lo trata como error de red: descarta los eventos tras 3 reintentos sin bloquear la aplicación.
- La app Mods4Versus sigue funcionando con normalidad.
- Si el volumen crece consistentemente, el plan Workers Paid (\$5/mes) eleva los límites a 10M requests/mes.

---

## Configuración de retención y consentimiento aplicada

### 1. Modelo de consentimiento: Opt-out (activado por defecto)
- Las analíticas están **activadas por defecto** en la primera apertura.
- El usuario puede desactivarlas en cualquier momento desde el botón **AJUSTES** en la interfaz («Enviar estadísticas anónimas de uso»).
- Si se desactiva, la cola en memoria se vacía al instante y se detienen todos los envíos posteriores.
- La preferencia se guarda en `localStorage` (`m4v_analytics_consent = 'false'`) y persiste entre sesiones.

### 2. Período de retención: 90 días (Cron Trigger automático)
- Se ha configurado en `wrangler.toml` un Cron Trigger diario a las 03:00 UTC (`0 3 * * *`).
- El método `scheduled()` en `src/index.js` ejecuta:
  ```sql
  DELETE FROM events WHERE timestamp < datetime('now', '-90 days');
  ```
  manteniendo la base de datos D1 acotada y optimizada automáticamente.
