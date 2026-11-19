/**
 * Mods4Versus Analytics — Cloudflare Worker
 * ==========================================
 * Recibe eventos de analíticas de la app Mods4Versus (Tauri v2),
 * los valida y los almacena en Cloudflare D1.
 *
 * Endpoints públicos:
 *   POST /v1/events           — recibe lote de eventos
 *
 * Endpoints privados (requieren Authorization: Bearer <DASHBOARD_SECRET>):
 *   GET /v1/stats/overview
 *   GET /v1/stats/active-users
 *   GET /v1/stats/installations
 *   GET /v1/stats/mods
 *   GET /v1/stats/errors
 *   GET /v1/stats/geography
 *   GET /v1/stats/versions
 *   GET /v1/stats/retention
 *   GET /v1/stats/session-duration
 *   GET /v1/stats/vpk-stats
 *
 * Variables de entorno requeridas:
 *   DB               — binding de Cloudflare D1 (definido en wrangler.toml)
 *   DASHBOARD_SECRET — secreto para acceso al dashboard (wrangler secret put)
 */

// ─── Constantes de validación ────────────────────────────────────────────────

const ALLOWED_EVENTS = new Set([
    'first_open', 'app_open', 'app_update', 'app_session_activity',
    'mods_scan', 'mod_selected', 'mod_deselected',
    'vpk_merge_started', 'vpk_merge_success', 'vpk_merge_error',
    'vpk_processing_duration', 'app_error',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BATCH        = 50;
const MAX_BODY_BYTES   = 102_400; // 100 KB
const MAX_VERSION_LEN  = 20;

// ─── Orígenes permitidos ─────────────────────────────────────────────────────

const TAURI_ORIGINS = new Set([
    'tauri://localhost',
    'https://tauri.localhost',
    'http://tauri.localhost',
]);

// ─── Entry point ─────────────────────────────────────────────────────────────

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // Preflight CORS
        if (request.method === 'OPTIONS') {
            return corsResponse(request, new Response(null, { status: 204 }));
        }

        // Enrutamiento
        if (url.pathname === '/v1/events' && request.method === 'POST') {
            return corsResponse(request, await handleEvents(request, env));
        }

        if (url.pathname.startsWith('/v1/stats/') && request.method === 'GET') {
            if (!checkAuth(request, env)) {
                return corsResponse(request, json({ error: 'Unauthorized' }, 401));
            }
            return corsResponse(request, await handleStats(url, request, env));
        }

        return corsResponse(request, json({ error: 'Not Found' }, 404));
    },

    // ─── Cron Trigger: Purga automática de eventos con más de 90 días ────────
    async scheduled(event, env, ctx) {
        try {
            // datetime(timestamp) normaliza ISO 8601 para compararlo exactamente con datetime('now', '-90 days') en UTC
            const result = await env.DB.prepare(
                "DELETE FROM events WHERE datetime(timestamp) < datetime('now', '-90 days')"
            ).run();
            console.log(`[Purge] Purga (>90 días) completada. Filas eliminadas: ${result.meta?.changes ?? 0}`);
        } catch (err) {
            console.error('[Purge] Error eliminando eventos antiguos:', err);
        }
    },
};

// ─── CORS ─────────────────────────────────────────────────────────────────────

function corsHeaders(request) {
    const origin = request.headers.get('Origin') || '';
    // Permitir orígenes de Tauri para el endpoint de eventos
    // Para el dashboard (abierto como archivo local) permitimos *
    const allowOrigin = TAURI_ORIGINS.has(origin) ? origin : '*';
    return {
        'Access-Control-Allow-Origin':  allowOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age':       '86400',
    };
}

function corsResponse(request, response) {
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(corsHeaders(request))) {
        headers.set(k, v);
    }
    return new Response(response.body, {
        status:     response.status,
        statusText: response.statusText,
        headers,
    });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function checkAuth(request, env) {
    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) return false;
    const token = auth.slice(7).trim();
    if (!env.DASHBOARD_SECRET) return false;

    return constantTimeEqual(token, env.DASHBOARD_SECRET);
}

/**
 * Comparación en tiempo constante para mitigar ataques de temporización (timing attacks).
 * Itera todos los caracteres sin retorno anticipado (short-circuit).
 */
function constantTimeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

