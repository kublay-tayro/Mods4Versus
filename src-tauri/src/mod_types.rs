//! Data structures for mod management
use serde::{Deserialize, Serialize};

/// Represents a single mod from the Workshop
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Mod {
    /// The mod ID (filename without extension)
    pub id: String,
    /// Path to the thumbnail image (served via asset protocol)
    pub image_path: String,
    /// The mod title extracted from addoninfo.txt
    pub title: String,
}

/// Result of a merge operation
#[derive(Serialize, Deserialize, Debug)]
pub struct MergeResult {
    /// "ok" or "error"
    pub status: String,
    /// Human-readable message
    pub msg: String,
}

impl MergeResult {
    pub fn ok(msg: impl Into<String>) -> Self {
        Self {
            status: "ok".to_string(),
            msg: msg.into(),
        }
    }

    pub fn error(msg: impl Into<String>) -> Self {
        Self {
            status: "error".to_string(),
            msg: msg.into(),
        }
    }
}
