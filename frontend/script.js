// Mods4Versus - Main JavaScript
// Import Tauri APIs (Tauri v2)
const { invoke, convertFileSrc } = window.__TAURI__.core;

let selectedIDs = new Set();
let debugLog = [];
let tipInterval = null;
let progressInterval = null;

// Tips cargados desde archivo externo
let TIPS_L4D2 = ["Cargando tips..."];

// Cargar tips al inicio
fetch('tips.json')
    .then(res => res.json())
    .then(tips => { TIPS_L4D2 = tips; })
    .catch(() => { console.warn("No se pudo cargar tips.json"); });

// --- AUTO-UPDATE CHECK ---
async function checkForUpdates() {
    try {
        // Check if updater plugin is available
        if (!window.__TAURI__?.updater) {
            console.log("Updater plugin not available");
            return;
        }

        const { check } = window.__TAURI__.updater;

        console.log("Checking for updates...");
        const update = await check();

        if (update?.available) {
            console.log(`Update available: ${update.version}`);

            // Show update dialog and wait for user decision
            const userConfirmed = await showUpdateDialog(update.version, update.body || "Mejoras y correcciones.");

            if (userConfirmed) {
                // User wants to update - show download phase
                showDownloadPhase();

                let totalBytes = 0;
                let downloadedBytes = 0;

                // Download with progress tracking
                await update.downloadAndInstall((event) => {
                    if (event.event === 'Started') {
                        totalBytes = event.data.contentLength || 0;
                        console.log(`Download started, total size: ${totalBytes} bytes`);
                    } else if (event.event === 'Progress') {
                        downloadedBytes += event.data.chunkLength || 0;
                        updateDownloadProgress(downloadedBytes, totalBytes);
                    } else if (event.event === 'Finished') {
                        console.log("Download finished, installing...");
                        // Use IIFE or just call without await since we are in a non-async callback (or make parent async)
                        // Actually parent callback of downloadAndInstall IS async in typical Tauri usage, but let's be safe.
                        window.__TAURI__.dialog.message('Download Completed! Attempting to close app in 1.5s...', { title: 'Debug', type: 'info' }).then(() => {
                            showInstallingState();
                            setTimeout(async () => {
                                try {
                                    const { exit } = window.__TAURI__.process;
                                    await exit(0);
                                } catch (e) {
                                    window.__TAURI__.dialog.message('EXIT FAILED: ' + e, { title: 'Error', type: 'error' });
                                }
                            }, 1500);
                        });
                    }
                });
            }
        } else {
            console.log("No updates available");
        }
    } catch (err) {
        console.error("Update check failed:", err);
        hideUpdateOverlay();
    }
}

function showUpdateDialog(version, notes) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('update-overlay');
        const versionSpan = document.getElementById('update-version');
        const notesDiv = document.getElementById('update-notes');
        const questionDiv = document.getElementById('update-question');
        const downloadDiv = document.getElementById('update-download');
        const btnUpdate = document.getElementById('btn-update-now');
        const btnLater = document.getElementById('btn-update-later');

        if (!overlay) {
            resolve(true);
            return;
        }

        // Reset to question phase
        questionDiv.style.display = 'block';
        downloadDiv.style.display = 'none';

        versionSpan.textContent = version;
        notesDiv.textContent = notes;
        overlay.style.display = 'flex';

        btnUpdate.onclick = () => {
            resolve(true);
        };

        btnLater.onclick = () => {
            overlay.style.display = 'none';
            resolve(false);
        };
    });
}

function showDownloadPhase() {
    const questionDiv = document.getElementById('update-question');
    const downloadDiv = document.getElementById('update-download');
    const progressBar = document.getElementById('update-progress-bar');
    const percentText = document.getElementById('update-percent');
    const statusText = document.getElementById('update-status');

    questionDiv.style.display = 'none';
    downloadDiv.style.display = 'block';
    progressBar.style.width = '0%';
    percentText.textContent = '0%';
    statusText.textContent = 'Descargando actualización...';
}

function updateDownloadProgress(downloaded, total) {
    const progressBar = document.getElementById('update-progress-bar');
    const percentText = document.getElementById('update-percent');

    let percent = 0;
    if (total > 0) {
        percent = Math.min(Math.round((downloaded / total) * 100), 100);
    }

    progressBar.style.width = percent + '%';
    percentText.textContent = percent + '%';
}

function showInstallingState() {
    const statusText = document.getElementById('update-status');
    const progressBar = document.getElementById('update-progress-bar');
    const percentText = document.getElementById('update-percent');

    progressBar.style.width = '100%';
    percentText.textContent = '100%';
    statusText.textContent = 'Instalando... la app se reiniciará';
}

