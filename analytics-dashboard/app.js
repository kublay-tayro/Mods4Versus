/**
 * Mods4Versus Analytics Dashboard — Lógica de la aplicación
 *
 * CONFIGURACIÓN:
 *   Reemplaza WORKER_BASE_URL con la URL de tu Cloudflare Worker desplegado.
 */

const WORKER_BASE_URL = 'https://mods4versus-analytics.jktm01.workers.dev';
const TOKEN_KEY = 'm4v_dashboard_token';

let authToken = '';
let activeCharts = {};

// ─── Utils ────────────────────────────────────────────────────────────────────

function fmt(n) {
    if (n == null) return '—';
    return Number(n).toLocaleString('es-ES');
}
function fmtPct(n) {
    if (n == null) return '—';
    return Number(n).toFixed(1) + '%';
}
function fmtDuration(secs) {
    if (secs == null) return '—';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
}
function countryFlag(code) {
    if (!code || code.length !== 2) return '';
    try {
        return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E0 - 65 + c.charCodeAt(0)));
    } catch { return ''; }
}
function dateRange() {
    return {
        from: document.getElementById('date-from').value,
        to:   document.getElementById('date-to').value,
    };
}
function destroyChart(key) {
    if (activeCharts[key]) { activeCharts[key].destroy(); delete activeCharts[key]; }
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function apiFetch(path, params = {}) {
    const url = new URL(WORKER_BASE_URL + path);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${authToken}` },
    });
    if (res.status === 401) { logout(); return null; }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function tryLogin(token) {
    try {
        const res = await fetch(WORKER_BASE_URL + '/v1/stats/overview', {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        return res.ok;
    } catch { return false; }
}

function logout() {
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
}

// ─── Navegación ───────────────────────────────────────────────────────────────

function navigate(section) {
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.section === section);
    });
    document.querySelectorAll('.section').forEach(el => {
        el.classList.toggle('active', el.id === 'sec-' + section);
    });
    loadSection(section);
}

function loadSection(section) {
    const { from, to } = dateRange();
    switch (section) {
        case 'overview':     loadOverview(from, to);     break;
        case 'users':        loadUsers(from, to);         break;
        case 'installs':     loadInstalls(from, to);      break;
        case 'mods':         loadMods(from, to);          break;
        case 'geo':          loadGeo(from, to);           break;
        case 'versions':     loadVersions(from, to);      break;
        case 'retention':    loadRetention();             break;
        case 'errors':       loadErrors(from, to);        break;
        case 'sessions':     loadSessions(from, to);      break;
    }
}

// ─── Helpers de UI ────────────────────────────────────────────────────────────

function setHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
}

function loading(containerId) {
    setHTML(containerId, `<div class="loading-row"><span class="spinner"></span> Cargando...</div>`);
}

function errorState(containerId, msg) {
    setHTML(containerId, `<div class="error-state">⚠ Error al cargar: ${msg}</div>`);
}

// ─── Secciones ────────────────────────────────────────────────────────────────

async function loadOverview(from, to) {
    loading('overview-stats');
    loading('overview-chart');
    try {
        const [ov, au] = await Promise.all([
            apiFetch('/v1/stats/overview'),
            apiFetch('/v1/stats/active-users', { from, to }),
        ]);
        if (!ov) return;

        const sr = ov.merge_success_rate;
        setHTML('overview-stats', `
            <div class="stat-card"><div class="label">Instalaciones totales</div><div class="value">${fmt(ov.total_installations)}</div></div>
            <div class="stat-card accent"><div class="label">DAU (hoy)</div><div class="value">${fmt(ov.dau)}</div></div>
            <div class="stat-card"><div class="label">WAU (7 días)</div><div class="value">${fmt(ov.wau)}</div></div>
            <div class="stat-card"><div class="label">MAU (30 días)</div><div class="value">${fmt(ov.mau)}</div></div>
            <div class="stat-card success"><div class="label">Fusiones exitosas</div><div class="value">${fmt(ov.successful_merges)}</div></div>
            <div class="stat-card danger"><div class="label">Fusiones fallidas</div><div class="value">${fmt(ov.failed_merges)}</div></div>
            <div class="stat-card ${sr >= 90 ? 'success' : sr >= 70 ? 'warning' : 'danger'}">
                <div class="label">Tasa de éxito VPK</div>
                <div class="value">${sr != null ? sr + '%' : '—'}</div>
            </div>
            <div class="stat-card"><div class="label">Eventos totales</div><div class="value">${fmt(ov.total_events)}</div></div>
        `);

        if (au && au.length > 0) {
            destroyChart('overview');
            const ctx = document.getElementById('chart-overview').getContext('2d');
            activeCharts['overview'] = new Chart(ctx, lineChart(
                au.map(r => r.date),
                au.map(r => r.dau),
                'Usuarios activos diarios'
            ));
            setHTML('overview-chart', '');
            document.getElementById('chart-overview').style.display = 'block';
        } else {
            setHTML('overview-chart', '<div class="empty-state">Sin datos en el período seleccionado</div>');
        }
    } catch (e) { errorState('overview-stats', e.message); }
}

async function loadUsers(from, to) {
    loading('users-content');
    try {
        const data = await apiFetch('/v1/stats/active-users', { from, to });
        if (!data || data.length === 0) {
            setHTML('users-content', '<div class="empty-state">Sin datos en el período seleccionado</div>');
            return;
        }
        const vals = data.map(r => r.dau);
        const peak = Math.max(...vals);
        const avg  = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
        setHTML('users-content', `
            <div class="stats-grid">
                <div class="stat-card accent"><div class="label">Pico DAU</div><div class="value">${fmt(peak)}</div></div>
                <div class="stat-card"><div class="label">Media DAU</div><div class="value">${fmt(avg)}</div></div>
            </div>
            <div class="chart-card"><h3>Usuarios activos diarios</h3>
                <div class="chart-wrap"><canvas id="chart-users"></canvas></div>
            </div>`);
        destroyChart('users');
        const ctx = document.getElementById('chart-users').getContext('2d');
        activeCharts['users'] = new Chart(ctx, lineChart(data.map(r => r.date), vals, 'DAU'));
    } catch (e) { errorState('users-content', e.message); }
}

async function loadInstalls(from, to) {
    loading('installs-content');
    try {
        const data = await apiFetch('/v1/stats/installations', { from, to });
        if (!data || data.length === 0) {
            setHTML('installs-content', '<div class="empty-state">Sin instalaciones en el período seleccionado</div>');
            return;
        }
        const total = data.reduce((s, r) => s + r.count, 0);
        setHTML('installs-content', `
            <div class="stats-grid">
                <div class="stat-card accent"><div class="label">Nuevas instalaciones</div><div class="value">${fmt(total)}</div><div class="sub">En el período seleccionado</div></div>
            </div>
            <div class="chart-card"><h3>Nuevas instalaciones por día</h3>
                <div class="chart-wrap"><canvas id="chart-installs"></canvas></div>
            </div>`);
        destroyChart('installs');
        const ctx = document.getElementById('chart-installs').getContext('2d');
        activeCharts['installs'] = new Chart(ctx, barChart(data.map(r => r.date), data.map(r => r.count), 'Instalaciones'));
    } catch (e) { errorState('installs-content', e.message); }
}

async function loadMods(from, to) {
    loading('mods-content');
    try {
        const data = await apiFetch('/v1/stats/mods', { from, to, limit: 20 });
        if (!data || data.length === 0) {
            setHTML('mods-content', '<div class="empty-state">Sin datos de mods en el período seleccionado</div>');
            return;
        }
        const maxSel = data[0]?.selections || 1;
        const rows = data.map((r, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${r.mod_title || '<em style="color:var(--text-muted)">Sin título</em>'}</td>
                <td><code style="font-size:11px;color:var(--text-muted)">${r.mod_id || '—'}</code></td>
                <td class="num">${fmt(r.selections)}</td>
                <td class="num">${fmtPct((r.selections / maxSel) * 100)}</td>
            </tr>`).join('');
        setHTML('mods-content', `
            <div class="table-card">
                <h3>Mods más seleccionados (top 20)</h3>
                <table><thead><tr><th>#</th><th>Título</th><th>ID del mod</th><th style="text-align:right">Selecciones</th><th style="text-align:right">% del top</th></tr></thead>
                <tbody>${rows}</tbody></table>
            </div>`);
    } catch (e) { errorState('mods-content', e.message); }
}

