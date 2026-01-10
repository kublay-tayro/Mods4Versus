// Prevents additional console window on Windows in release builds
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod commands;
mod mod_types;
mod paths;
mod vpk_utils;

use commands::{get_mods, merge_mods, verify_and_repair_environment};

fn main() {
    // Run self-healing on startup (silently handle errors)
    if let Err(e) = verify_and_repair_environment() {
        eprintln!("Error durante verificación inicial: {}", e);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            verify_and_repair_environment,
            get_mods,
            merge_mods,
            get_donation_qr, // Expose the new command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn get_donation_qr() -> String {
    use base64::{Engine as _, engine::general_purpose};
    // Bake the image bytes into the binary at compile time
    const QR_BYTES: &[u8] = include_bytes!("../assets/yape_qr.png");
    // Return as a Data URI
    format!("data:image/png;base64,{}", general_purpose::STANDARD.encode(QR_BYTES))
}