function hideUpdateOverlay() {
    const overlay = document.getElementById('update-overlay');
    if (overlay) overlay.style.display = 'none';
}

// --- WINDOW CONTROLS ---
async function setupWindowControls() {
    // Tauri v2 uses Window.getCurrent() or getCurrentWindow()
    const appWindow = window.__TAURI__.window.getCurrentWindow();

    document.getElementById('btn-minimize')?.addEventListener('click', async () => {
        await appWindow.minimize();
    });

    document.getElementById('btn-maximize')?.addEventListener('click', async () => {
        const isMaximized = await appWindow.isMaximized();
        if (isMaximized) {
            await appWindow.unmaximize();
        } else {
            await appWindow.maximize();
        }
    });

    document.getElementById('btn-close')?.addEventListener('click', async () => {
        await appWindow.close();
    });
}

// --- UTILITY FUNCTIONS ---
function log(msg) {
    console.log(msg);
    const status = document.getElementById('status');
    if (status) status.innerText = msg;
}

function cerrarModal() {
    document.getElementById('modal-overlay').style.display = 'none';
}

function mostrarLoading() {
    const overlay = document.getElementById('loading-overlay');
    const tipText = document.getElementById('loading-tip-text');
    const progressBar = document.getElementById('loading-progress-bar');
    const percentText = document.getElementById('loading-percent');

    // Reset progress
    progressBar.style.width = '0%';
    let progress = 0;

    // Mostrar tip aleatorio inicial
    tipText.innerText = TIPS_L4D2[Math.floor(Math.random() * TIPS_L4D2.length)];
    overlay.style.display = 'flex';

    // Animar progreso (simulado ya que no tenemos eventos del backend)
    progressInterval = setInterval(() => {
        if (progress < 95) {
            progress += Math.random() * 8 + 2;
            if (progress > 95) progress = 95;
            progressBar.style.width = progress + '%';
            percentText.innerText = Math.floor(progress) + '%';
        }
    }, 300);

    // Rotar tips cada 4 segundos
    tipInterval = setInterval(() => {
        tipText.innerText = TIPS_L4D2[Math.floor(Math.random() * TIPS_L4D2.length)];
    }, 4000);
}

function cerrarLoading() {
    const progressBar = document.getElementById('loading-progress-bar');
    const percentText = document.getElementById('loading-percent');

    // Completar al 100% antes de cerrar
    progressBar.style.width = '100%';
    percentText.innerText = '100%';

    setTimeout(() => {
        document.getElementById('loading-overlay').style.display = 'none';
        progressBar.style.width = '0%';
    }, 200);

    if (tipInterval) {
        clearInterval(tipInterval);
        tipInterval = null;
    }
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
}

function mostrarModal(titulo, mensaje, esError = false) {
    // Play completion sound only for success
    if (!esError) {
        document.getElementById('sound-complete').play().catch(() => { });
    }
    const overlay = document.getElementById('modal-overlay');
    const titleDiv = document.getElementById('modal-title');
    const msgDiv = document.getElementById('modal-msg');
    const btn = document.getElementById('modal-btn');
    const box = document.getElementById('modal-box');

    titleDiv.innerText = titulo;
    msgDiv.innerText = mensaje;

    if (esError) {
        titleDiv.style.color = "#ff4444";
        titleDiv.style.borderColor = "#ff4444";
        box.style.borderColor = "#ff4444";
        btn.style.backgroundColor = "#880000";
    } else {
        titleDiv.style.color = "#dcdcdc";
        titleDiv.style.borderColor = "#333";
        box.style.borderColor = "#cc0000";
        btn.style.backgroundColor = "#cc0000";
    }
    overlay.style.display = 'flex';
}

// --- MOD GRID FUNCTIONS ---
function addModToGrid(mod) {
    const container = document.getElementById('grid-container');

    // Remove the scanning message if it's the first mod
    const scanMsg = document.getElementById('scan-msg');
    if (scanMsg) {
        scanMsg.remove();
    }

    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.modId = mod.id;

    // Create image with lazy loading
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    if (mod.image_path) {
        const url = convertFileSrc(mod.image_path);
        img.src = url;
    } else {
        img.src = 'https://via.placeholder.com/150/333/fff?text=No+Img';
    }

    // Create title div
    const titleDiv = document.createElement('div');
    titleDiv.className = 'card-title';
    titleDiv.title = mod.title || mod.id;
    titleDiv.textContent = mod.title || mod.id;

    div.appendChild(img);
    div.appendChild(titleDiv);
    container.appendChild(div);
}