async function loadGeo(from, to) {
    loading('geo-content');
    try {
        const data = await apiFetch('/v1/stats/geography', { from, to });
        if (!data || data.length === 0) {
            setHTML('geo-content', '<div class="empty-state">Sin datos geográficos disponibles</div>');
            return;
        }
        const maxI = data[0]?.installations || 1;
        const rows = data.map(r => `
            <tr>
                <td>${countryFlag(r.country)} ${r.country || '—'}</td>
                <td class="num">${fmt(r.installations)}</td>
                <td class="num">${fmt(r.sessions)}</td>
                <td style="width:140px;padding-right:20px">
                    <div class="prog-bar"><div class="prog-fill" style="width:${Math.round((r.installations/maxI)*100)}%"></div></div>
                </td>
            </tr>`).join('');
        setHTML('geo-content', `
            <div class="table-card"><h3>Distribución geográfica</h3>
                <table><thead><tr><th>País</th><th style="text-align:right">Instalaciones</th><th style="text-align:right">Sesiones</th><th></th></tr></thead>
                <tbody>${rows}</tbody></table>
            </div>`);
    } catch (e) { errorState('geo-content', e.message); }
}

async function loadVersions(from, to) {
    loading('versions-content');
    try {
        const data = await apiFetch('/v1/stats/versions', { from, to });
        if (!data || data.length === 0) {
            setHTML('versions-content', '<div class="empty-state">Sin datos de versiones</div>');
            return;
        }
        const latest = data[0]?.app_version;
        const rows = data.map(r => `
            <tr>
                <td>${r.app_version === latest ? `<span class="badge badge-latest">${r.app_version} ★</span>` : r.app_version}</td>
                <td class="num">${fmt(r.installations)}</td>
                <td class="num">${fmt(r.sessions)}</td>
                <td class="num">${fmt(r.merges)}</td>
            </tr>`).join('');
        setHTML('versions-content', `
            <div class="table-card"><h3>Distribución por versión</h3>
                <table><thead><tr><th>Versión</th><th style="text-align:right">Instalaciones</th><th style="text-align:right">Sesiones</th><th style="text-align:right">Fusiones</th></tr></thead>
                <tbody>${rows}</tbody></table>
            </div>`);
    } catch (e) { errorState('versions-content', e.message); }
}

