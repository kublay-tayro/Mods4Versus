use steamlocate::SteamDir;
use std::path::PathBuf;
use std::sync::OnceLock;

/// Cache for the installation directory path to avoid repeated registry lookups
static INSTALL_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Path to L4D2 installation root (e.g., .../common/Left 4 Dead 2)
pub fn get_install_dir() -> &'static PathBuf {
    INSTALL_DIR.get_or_init(|| {
        match SteamDir::locate() {
            Ok(steam_dir) => {
                match steam_dir.find_app(550) {
                    Ok(Some((app, library))) => library.path().join("steamapps").join("common").join(app.install_dir),
                    _ => PathBuf::from(r"C:\Program Files (x86)\Steam\steamapps\common\Left 4 Dead 2"),
                }
            }
            Err(_) => PathBuf::from(r"C:\Program Files (x86)\Steam\steamapps\common\Left 4 Dead 2"),
        }
    })
}

/// Path to L4D2 game source directory (e.g., .../Left 4 Dead 2/left4dead2)
pub fn get_game_dir() -> PathBuf {
    get_install_dir().join("left4dead2")
}

/// Path to Workshop addons folder
pub fn get_workshop_path() -> PathBuf {
    get_game_dir().join("addons").join("workshop")
}

/// Path to custom mods folder (created by app at root level)
pub fn get_mods_path() -> PathBuf {
    get_install_dir().join("mods")
}

/// Path to gameinfo.txt configuration file
pub fn get_gameinfo_path() -> PathBuf {
    get_game_dir().join("gameinfo.txt")
}

/// Temporary directory name for VPK merging
pub const TEMP_NAME: &str = "pak01_dir";
