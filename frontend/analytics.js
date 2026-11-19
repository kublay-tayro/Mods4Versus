/**
 * analytics.js — Módulo de Analíticas de Mods4Versus
 * =====================================================
 *
 * IMPORTANTE — PRIVACIDAD Y CONSENTIMIENTO (OPT-OUT):
 *   Las analíticas están ACTIVADAS por defecto (modelo opt-out).
 *   El usuario puede desactivarlas en cualquier momento desde el diálogo
 *   de Ajustes mediante «Enviar estadísticas anónimas de uso».
 *   La preferencia se guarda en localStorage ('m4v_analytics_consent').
 *   Al desactivar, la cola de eventos se vacía inmediatamente y se
 *   detiene todo envío posterior.
 *
 * CONFIGURACIÓN ANTES DE DESPLEGAR:
 *   1. Reemplaza ANALYTICS_WORKER_URL con la URL real de tu Cloudflare Worker.
 *   2. El archivo queda listo para compilar sin ningún secreto embebido.
 *
 * DATOS QUE SE RECOPILAN (cuando hay consentimiento):
 *   - installation_id: UUID aleatorio persistente, generado localmente.
 *   - session_id: UUID aleatorio por sesión, regenerado en cada apertura.
 *   - Nombre de evento, versión de la app, timestamp UTC.
 *   - Propiedades del evento: recuentos, duraciones, IDs de mods del Workshop.
 *
 * DATOS QUE NUNCA SE RECOPILAN:
 *   - Steam ID, nombre de usuario, nombre del equipo, rutas del sistema.
 *   - MAC address, hardware ID, dirección IP.
 *   - Contenido de archivos VPK ni información personal de ningún tipo.
 */

