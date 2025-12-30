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
        .invoke_handler(tauri::generate_handler![
            verify_and_repair_environment,
            get_mods,
            merge_mods,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
