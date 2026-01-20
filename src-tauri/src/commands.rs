//! Tauri commands for mod management
//!
//! This module implements all the core functionality:
//! - Self-healing environment setup
//! - Workshop mod scanning
//! - VPK merging and compilation

use crate::mod_types::{MergeResult, Mod};
use crate::paths::{
    get_gameinfo_path, get_mods_path, get_workshop_path, TEMP_NAME,
};
use crate::vpk_utils;
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use valve_pak::VPK;
use tauri::Emitter;

/// Verifies and repairs the game environment on startup.
///
/// This function is idempotent and performs:
/// 1. Creates the `mods` folder if it doesn't exist
/// 2. Injects "Game mods" into gameinfo.txt if not present
#[tauri::command]
pub fn verify_and_repair_environment() -> Result<(), String> {
    println!("Verificando entorno del juego...");

    // 1. Ensure mods folder exists
    let mods_path = get_mods_path();
    if !mods_path.exists() {
        fs::create_dir_all(&mods_path)
            .map_err(|e| format!("No se pudo crear carpeta mods: {}", e))?;
        println!("[OK] Carpeta creada: {:?}", mods_path);
    }

    // 2. Inject 'Game mods' into gameinfo.txt
    let gameinfo_path = get_gameinfo_path();
    if gameinfo_path.exists() {
        inject_game_mods_line(&gameinfo_path)?;
    }

    Ok(())
}

/// Injects the "Game mods" line into gameinfo.txt if not already present.
fn inject_game_mods_line(gameinfo_path: &Path) -> Result<(), String> {
    let content =
        fs::read_to_string(gameinfo_path).map_err(|e| format!("Error leyendo gameinfo.txt: {}", e))?;

    // Check if line already exists (idempotency)
    let already_exists = content.lines().any(|line| {
        line.contains("Game") && line.contains("mods") && !line.trim_start().starts_with("//")
    });

    if already_exists {
        println!("[OK] gameinfo.txt ya está configurado correctamente.");
        return Ok(());
    }

    println!("Inyectando ruta en gameinfo.txt...");

    // Create backup
    let backup_path = gameinfo_path.with_extension("txt.bak");
    fs::copy(gameinfo_path, &backup_path)
        .map_err(|e| format!("Error creando backup de gameinfo.txt: {}", e))?;

    // Process and inject line
    let mut new_lines: Vec<String> = Vec::new();
    let mut found_searchpaths = false;
    let mut inserted = false;

    for line in content.lines() {
        new_lines.push(line.to_string());

        // Look for SearchPaths section
        if line.contains("SearchPaths") {
            found_searchpaths = true;
        }

        // Inject right after the opening brace
        if found_searchpaths && line.contains('{') && !inserted {
            new_lines.push("\t\t\tGame\t\t\tmods".to_string());
            inserted = true;
            println!("[OK] Línea 'Game mods' agregada con prioridad alta.");
        }
    }

    // Write modified file
    let mut file =
        File::create(gameinfo_path).map_err(|e| format!("Error escribiendo gameinfo.txt: {}", e))?;
    for line in new_lines {
        writeln!(file, "{}", line).map_err(|e| format!("Error escribiendo línea: {}", e))?;
    }

    Ok(())
}