async function loadRetention() {
    loading('retention-content');
    try {
        const data = await apiFetch('/v1/stats/retention');
        if (!data) return;
        setHTML('retention-content', `
            <div class="retention-grid">
                <div class="retention-card">
                    <div class="r-label">Retención día 1</div>
                    <div class="r-value">${data.d1_rate ?? '—'}${data.d1_rate != null ? '%' : ''}</div>
                    <div class="r-sub">Volvieron al día siguiente</div>
                </div>
                <div class="retention-card">
                    <div class="r-label">Retención día 7</div>
                    <div class="r-value">${data.d7_rate ?? '—'}${data.d7_rate != null ? '%' : ''}</div>
                    <div class="r-sub">Volvieron tras 7 días</div>
                </div>
                <div class="retention-card">
                    <div class="r-label">Retención día 30</div>
                    <div class="r-value">${data.d30_rate ?? '—'}${data.d30_rate != null ? '%' : ''}</div>
                    <div class="r-sub">Volvieron tras 30 días</div>
                </div>
            </div>
            <p style="color:var(--text-muted);font-size:12px">
                Cohorte: instalaciones de los últimos 60 días. Un usuario se considera retenido si abrió la app en o después del umbral indicado.
            </p>`);
    } catch (e) { errorState('retention-content', e.message); }
}

async function loadErrors(from, to) {
    loading('errors-content');
    try {
        const [errs, vpk] = await Promise.all([
            apiFetch('/v1/stats/errors', { from, to, limit: 20 }),
            apiFetch('/v1/stats/vpk-stats', { from, to }),
        ]);
        let statsHTML = '';
        if (vpk) {
            statsHTML = `<div class="stats-grid">
                <div class="stat-card"><div class="label">Total fusiones</div><div class="value">${fmt(vpk.total_merges_period)}</div></div>
                <div class="stat-card"><div class="label">Mods promedio</div><div class="value">${vpk.avg_mods_per_merge ?? '—'}</div></div>
                <div class="stat-card ${(vpk.merge_success_rate ?? 0) >= 90 ? 'success' : 'danger'}"><div class="label">Tasa de éxito</div><div class="value">${vpk.merge_success_rate != null ? vpk.merge_success_rate + '%' : '—'}</div></div>
            </div>`;
        }
        if (!errs || errs.length === 0) {
            setHTML('errors-content', statsHTML + '<div class="empty-state">Sin errores registrados en el período ✓</div>');
            return;
        }
        const rows = errs.map(r => `
            <tr><td>${r.error_type || '<em>desconocido</em>'}</td><td class="num">${fmt(r.count)}</td></tr>`).join('');
        setHTML('errors-content', statsHTML + `
            <div class="table-card"><h3>Tipos de error (top 20)</h3>
                <table><thead><tr><th>Tipo de error</th><th style="text-align:right">Ocurrencias</th></tr></thead>
                <tbody>${rows}</tbody></table>
            </div>`);
    } catch (e) { errorState('errors-content', e.message); }
}