function updateSelectionUI() {
    const btn = document.getElementById('btn-fusion');
    const status = document.getElementById('status');

    if (selectedIDs.size > 0) {
        btn.innerText = `FUSIONAR (${selectedIDs.size})`;
        status.innerText = `${selectedIDs.size} mods listos.`;
        status.style.color = "#cc0000";
    } else {
        btn.innerText = "FUSIONAR";
        status.innerText = "Esperando órdenes...";
        status.style.color = "#666";
    }
}

async function iniciarFusion() {
    if (selectedIDs.size === 0) return;

    // Play click sound
    document.getElementById('sound-click').play().catch(() => { });

    const btn = document.getElementById('btn-fusion');
    btn.disabled = true;
    btn.innerText = "PROCESANDO...";

    // Mostrar modal de carga
    mostrarLoading();

    try {
        const result = await invoke('merge_mods', { ids: Array.from(selectedIDs) });

        // Cerrar loading antes de mostrar resultado
        cerrarLoading();

        if (result.status === 'ok') {
            mostrarModal("PROCESO COMPLETADO", result.msg);
            btn.innerText = "FUSIONAR";
            selectedIDs.clear();
            document.querySelectorAll('.card.selected').forEach(el => el.classList.remove('selected'));
        } else {
            mostrarModal("ERROR CRÍTICO", result.msg, true);
        }
    } catch (err) {
        cerrarLoading();
        mostrarModal("ERROR CRÍTICO", err.toString(), true);
    }

    btn.disabled = false;
}

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', async function () {
    try {
        // Setup window controls
        await setupWindowControls();

        // Check for updates after a short delay (non-blocking)
        setTimeout(() => {
            checkForUpdates();
        }, 2000);

        // Clear container and show initial scanning message
        const container = document.getElementById('grid-container');
        container.innerHTML = '<div style="text-align:center; padding:50px; color:#555;" id="scan-msg">Escaneando Workshop...</div>';

        // Listen for newly found mods (streaming)
        if (window.__TAURI__ && window.__TAURI__.event) {
            await window.__TAURI__.event.listen('mod-found', (event) => {
                const mod = event.payload;
                addModToGrid(mod);
            });

            await window.__TAURI__.event.listen('scan-completed', (event) => {
                const count = event.payload;
                const scanMsg = document.getElementById('scan-msg');
                if (scanMsg) {
                    if (count === 0) {
                        scanMsg.innerText = "No se encontraron mods.";
                    } else {
                        scanMsg.remove();
                    }
                }
                document.getElementById('status').innerText = `Escaneo completado. ${count} mods encontrados.`;
            });
        } else {
            console.error("Tauri Event system not found");
        }

        // Add Event Listeners for buttons
        const btnFusion = document.getElementById('btn-fusion');
        if (btnFusion) {
            btnFusion.addEventListener('click', iniciarFusion);
        }

        const btnModal = document.getElementById('modal-btn');
        if (btnModal) {
            btnModal.addEventListener('click', cerrarModal);
        }

        // Donate button and dialog
        const btnDonate = document.getElementById('btn-donate');
        const donateDialog = document.getElementById('donate-dialog');
        const btnCloseDialog = document.getElementById('btn-close-dialog');

        if (btnDonate && donateDialog) {
            btnDonate.addEventListener('click', () => {
                document.getElementById('sound-click').play().catch(() => { });
                donateDialog.showModal();
            });
        }

        if (btnCloseDialog && donateDialog) {
            btnCloseDialog.addEventListener('click', () => {
                document.getElementById('sound-complete').play().catch(() => { });
                donateDialog.close();
            });
        }

        // Contact button and dialog
        const btnContact = document.getElementById('btn-contact');
        const contactDialog = document.getElementById('contact-dialog');
        const btnCloseContact = document.getElementById('btn-close-contact');

        if (btnContact && contactDialog) {
            btnContact.addEventListener('click', () => {
                document.getElementById('sound-click').play().catch(() => { });
                contactDialog.showModal();
            });
        }

        if (btnCloseContact && contactDialog) {
            btnCloseContact.addEventListener('click', () => {
                document.getElementById('sound-complete').play().catch(() => { });
                contactDialog.close();
            });
        }

        // Grid card selection (event delegation)
        document.getElementById('grid-container').addEventListener('click', function (e) {
            const card = e.target.closest('.card');
            if (!card) return;

            const id = card.dataset.modId;
            if (!id) return;

            // Toggle selection
            if (selectedIDs.has(id)) {
                selectedIDs.delete(id);
                card.classList.remove('selected');
            } else {
                selectedIDs.add(id);
                card.classList.add('selected');
            }

            updateSelectionUI();
        });

        // Start the scanning process
        console.log("Invoking get_mods...");
        await invoke('get_mods', {});

    } catch (err) {
        console.error(err);
        document.getElementById('status').innerText = "Error: " + err;
    }
});