/// Scans the Workshop folder and returns all available mods.
///
/// For each .vpk file found, it also looks for a matching .jpg thumbnail
/// and encodes it as Base64 for the frontend.
#[tauri::command]
pub fn get_mods(window: tauri::Window) -> Result<(), String> {
    let workshop_path = get_workshop_path();
    println!("Escaneando mods en: {:?}", workshop_path);

    if !workshop_path.exists() {
        window.emit("scan-completed", 0usize).map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Spawn a background thread for all I/O operations to avoid blocking UI
    std::thread::spawn(move || {
        let entries: Vec<_> = match fs::read_dir(&workshop_path) {
            Ok(rd) => rd.flatten()
                .filter(|entry| {
                    let path = entry.path();
                    path.extension().and_then(|e| e.to_str()) == Some("vpk")
                        && path.file_stem().and_then(|s| s.to_str()).map(|s| s != TEMP_NAME).unwrap_or(true)
                })
                .collect(),
            Err(_) => return,
        };

        let mut count = 0;

        for entry in entries {
            let path = entry.path();

            let mod_id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            if mod_id.is_empty() {
                continue;
            }

            // Get thumbnail path (we just send the path, not the image data)
            let jpg_path = workshop_path.join(format!("{}.jpg", mod_id));
            let image_path = if jpg_path.exists() {
                jpg_path.to_string_lossy().to_string()
            } else {
                String::new()
            };

            // Resolve title using native parser
            let title = get_mod_title_native(&path).unwrap_or(mod_id.clone());

            let found_mod = Mod {
                id: mod_id,
                image_path,
                title,
            };
            
            // Emit event for this specific mod
            let _ = window.emit("mod-found", found_mod);
            
            count += 1;
        }

        // Signal completion
        let _ = window.emit("scan-completed", count);
    });

    Ok(())
}

/// Extracts the mod title natively using valve_pak crate
/// OPTIMIZED: Direct file access O(1) only - no iteration
fn get_mod_title_native(vpk_path: &Path) -> Option<String> {
    // Load VPK
    let vpk = VPK::open(vpk_path).ok()?;
    
    // Try direct access to known paths - O(1)
    // If not found in these paths, return None (mod will show ID)
    const KNOWN_PATHS: &[&str] = &[
        "addoninfo.txt",
        "AddonInfo.txt", 
        "ADDONINFO.TXT",
    ];
    
    for path in KNOWN_PATHS {
        if let Ok(mut file) = vpk.get_file(path) {
            if let Ok(content) = file.read_all_string() {
                if let Some(title) = parse_addon_title(&content) {
                    return Some(title);
                }
            }
        }
    }
    
    None // If not found, mod will display its ID instead
}

/// Parses the addonTitle from addoninfo.txt content
/// Handles BOTH formats:
/// 1. addontitle              "Title Here"  (unquoted key)
/// 2. "addonTitle"            "Title Here"  (quoted key)
fn parse_addon_title(content: &str) -> Option<String> {
    for line in content.lines() {
        let line = line.trim();
        
        // Skip comments and empty lines
        if line.is_empty() || line.starts_with("//") {
            continue;
        }
        
        // Check if line contains addontitle (case insensitive)
        let lower = line.to_lowercase();
        if lower.contains("addontitle") {
            // Find all quoted strings in the line
            let quotes: Vec<_> = line.match_indices('"').collect();
            
            // We need at least 2 quotes for a value, or 4 for "key" "value"
            if quotes.len() >= 4 {
                // Format: "addonTitle"  "Value" - value is between quotes[2] and quotes[3]
                let start = quotes[2].0 + 1;
                let end = quotes[3].0;
                if start < end {
                    let title = &line[start..end];
                    if !title.is_empty() {
                        return Some(title.to_string());
                    }
                }
            } else if quotes.len() >= 2 {
                // Format: addontitle  "Value" - value is between quotes[0] and quotes[1]
                let start = quotes[0].0 + 1;
                let end = quotes[1].0;
                if start < end {
                    let title = &line[start..end];
                    if !title.is_empty() {
                        return Some(title.to_string());
                    }
                }
            }
        }
    }
    None
}

/// Deletes the merged VPK file to restore the original game.
///
/// This removes pak01_dir.vpk from the mods folder.
#[tauri::command]
pub fn delete_mods() -> Result<MergeResult, String> {
    let mods_path = get_mods_path();
    let vpk_path = mods_path.join(format!("{}.vpk", TEMP_NAME));

    if vpk_path.exists() {
        fs::remove_file(&vpk_path)
            .map_err(|e| format!("Error eliminando VPK: {}", e))?;
        
        println!("[OK] Mods eliminados: {:?}", vpk_path);
        Ok(MergeResult::ok("¡Mods eliminados correctamente!\nEl juego ha sido restaurado a su estado original."))
    } else {
        Ok(MergeResult::ok("No hay mods fusionados para eliminar."))
    }
}

/// Merges multiple VPK mods into a single pak01_dir.vpk file.
///
/// Process:
/// 1. Create temporary directory
/// 2. Extract each selected VPK
/// 3. Merge contents (later mods override earlier ones)
/// 4. Compile into single VPK
/// 5. Move to mods folder
/// 6. Cleanup
#[tauri::command]
pub fn merge_mods(ids: Vec<String>) -> Result<MergeResult, String> {
    println!("Procesando IDs: {:?}", ids);

    let workshop_path = get_workshop_path();
    let temp_path = workshop_path.join(TEMP_NAME);
    // 1. Extract each VPK and merge contents
    for mod_id in &ids {
        let vpk_path = workshop_path.join(format!("{}.vpk", mod_id));

        if !vpk_path.exists() {
            continue;
        }

        // Native extraction
        if let Err(e) = vpk_utils::extract_vpk(&vpk_path, &temp_path) {
            eprintln!("Error extrayendo {}: {}", mod_id, e);
            continue; // Skip failed mods but try to continue
        }
    }

    // 2. Compile into single VPK (Native)
    let generated_vpk = workshop_path.join(format!("{}.vpk", TEMP_NAME));
    vpk_utils::pack_vpk_v1(&temp_path, &generated_vpk)?;

    // 3. Move generated VPK to mods folder
    let mods_path = get_mods_path();
    let destination_vpk = mods_path.join(format!("{}.vpk", TEMP_NAME));

    // Ensure mods folder exists
    if !mods_path.exists() {
        fs::create_dir_all(&mods_path)
            .map_err(|e| format!("Error creando carpeta mods: {}", e))?;
    }

    if generated_vpk.exists() {
        // Remove existing destination if present
        if destination_vpk.exists() {
            fs::remove_file(&destination_vpk)
                .map_err(|e| format!("Error eliminando VPK anterior: {}", e))?;
        }

        // Move the VPK
        fs::rename(&generated_vpk, &destination_vpk)
            .map_err(|e| format!("Error moviendo VPK: {}", e))?;

        // Clean up temp directory
        if temp_path.exists() {
            fs::remove_dir_all(&temp_path)
                .map_err(|e| format!("Error limpiando directorio temporal: {}", e))?;
        }

        Ok(MergeResult::ok(format!(
            "¡Mods fusionados correctamente!\nUbicación: {}",
            mods_path.display()
        )))
    } else {
        Ok(MergeResult::error(
            "Error: No se generó el archivo VPK.",
        ))
    }
}



