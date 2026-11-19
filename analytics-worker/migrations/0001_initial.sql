-- Mods4Versus Analytics — Migración inicial D1
-- Ejecutar con: wrangler d1 migrations apply mods4versus-analytics

-- Tabla principal de eventos de analíticas
CREATE TABLE IF NOT EXISTS events (
    -- Identificador autoincremental interno (no expuesto)
    id              INTEGER PRIMARY KEY AUTOINCREMENT,

    -- UUID v4 generado por el cliente — UNIQUE garantiza deduplicación
    event_id        TEXT NOT NULL UNIQUE,

    -- UUID v4 persistente por instalación (generado localmente, no vinculado a ningún usuario)
    installation_id TEXT NOT NULL,

    -- UUID v4 generado en cada apertura de la aplicación
    session_id      TEXT NOT NULL,

    -- Nombre del evento (validado contra lista permitida en el Worker)
    event_name      TEXT NOT NULL,

    -- Timestamp UTC en formato ISO 8601 enviado por el cliente
    timestamp       TEXT NOT NULL,

    -- Versión de la aplicación (ej. "1.2.0")
    app_version     TEXT NOT NULL DEFAULT 'unknown',

    -- País derivado de la IP por Cloudflare — la IP nunca se almacena
    country         TEXT,

    -- Propiedades adicionales del evento en formato JSON
    properties      TEXT,

    -- Timestamp de recepción en el servidor (UTC, generado por SQLite)
    received_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Índices para las consultas más frecuentes del dashboard
CREATE INDEX IF NOT EXISTS idx_events_name         ON events(event_name);
CREATE INDEX IF NOT EXISTS idx_events_installation ON events(installation_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_timestamp    ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_version      ON events(app_version);
CREATE INDEX IF NOT EXISTS idx_events_country      ON events(country);
CREATE INDEX IF NOT EXISTS idx_events_received     ON events(received_at);
