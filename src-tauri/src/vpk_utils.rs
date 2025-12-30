use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use std::collections::HashMap;
use valve_pak::VPK;

/// Extracts all files from a VPK to a destination directory using valve_pak.
/// Skips root-level files (like addoninfo.txt) to avoid conflicts in merged VPKs.
pub fn extract_vpk(vpk_path: &Path, out_dir: &Path) -> Result<(), String> {
    let vpk = VPK::open(vpk_path).map_err(|e| format!("Failed to open VPK: {}", e))?;
    
    // Iterate through all files in the VPK
    for path in vpk.file_paths() {
        // Skip root-level files (those without '/' in path)
        // Root files like addoninfo.txt should NOT be included in merged VPK
        if !path.contains('/') && !path.contains('\\') {
            continue;
        }
        
        // Read file content
        let mut file = vpk.get_file(&path).map_err(|e| format!("Failed to get {}: {}", path, e))?;
        let data = file.read_all().map_err(|e| format!("Failed to read {}: {}", path, e))?;
        
        // Create output path
        let out_path = out_dir.join(&path);
        
        // Create parent directories
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {}", e))?;
        }
        
        // Write file
        let mut out_file = File::create(&out_path).map_err(|e| format!("Failed to create {}: {}", path, e))?;
        out_file.write_all(&data).map_err(|e| format!("Failed to write {}: {}", path, e))?;
    }
    
    Ok(())
}

/// Packs a directory into a VPK Version 1 file.
/// Uses proper CRC32 checksums for L4D2 compatibility.
/// NOTE: valve_pak creates v2 which L4D2 can't read, so we must use native implementation.
pub fn pack_vpk_v1(content_dir: &Path, output_path: &Path) -> Result<(), String> {
    let mut file_entries: Vec<(String, String, String, std::path::PathBuf, Vec<u8>)> = Vec::new();

    // Walk directory to gather files with their contents
    fn visit_dirs_collect(dir: &Path, base: &Path, entries: &mut Vec<(String, String, String, std::path::PathBuf, Vec<u8>)>) -> Result<(), String> {
        if dir.is_dir() {
            for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                if path.is_dir() {
                    visit_dirs_collect(&path, base, entries)?;
                } else if path.is_file() {
                    let rel_path = path.strip_prefix(base).unwrap();
                    let extension = rel_path.extension().unwrap_or_default().to_string_lossy().to_string();
                    let file_stem = rel_path.file_stem().unwrap_or_default().to_string_lossy().to_string();
                    let parent = rel_path.parent().unwrap_or(Path::new(""));
                    let dir_path = if parent.as_os_str().is_empty() {
                        " ".to_string()
                    } else {
                        parent.to_string_lossy().replace('\\', "/")
                    };
                    let data = fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
                    entries.push((extension, dir_path, file_stem, path.clone(), data));
                }
            }
        }
        Ok(())
    }

    visit_dirs_collect(content_dir, content_dir, &mut file_entries)?;

    // Sort for deterministic output
    file_entries.sort_by(|a, b| {
        a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)).then_with(|| a.2.cmp(&b.2))
    });

    // Group by extension -> path -> files
    let mut files_by_ext: HashMap<String, HashMap<String, Vec<(String, Vec<u8>)>>> = HashMap::new();
    for (ext, dir, name, _, data) in file_entries {
        files_by_ext
            .entry(ext)
            .or_default()
            .entry(dir)
            .or_default()
            .push((name, data));
    }

    // Build tree and collect file data
    let mut tree_buffer: Vec<u8> = Vec::new();
    let mut data_buffer: Vec<u8> = Vec::new();
    let mut current_offset: u32 = 0;

    let mut sorted_exts: Vec<_> = files_by_ext.keys().cloned().collect();
    sorted_exts.sort();

    for ext in sorted_exts {
        // Extension
        tree_buffer.extend_from_slice(ext.as_bytes());
        tree_buffer.push(0);

        let paths = files_by_ext.get(&ext).unwrap();
        let mut sorted_paths: Vec<_> = paths.keys().cloned().collect();
        sorted_paths.sort();

        for path in sorted_paths {
            // Path
            tree_buffer.extend_from_slice(path.as_bytes());
            tree_buffer.push(0);

            let files = paths.get(&path).unwrap();
            for (filename, data) in files {
                // Filename
                tree_buffer.extend_from_slice(filename.as_bytes());
                tree_buffer.push(0);

                // Entry data (18 bytes)
                let crc = crc32fast::hash(&data);
                let preload_bytes: u16 = 0;
                let archive_index: u16 = 0x7FFF; // Data embedded in this file
                let entry_offset: u32 = current_offset;
                let entry_length: u32 = data.len() as u32;
                let terminator: u16 = 0xFFFF;

                tree_buffer.extend_from_slice(&crc.to_le_bytes());
                tree_buffer.extend_from_slice(&preload_bytes.to_le_bytes());
                tree_buffer.extend_from_slice(&archive_index.to_le_bytes());
                tree_buffer.extend_from_slice(&entry_offset.to_le_bytes());
                tree_buffer.extend_from_slice(&entry_length.to_le_bytes());
                tree_buffer.extend_from_slice(&terminator.to_le_bytes());

                // Append file data
                data_buffer.extend_from_slice(&data);
                current_offset += entry_length;
            }
            tree_buffer.push(0); // End of filenames
        }
        tree_buffer.push(0); // End of paths
    }
    tree_buffer.push(0); // End of extensions

    // Write VPK file
    let mut vpk_file = File::create(output_path).map_err(|e| format!("Failed to create VPK: {}", e))?;
    
    // Header (12 bytes for v1)
    let signature: u32 = 0x55aa1234;
    let version: u32 = 1;
    let tree_size: u32 = tree_buffer.len() as u32;

    vpk_file.write_all(&signature.to_le_bytes()).map_err(|e| e.to_string())?;
    vpk_file.write_all(&version.to_le_bytes()).map_err(|e| e.to_string())?;
    vpk_file.write_all(&tree_size.to_le_bytes()).map_err(|e| e.to_string())?;
    vpk_file.write_all(&tree_buffer).map_err(|e| e.to_string())?;
    vpk_file.write_all(&data_buffer).map_err(|e| e.to_string())?;

    println!("[OK] VPK v1 creado correctamente: {:?}", output_path);
    Ok(())
}