function isValidUUID(str) {
    return typeof str === 'string' && UUID_RE.test(str);
}

function isValidISO(str) {
    if (typeof str !== 'string') return false;
    const d = new Date(str);
    return !isNaN(d.getTime());
}

function getDateParam(url, key, fallback) {
    const val = url.searchParams.get(key);
    if (!val || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return fallback;

    const parts = val.split('-');
    const year  = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day   = parseInt(parts[2], 10);

    // Rango lógico
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) {
        return fallback;
    }

    // Validación de fecha real de calendario (evita 31 de febrero, etc.)
    const d = new Date(Date.UTC(year, month - 1, day));
    if (
        d.getUTCFullYear() !== year ||
        d.getUTCMonth() !== month - 1 ||
        d.getUTCDate() !== day
    ) {
        return fallback;
    }

    return val;
}

// ─── POST /v1/events ─────────────────────────────────────────────────────────

async function handleEvents(request, env) {
    // Verificar tamaño del body
    const contentLength = parseInt(request.headers.get('Content-Length') || '0');
    if (contentLength > MAX_BODY_BYTES) {
        return json({ error: 'Payload too large' }, 413);
    }

    let body;
    try {
        const text = await request.text();
        if (text.length > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413);
        body = JSON.parse(text);
    } catch {
        return json({ error: 'Invalid JSON' }, 400);
    }

    if (!Array.isArray(body?.batch)) {
        return json({ error: 'Missing or invalid "batch" array' }, 400);
    }

    const batch = body.batch.slice(0, MAX_BATCH);
    const country = request.cf?.country || null;

    let accepted = 0;
    let rejected = 0;

    // Validar y preparar inserciones
    const validEvents = [];
    for (const e of batch) {
        if (!validateEvent(e)) { rejected++; continue; }
        validEvents.push({
            event_id:        e.event_id,
            installation_id: e.installation_id,
            session_id:      e.session_id,
            event_name:      e.event_name,
            timestamp:       new Date(e.timestamp).toISOString(),
            app_version:     String(e.app_version || 'unknown').slice(0, MAX_VERSION_LEN),
            country:         country,
            properties:      JSON.stringify(e.properties || {}),
        });
        accepted++;
    }

    // Insertar en D1 usando batch (INSERT OR IGNORE para deduplicación por event_id)
    if (validEvents.length > 0) {
        try {
            const stmts = validEvents.map(e =>
                env.DB.prepare(
                    `INSERT OR IGNORE INTO events
                     (event_id, installation_id, session_id, event_name, timestamp,
                      app_version, country, properties)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    e.event_id, e.installation_id, e.session_id, e.event_name,
                    e.timestamp, e.app_version, e.country, e.properties
                )
            );
            await env.DB.batch(stmts);
        } catch (err) {
            console.error('D1 batch insert error:', err);
            return json({ error: 'Database error' }, 500);
        }
    }

    return json({ accepted, rejected });
}

function validateEvent(e) {
    if (!e || typeof e !== 'object')             return false;
    if (!isValidUUID(e.event_id))               return false;
    if (!isValidUUID(e.installation_id))        return false;
    if (!isValidUUID(e.session_id))             return false;
    if (!ALLOWED_EVENTS.has(e.event_name))      return false;
    if (!isValidISO(e.timestamp))               return false;
    if (typeof e.app_version !== 'string')      return false;
    return true;
}

// ─── GET /v1/stats/* ─────────────────────────────────────────────────────────

async function handleStats(url, request, env) {
    const segment = url.pathname.replace('/v1/stats/', '');
    const today   = new Date().toISOString().split('T')[0];
    const ago30   = new Date(Date.now() - 30 * 86400_000).toISOString().split('T')[0];
    const from    = getDateParam(url, 'from', ago30);
    const to      = getDateParam(url, 'to',   today);
    const limit   = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);

    try {
        switch (segment) {
            case 'overview':         return json(await statsOverview(env, from, to));
            case 'active-users':     return json(await statsActiveUsers(env, from, to));
            case 'installations':    return json(await statsInstallations(env, from, to));
            case 'mods':             return json(await statsMods(env, from, to, limit));
            case 'errors':           return json(await statsErrors(env, from, to, limit));
            case 'geography':        return json(await statsGeography(env, from, to));
            case 'versions':         return json(await statsVersions(env, from, to));
            case 'retention':        return json(await statsRetention(env));
            case 'session-duration': return json(await statsSessionDuration(env, from, to));
            case 'vpk-stats':        return json(await statsVPK(env, from, to));
            default:                 return json({ error: 'Unknown stat' }, 404);
        }
    } catch (err) {
        console.error('Stats error:', segment, err);
        return json({ error: 'Query failed' }, 500);
    }
}

// ─── Consultas de estadísticas ───────────────────────────────────────────────

async function statsOverview(env, from, to) {
    const r = await env.DB.batch([
        env.DB.prepare(`SELECT COUNT(DISTINCT installation_id) AS v FROM events WHERE event_name='first_open'`),
        env.DB.prepare(`SELECT COUNT(DISTINCT installation_id) AS v FROM events WHERE date(timestamp)=date('now')`),
        env.DB.prepare(`SELECT COUNT(DISTINCT installation_id) AS v FROM events WHERE timestamp >= date('now','-7 days')`),
        env.DB.prepare(`SELECT COUNT(DISTINCT installation_id) AS v FROM events WHERE timestamp >= date('now','-30 days')`),
        env.DB.prepare(`SELECT COUNT(*) AS v FROM events WHERE event_name='vpk_merge_success'`),
        env.DB.prepare(`SELECT COUNT(*) AS v FROM events WHERE event_name='vpk_merge_error'`),
        env.DB.prepare(`SELECT COUNT(*) AS v FROM events`),
    ]);
    const [installs, dau, wau, mau, mergesOk, mergesFail, total] = r.map(x => x.results[0]?.v ?? 0);
    const totalMerges = mergesOk + mergesFail;
    return {
        total_installations: installs,
        dau, wau, mau,
        total_merges:        totalMerges,
        successful_merges:   mergesOk,
        failed_merges:       mergesFail,
        merge_success_rate:  totalMerges > 0 ? Math.round((mergesOk / totalMerges) * 100) : null,
        total_events:        total,
    };
}

async function statsActiveUsers(env, from, to) {
    const { results } = await env.DB.prepare(
        `SELECT date(timestamp) AS date, COUNT(DISTINCT installation_id) AS dau
         FROM events
         WHERE timestamp >= ? AND timestamp <= ? || 'T23:59:59Z'
         GROUP BY date(timestamp)
         ORDER BY date ASC`
    ).bind(from, to).all();
    return results;
}

async function statsInstallations(env, from, to) {
    const { results } = await env.DB.prepare(
        `SELECT date(timestamp) AS date, COUNT(*) AS count
         FROM events
         WHERE event_name='first_open'
           AND timestamp >= ? AND timestamp <= ? || 'T23:59:59Z'
         GROUP BY date(timestamp)
         ORDER BY date ASC`
    ).bind(from, to).all();
    return results;
}

async function statsMods(env, from, to, limit) {
    const { results } = await env.DB.prepare(
        `SELECT
           json_extract(properties, '$.mod_id')    AS mod_id,
           json_extract(properties, '$.mod_title') AS mod_title,
           COUNT(*) AS selections
         FROM events
         WHERE event_name='mod_selected'
           AND timestamp >= ? AND timestamp <= ? || 'T23:59:59Z'
         GROUP BY json_extract(properties, '$.mod_id')
         ORDER BY selections DESC
         LIMIT ?`
    ).bind(from, to, limit).all();
    return results;
}

async function statsErrors(env, from, to, limit) {
    const { results } = await env.DB.prepare(
        `SELECT
           json_extract(properties, '$.error_type') AS error_type,
           COUNT(*) AS count
         FROM events
         WHERE event_name='app_error'
           AND timestamp >= ? AND timestamp <= ? || 'T23:59:59Z'
         GROUP BY json_extract(properties, '$.error_type')
         ORDER BY count DESC
         LIMIT ?`
    ).bind(from, to, limit).all();
    return results;
}

async function statsGeography(env, from, to) {
    const { results } = await env.DB.prepare(
        `SELECT
           country,
           COUNT(DISTINCT installation_id) AS installations,
           COUNT(DISTINCT session_id)      AS sessions
         FROM events
         WHERE timestamp >= ? AND timestamp <= ? || 'T23:59:59Z'
           AND country IS NOT NULL
         GROUP BY country
         ORDER BY installations DESC`
    ).bind(from, to).all();
    return results;
}

async function statsVersions(env, from, to) {
    const { results } = await env.DB.prepare(
        `SELECT
           app_version,
           COUNT(DISTINCT installation_id) AS installations,
           COUNT(DISTINCT session_id)      AS sessions,
           SUM(CASE WHEN event_name='vpk_merge_success' THEN 1 ELSE 0 END) AS merges
         FROM events
         WHERE timestamp >= ? AND timestamp <= ? || 'T23:59:59Z'
         GROUP BY app_version
         ORDER BY installations DESC`
    ).bind(from, to).all();
    return results;
}

async function statsRetention(env) {
    // Cohorte: instalaciones de los últimos 30 días
    // D1: activos al día siguiente de la primera apertura
    // D7: activos 7 días después
    // D30: activos 30 días después
    const sql = (days) => `
        SELECT
            CAST(SUM(retained) AS REAL) / NULLIF(COUNT(*), 0) * 100 AS rate
        FROM (
            SELECT
                f.installation_id,
                CASE WHEN EXISTS (
                    SELECT 1 FROM events a
                    WHERE a.installation_id = f.installation_id
                      AND a.event_name = 'app_open'
                      AND date(a.timestamp) >= date(f.first_seen, '+${days} days')
                ) THEN 1 ELSE 0 END AS retained
            FROM (
                SELECT installation_id, MIN(timestamp) AS first_seen
                FROM events WHERE event_name='first_open'
                GROUP BY installation_id
            ) f
            WHERE first_seen >= date('now', '-60 days')
        )`;

    const r = await env.DB.batch([
        env.DB.prepare(sql(1)),
        env.DB.prepare(sql(7)),
        env.DB.prepare(sql(30)),
    ]);
    return {
        d1_rate:  Math.round(r[0].results[0]?.rate ?? 0),
        d7_rate:  Math.round(r[1].results[0]?.rate ?? 0),
        d30_rate: Math.round(r[2].results[0]?.rate ?? 0),
    };
}

async function statsSessionDuration(env, from, to) {
    const { results } = await env.DB.prepare(
        `SELECT json_extract(properties, '$.duration_seconds') AS secs
         FROM events
         WHERE event_name='app_session_activity'
           AND timestamp >= ? AND timestamp <= ? || 'T23:59:59Z'
           AND secs IS NOT NULL AND secs > 0 AND secs < 86400`
    ).bind(from, to).all();

    if (results.length === 0) return { avg: null, p50: null, p90: null, samples: 0 };

    const vals = results.map(r => Number(r.secs)).sort((a, b) => a - b);
    const avg  = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
    const p50  = vals[Math.floor(vals.length * 0.5)];
    const p90  = vals[Math.floor(vals.length * 0.9)];
    return { avg, p50, p90, samples: vals.length };
}

async function statsVPK(env, from, to) {
    const r = await env.DB.batch([
        env.DB.prepare(
            `SELECT AVG(CAST(json_extract(properties,'$.mod_count') AS REAL)) AS avg_mods
             FROM events WHERE event_name='vpk_merge_started'
             AND timestamp >= ? AND timestamp <= ? || 'T23:59:59Z'`
        ).bind(from, to),
        env.DB.prepare(
            `SELECT COUNT(*) AS ok FROM events WHERE event_name='vpk_merge_success'
             AND timestamp >= ? AND timestamp <= ? || 'T23:59:59Z'`
        ).bind(from, to),
        env.DB.prepare(
            `SELECT COUNT(*) AS fail FROM events WHERE event_name='vpk_merge_error'
             AND timestamp >= ? AND timestamp <= ? || 'T23:59:59Z'`
        ).bind(from, to),
    ]);
    const avg   = r[0].results[0]?.avg_mods;
    const ok    = r[1].results[0]?.ok ?? 0;
    const fail  = r[2].results[0]?.fail ?? 0;
    const total = ok + fail;
    return {
        avg_mods_per_merge:  avg ? Math.round(avg * 10) / 10 : null,
        merge_success_rate:  total > 0 ? Math.round((ok / total) * 100) : null,
        total_merges_period: total,
    };
}