async function loadSessions(from, to) {
    loading('sessions-content');
    try {
        const data = await apiFetch('/v1/stats/session-duration', { from, to });
        if (!data) return;
        setHTML('sessions-content', `
            <div class="stats-grid">
                <div class="stat-card accent"><div class="label">Duración media</div><div class="value" style="font-size:24px">${fmtDuration(data.avg)}</div><div class="sub">${fmt(data.samples)} sesiones</div></div>
                <div class="stat-card"><div class="label">Mediana (p50)</div><div class="value" style="font-size:24px">${fmtDuration(data.p50)}</div></div>
                <div class="stat-card"><div class="label">Percentil 90</div><div class="value" style="font-size:24px">${fmtDuration(data.p90)}</div></div>
            </div>`);
    } catch (e) { errorState('sessions-content', e.message); }
}

// ─── Chart.js helpers ─────────────────────────────────────────────────────────

const CHART_COLORS = { line: '#cc0000', fill: 'rgba(204,0,0,0.12)', bar: '#cc0000', grid: '#30363d', text: '#8b949e' };

function lineChart(labels, data, label) {
    return {
        type: 'line',
        data: {
            labels,
            datasets: [{ label, data, borderColor: CHART_COLORS.line, backgroundColor: CHART_COLORS.fill, tension: .3, fill: true, pointRadius: 3, pointHoverRadius: 5 }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: CHART_COLORS.text, maxTicksLimit: 12 }, grid: { color: CHART_COLORS.grid } },
                y: { ticks: { color: CHART_COLORS.text }, grid: { color: CHART_COLORS.grid }, beginAtZero: true },
            },
        },
    };
}

function barChart(labels, data, label) {
    return {
        type: 'bar',
        data: {
            labels,
            datasets: [{ label, data, backgroundColor: CHART_COLORS.bar, borderRadius: 3 }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: CHART_COLORS.text, maxTicksLimit: 12 }, grid: { display: false } },
                y: { ticks: { color: CHART_COLORS.text }, grid: { color: CHART_COLORS.grid }, beginAtZero: true },
            },
        },
    };
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    // Fechas por defecto
    const today = new Date().toISOString().split('T')[0];
    const ago30 = new Date(Date.now() - 30 * 86400_000).toISOString().split('T')[0];
    document.getElementById('date-from').value = ago30;
    document.getElementById('date-to').value   = today;

    // ── Login
    const loginForm  = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');

    loginForm.addEventListener('submit', async e => {
        e.preventDefault();
        const token = document.getElementById('login-token').value.trim();
        if (!token) return;
        loginError.textContent = 'Verificando...';
        const ok = await tryLogin(token);
        if (ok) {
            authToken = token;
            localStorage.setItem(TOKEN_KEY, token);
            showDashboard();
        } else {
            loginError.textContent = '⚠ Token inválido o Worker no accesible.';
        }
    });

    // Auto-login con token guardado
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) {
        const ok = await tryLogin(saved);
        if (ok) { authToken = saved; showDashboard(); return; }
        localStorage.removeItem(TOKEN_KEY);
    }
});

function showDashboard() {
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('app').classList.add('visible');

    // Navegación
    document.querySelectorAll('.nav-item[data-section]').forEach(el => {
        el.addEventListener('click', () => navigate(el.dataset.section));
    });

    document.getElementById('btn-logout').addEventListener('click', logout);

    document.getElementById('btn-apply').addEventListener('click', () => {
        const active = document.querySelector('.nav-item.active')?.dataset.section || 'overview';
        loadSection(active);
    });

    navigate('overview');
}
