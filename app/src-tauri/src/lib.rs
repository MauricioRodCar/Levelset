//! Levelset desktop shell (thin): window, notifications and engine connection info.
//! The engine sidecar (start/stop, random port + token) is wired in a later work package;
//! until then `get_engine_info` reads env vars or falls back to the dev defaults.

use serde::Serialize;

const DEFAULT_ENGINE_URL: &str = "http://127.0.0.1:8765";
const DEFAULT_ENGINE_TOKEN: &str = "dev";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct EngineInfo {
    pub url: String,
    pub token: String,
}

/// Resolve engine URL/token from LEVELSET_ENGINE_URL / LEVELSET_ENGINE_TOKEN or the dev defaults.
pub fn engine_info_from(url: Option<String>, token: Option<String>) -> EngineInfo {
    let clean = |v: Option<String>| v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    EngineInfo {
        url: clean(url)
            .map(|u| u.trim_end_matches('/').to_string())
            .unwrap_or_else(|| DEFAULT_ENGINE_URL.to_string()),
        token: clean(token).unwrap_or_else(|| DEFAULT_ENGINE_TOKEN.to_string()),
    }
}

/// Called by the UI at startup (src/api/engine.ts).
#[tauri::command]
fn get_engine_info() -> EngineInfo {
    engine_info_from(
        std::env::var("LEVELSET_ENGINE_URL").ok(),
        std::env::var("LEVELSET_ENGINE_TOKEN").ok(),
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![get_engine_info])
        .run(tauri::generate_context!())
        .expect("error while running Levelset");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_when_unset_or_blank() {
        let info = engine_info_from(None, Some("  ".into()));
        assert_eq!(info.url, DEFAULT_ENGINE_URL);
        assert_eq!(info.token, DEFAULT_ENGINE_TOKEN);
    }

    #[test]
    fn env_values_win_and_trailing_slash_is_trimmed() {
        let info = engine_info_from(Some("http://127.0.0.1:9001/".into()), Some("abc".into()));
        assert_eq!(info.url, "http://127.0.0.1:9001");
        assert_eq!(info.token, "abc");
    }
}