(function () {
    'use strict';

    // ─── Configuración ─────────────────────────────────────────────────────────
    /** @type {string} URL del Cloudflare Worker */
    const ANALYTICS_WORKER_URL = 'https://mods4versus-analytics.jktm01.workers.dev/v1/events';

    /** Versión de la aplicación — mantener sincronizada con tauri.conf.json */
    const APP_VERSION = '1.2.2';

    /** Claves de localStorage */
    const KEYS = {
        INSTALL_ID:   'm4v_install_id',
        CONSENT:      'm4v_analytics_consent',
        LAST_VERSION: 'm4v_last_version',
    };

    /** Parámetros de la cola y envío */
    const CFG = {
        MAX_QUEUE:          50,     // máximo de eventos en memoria
        BATCH_SIZE:         10,     // eventos por petición HTTP
        FLUSH_INTERVAL_MS:  30_000, // flush periódico (30 s)
        MAX_RETRIES:        3,      // reintentos máximos por error
        RETRY_BASE_MS:      5_000,  // base de espera entre reintentos
        MAX_PROPS_BYTES:    2048,   // límite de propiedades JSON por evento
    };

    // ─── Eventos permitidos ────────────────────────────────────────────────────
    /** Solo estos nombres de evento son aceptados por el Worker */
    const ALLOWED_EVENTS = new Set([
        // Actividad
        'first_open', 'app_open', 'app_update', 'app_session_activity',
        // Gestión de mods
        'mods_scan', 'mod_selected', 'mod_deselected',
        'vpk_merge_started', 'vpk_merge_success', 'vpk_merge_error',
        // Rendimiento
        'vpk_processing_duration', 'app_error',
    ]);

    // ─── Estado interno ────────────────────────────────────────────────────────
    let _installId        = null;
    let _sessionId        = null;
    let _sessionStart     = null;
    let _queue            = [];
    let _flushTimer       = null;
    let _retries          = 0;
    let _ready            = false;
    let _activeController = null;

    // ─── Utilidades ───────────────────────────────────────────────────────────

    /** Genera un UUID v4 usando crypto.randomUUID() con fallback manual */
    function uuid() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = (Math.random() * 16) | 0;
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
    }

    function lsGet(key) {
        try { return localStorage.getItem(key); } catch { return null; }
    }
    function lsSet(key, val) {
        try { localStorage.setItem(key, val); return true; } catch { return false; }
    }

    /** Timestamp ISO 8601 UTC */
    function nowISO() { return new Date().toISOString(); }

    /**
     * Serializa las propiedades, truncando si superan el límite de bytes.
     * El Worker espera un objeto, no una cadena — no se hace stringify aquí.
     */
    function sanitizeProps(props) {
        try {
            const json = JSON.stringify(props || {});
            if (json.length > CFG.MAX_PROPS_BYTES) {
                return { _truncated: true, _original_bytes: json.length };
            }
            return props || {};
        } catch {
            return {};
        }
    }

    // ─── Identificadores ──────────────────────────────────────────────────────

    /** True si es la primera apertura (installation_id aún no existe) */
    function isFirstOpen() {
        return lsGet(KEYS.INSTALL_ID) === null;
    }

    /** Obtiene o crea el installation_id persistente */
    function getOrCreateInstallId() {
        let id = lsGet(KEYS.INSTALL_ID);
        if (!id) {
            id = uuid();
            lsSet(KEYS.INSTALL_ID, id);
        }
        return id;
    }

    /**
     * Comprueba si la versión de la app cambió respecto a la última ejecución.
     * Actualiza el valor almacenado y devuelve la versión anterior si cambió,
     * o null si no cambió (o es la primera vez).
     */
    function checkVersionChange() {
        const prev = lsGet(KEYS.LAST_VERSION);
        lsSet(KEYS.LAST_VERSION, APP_VERSION);
        return (prev && prev !== APP_VERSION) ? prev : null;
    }

    // ─── Consentimiento ───────────────────────────────────────────────────────

    function hasConsent() {
        // Opt-out: activado por defecto a menos que se haya desactivado explícitamente ('false')
        return lsGet(KEYS.CONSENT) !== 'false';
    }

    // ─── Cola de eventos ──────────────────────────────────────────────────────

    function enqueue(eventName, properties) {
        // Si no hay consentimiento, no almacenar ni encolar eventos
        if (!hasConsent()) return;

        if (!ALLOWED_EVENTS.has(eventName)) {
            console.warn('[Analytics] Evento ignorado (no permitido):', eventName);
            return;
        }
        // Descartar el evento más antiguo si la cola está llena
        if (_queue.length >= CFG.MAX_QUEUE) {
            _queue.shift();
        }
        _queue.push({
            event_id:        uuid(),
            installation_id: _installId,
            session_id:      _sessionId,
            event_name:      eventName,
            timestamp:       nowISO(),
            app_version:     APP_VERSION,
            properties:      sanitizeProps(properties),
        });
    }

    function scheduleFlush(delayMs) {
        if (_flushTimer !== null) return;
        _flushTimer = setTimeout(() => { _flushTimer = null; flush(); }, delayMs);
    }

    function workerUrlReady() {
        return !ANALYTICS_WORKER_URL.includes('REPLACE_WITH_YOUR_WORKER');
    }

    async function flush() {
        if (!hasConsent())    return;
        if (!workerUrlReady()) return;
        if (_queue.length === 0) return;

        // Extrae un lote de la cola
        const batch = _queue.splice(0, CFG.BATCH_SIZE);

        _activeController = new AbortController();

        try {
            const res = await fetch(ANALYTICS_WORKER_URL, {
                method:    'POST',
                headers:   { 'Content-Type': 'application/json' },
                body:      JSON.stringify({ batch }),
                signal:    _activeController.signal,
            });

            _activeController = null;

            // Verificar si el consentimiento cambió mientras se esperaba la respuesta HTTP
            if (!hasConsent()) return;

            if (!res.ok && res.status >= 500 && _retries < CFG.MAX_RETRIES) {
                // Solo reencolar y reintentar si el consentimiento sigue activo
                if (hasConsent()) {
                    _queue.unshift(...batch);
                    _retries++;
                    scheduleFlush(CFG.RETRY_BASE_MS * _retries);
                }
                return;
            }
            _retries = 0;

            // Si quedan eventos y hay consentimiento, programar otro flush pronto
            if (hasConsent() && _queue.length > 0) scheduleFlush(1000);

        } catch (err) {
            _activeController = null;

            // Si la petición fue abortada o el consentimiento ya no está activo, NO reencolar
            if (err.name === 'AbortError' || !hasConsent()) {
                return;
            }

            // Error de red ordinario con consentimiento activo
            if (_retries < CFG.MAX_RETRIES && hasConsent()) {
                _queue.unshift(...batch);
                _retries++;
                scheduleFlush(CFG.RETRY_BASE_MS * _retries);
            }
            // Si se agotan los reintentos, los eventos se descartan silenciosamente
        }
    }

    // ─── Inicialización ───────────────────────────────────────────────────────

    async function init() {
        if (_ready) return;
        _ready = true;

        const firstOpen  = isFirstOpen();
        _installId       = getOrCreateInstallId();
        _sessionId       = uuid();
        _sessionStart    = Date.now();
        const prevVersion = checkVersionChange();

        // Flush periódico
        setInterval(() => {
            if (hasConsent() && _queue.length > 0) flush();
        }, CFG.FLUSH_INTERVAL_MS);

        // Envío al cerrar la ventana (no bloqueante)
        window.addEventListener('beforeunload', () => {
            enqueue('app_session_activity', {
                duration_seconds: Math.round((Date.now() - _sessionStart) / 1000),
            });
            if (hasConsent() && workerUrlReady() && _queue.length > 0) {
                const payload = JSON.stringify({ batch: _queue.splice(0) });
                try {
                    navigator.sendBeacon?.(
                        ANALYTICS_WORKER_URL,
                        new Blob([payload], { type: 'application/json' })
                    );
                } catch { /* ignorar */ }
            }
        });

        // Eventos de inicio de sesión
        if (firstOpen)   enqueue('first_open', {});
        enqueue('app_open', { is_first_open: firstOpen });
        if (prevVersion) enqueue('app_update', { from_version: prevVersion, to_version: APP_VERSION });

        // Flush inicial diferido (5 s), solo si ya hay consentimiento
        if (hasConsent()) scheduleFlush(5000);
    }

    // ─── API pública ──────────────────────────────────────────────────────────

    /**
     * Registra un evento. Debe llamarse después de Analytics.init().
     * No hace nada si no hay consentimiento (los eventos no se envían).
     * Los eventos se encolan internamente igualmente para no perder datos
     * si el consentimiento se otorga después durante la misma sesión.
     *
     * @param {string} eventName - Nombre del evento (debe estar en ALLOWED_EVENTS)
     * @param {object} [properties] - Propiedades adicionales del evento
     */
    function track(eventName, properties) {
        if (!_ready) {
            console.warn('[Analytics] track() llamado antes de init()');
            return;
        }
        enqueue(eventName, properties);
        // Flush inmediato si se llena el lote y hay consentimiento
        if (hasConsent() && _queue.length >= CFG.BATCH_SIZE) {
            clearTimeout(_flushTimer);
            _flushTimer = null;
            flush();
        }
    }

    /**
     * Activa o desactiva la recopilación de analíticas (modelo opt-out).
     * Si se desactiva (false), cancela cualquier fetch en curso, detiene envíos
     * y vacía la cola pendiente. Al reactivar, no se recuperan eventos pasados.
     *
     * @param {boolean} value
     */
    function setConsent(value) {
        lsSet(KEYS.CONSENT, value ? 'true' : 'false');
        if (!value) {
            // Cancelar inmediatamente cualquier petición fetch en curso
            if (_activeController !== null) {
                _activeController.abort();
                _activeController = null;
            }
            // Detener inmediatamente envíos y vaciar la cola pendiente
            _queue = [];
            _retries = 0;
            if (_flushTimer !== null) {
                clearTimeout(_flushTimer);
                _flushTimer = null;
            }
        } else if (_queue.length > 0) {
            scheduleFlush(500); // enviar eventos acumulados
        }
        console.info('[Analytics] Consentimiento:', value ? 'activado' : 'desactivado');
    }

    // Exponer API global
    window.Analytics = {
        init,
        track,
        setConsent,
        hasConsent,
        getInstallationId: () => _installId,
        getSessionId:      () => _sessionId,
        // Helpers para pruebas locales (no para producción):
        _forceFlush: flush,
        _getQueue:   () => [..._queue],
        _workerReady: workerUrlReady,
    };

})();
