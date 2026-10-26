//! v1.1 desktop-shell features: system tray, close-to-tray, Start with Windows, keep the PC
//! awake during market hours, the demo-mode toggle and the native "Save as" dialog.
//!
//! - Tray: "Open Levelset" / "Quit Levelset"; a left click opens the window. Closing the window
//!   only hides it (the engine keeps running for paper following and alerts); Quit exits for real.
//!   The UI sends the menu labels in its language (`set_tray_labels`).
//! - Autostart: tauri-plugin-autostart (per-user Run key, no admin) launches `--autostart`,
//!   which starts hidden in the tray.
//! - Keep awake: one background thread asks the engine's GET /status every minute; while the
//!   preference is on and `marketOpen` is true it holds SetThreadExecutionState(ES_CONTINUOUS |
//!   ES_SYSTEM_REQUIRED) (the PC does not sleep; the display may still turn off), otherwise it
//!   clears it. Windows drops the request by itself if Levelset exits or crashes.
//! - Demo mode: the engine reads the `<app data>\demo` marker at start (engine.rs), so the toggle
//!   writes or removes it and restarts Levelset. LEVELSET_DEMO in the environment wins.
//! - Shell preferences live in `<app data>\shell.json` (no secrets).

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_dialog::DialogExt as _;

use crate::engine::{self, Engine};

pub const AUTOSTART_ARG: &str = "--autostart";
const POLL: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ShellPrefs {
    pub keep_awake: bool,
    /// The "still running in the tray" notice was shown once.
    pub tray_hint_shown: bool,
}

impl ShellPrefs {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        let text = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(path, text).map_err(|e| e.to_string())
    }
}

/// What Settings > System shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPrefs {
    autostart: bool,
    keep_awake: bool,
    demo_marker: bool,
    demo_env: bool,
    demo_active: bool,
}

struct Tray {
    open: MenuItem<Wry>,
    quit: MenuItem<Wry>,
    icon: TrayIcon<Wry>,
    hidden_note: String,
}

/// Managed state.
pub struct System {
    data_dir: PathBuf,
    prefs: Mutex<ShellPrefs>,
    wake: Mutex<Sender<()>>,
    tray: Mutex<Option<Tray>>,
}

impl System {
    fn prefs_path(&self) -> PathBuf {
        self.data_dir.join("shell.json")
    }

    fn keep_awake(&self) -> bool {
        self.prefs.lock().unwrap().keep_awake
    }

    fn view(&self, app: &AppHandle, engine: &Engine) -> SystemPrefs {
        SystemPrefs {
            autostart: app.autolaunch().is_enabled().unwrap_or(false),
            keep_awake: self.keep_awake(),
            demo_marker: self.data_dir.join("demo").exists(),
            demo_env: demo_env(),
            demo_active: engine.status().demo,
        }
    }
}

fn demo_env() -> bool {
    let v = std::env::var("LEVELSET_DEMO").unwrap_or_default();
    matches!(v.trim(), "1" | "true" | "yes")
}

pub fn started_by_autostart() -> bool {
    std::env::args().any(|a| a == AUTOSTART_ARG)
}

// ---------------------------------------------------------------- setup

/// Create the tray, manage the state and start the keep-awake thread. Call from `setup`.
pub fn setup(app: &tauri::App, data_dir: PathBuf, engine: Engine) -> tauri::Result<()> {
    let prefs = ShellPrefs::load(&data_dir.join("shell.json"));
    let (tx, rx) = channel();
    let sys = Arc::new(System {
        data_dir,
        prefs: Mutex::new(prefs),
        wake: Mutex::new(tx),
        tray: Mutex::new(None),
    });

    let open = MenuItem::with_id(app, "open", "Open Levelset", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Levelset", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Levelset")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let icon = builder.build(app)?;
    *sys.tray.lock().unwrap() = Some(Tray {
        open,
        quit,
        icon,
        hidden_note: "Levelset is still running in the system tray.".into(),
    });

    spawn_keep_awake(sys.clone(), engine, rx);
    app.manage(sys);

    if started_by_autostart() {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.hide();
        }
    }
    Ok(())
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Window close button: hide to the tray instead of quitting (the engine keeps running).
pub fn on_close_requested(window: &tauri::Window) {
    let _ = window.hide();
    let app = window.app_handle();
    let Some(sys) = app.try_state::<Arc<System>>() else {
        return;
    };
    let first = {
        let mut p = sys.prefs.lock().unwrap();
        let first = !p.tray_hint_shown;
        if first {
            p.tray_hint_shown = true;
            let _ = p.save(&sys.prefs_path());
        }
        first
    };
    if first {
        use tauri_plugin_notification::NotificationExt;
        let note = sys
            .tray
            .lock()
            .unwrap()
            .as_ref()
            .map(|t| t.hidden_note.clone())
            .unwrap_or_default();
        let _ = app.notification().builder().title("Levelset").body(note).show();
    }
}

// ---------------------------------------------------------------- keep awake

fn spawn_keep_awake(sys: Arc<System>, engine: Engine, rx: Receiver<()>) {
    std::thread::Builder::new()
        .name("keep-awake".into())
        .spawn(move || {
            let mut held = false;
            loop {
                let want = sys.keep_awake() && market_open(&engine).unwrap_or(false);
                if want != held {
                    power::hold_awake(want);
                    held = want;
                }
                match rx.recv_timeout(POLL) {
                    Ok(()) | Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
            power::hold_awake(false);
        })
        .expect("keep-awake thread");
}

/// `GET /status` on the local engine; Some(marketOpen) or None while it is not reachable.
fn market_open(engine: &Engine) -> Option<bool> {
    let info = engine.wait(Duration::ZERO).ok()?;
    let body = http_get(&info, "/status")?;
    let compact: String = body.chars().filter(|c| !c.is_whitespace()).collect();
    Some(compact.contains("\"marketOpen\":true"))
}

fn http_get(info: &engine::EngineInfo, path: &str) -> Option<String> {
    let host = info.url.trim_start_matches("http://").split('/').next()?;
    let addr: SocketAddr = host.replace("localhost", "127.0.0.1").parse().ok()?;
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(3)).ok()?;
    s.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let req = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {}\r\nConnection: close\r\n\r\n",
        info.token
    );
    s.write_all(req.as_bytes()).ok()?;
    let mut out = String::new();
    s.read_to_string(&mut out).ok()?;
    let (head, body) = out.split_once("\r\n\r\n")?;
    head.starts_with("HTTP/1.1 200").then(|| body.to_string())
}

#[cfg(windows)]
mod power {
    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
    };

    /// Must be called from the same (keep-awake) thread every time.
    pub fn hold_awake(on: bool) {
        unsafe {
            SetThreadExecutionState(if on {
                ES_CONTINUOUS | ES_SYSTEM_REQUIRED
            } else {
                ES_CONTINUOUS
            });
        }
    }
}

#[cfg(not(windows))]
mod power {
    pub fn hold_awake(_on: bool) {}
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn get_system_prefs(
    app: AppHandle,
    sys: tauri::State<'_, Arc<System>>,
    engine: tauri::State<'_, Engine>,
) -> SystemPrefs {
    sys.view(&app, &engine)
}

#[tauri::command]
pub fn set_autostart(
    app: AppHandle,
    enabled: bool,
    sys: tauri::State<'_, Arc<System>>,
    engine: tauri::State<'_, Engine>,
) -> Result<SystemPrefs, String> {
    let launcher = app.autolaunch();
    let r = if enabled { launcher.enable() } else { launcher.disable() };
    r.map_err(|e| e.to_string())?;
    Ok(sys.view(&app, &engine))
}

#[tauri::command]
pub fn set_keep_awake(
    app: AppHandle,
    enabled: bool,
    sys: tauri::State<'_, Arc<System>>,
    engine: tauri::State<'_, Engine>,
) -> Result<SystemPrefs, String> {
    {
        let mut p = sys.prefs.lock().unwrap();
        p.keep_awake = enabled;
        p.save(&sys.prefs_path())?;
    }
    let _ = sys.wake.lock().unwrap().send(());
    Ok(sys.view(&app, &engine))
}

/// Write or remove `<app data>\demo`, then restart Levelset (the engine shuts down on exit).
#[tauri::command]
pub fn set_demo_mode(
    app: AppHandle,
    enabled: bool,
    sys: tauri::State<'_, Arc<System>>,
) -> Result<(), String> {
    if demo_env() {
        return Err("LEVELSET_DEMO is set in the environment".into());
    }
    let marker = sys.data_dir.join("demo");
    if enabled {
        std::fs::write(&marker, b"demo\n").map_err(|e| e.to_string())?;
    } else if marker.exists() {
        std::fs::remove_file(&marker).map_err(|e| e.to_string())?;
    }
    app.request_restart();
    Ok(())
}

#[tauri::command]
pub fn set_tray_labels(
    open: String,
    quit: String,
    tooltip: String,
    hidden: Option<String>,
    sys: tauri::State<'_, Arc<System>>,
) -> Result<(), String> {
    let mut guard = sys.tray.lock().unwrap();
    let Some(t) = guard.as_mut() else {
        return Ok(());
    };
    t.open.set_text(open).map_err(|e| e.to_string())?;
    t.quit.set_text(quit).map_err(|e| e.to_string())?;
    t.icon.set_tooltip(Some(tooltip)).map_err(|e| e.to_string())?;
    if let Some(h) = hidden.filter(|h| !h.trim().is_empty()) {
        t.hidden_note = h;
    }
    Ok(())
}

/// Native "Save as" dialog, then write `contents` (UTF-8). Ok(None) when the user cancels.
#[tauri::command]
pub async fn save_text_file(
    app: AppHandle,
    file_name: String,
    contents: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let safe_name: String = file_name
        .chars()
        .map(|c| if r#"\/:*?"<>|"#.contains(c) { '_' } else { c })
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
        let mut dialog = app.dialog().file().set_file_name(&safe_name);
        if !exts.is_empty() {
            dialog = dialog.add_filter(&filter_name, &exts);
        }
        if let Some(w) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&w);
        }
        let Some(picked) = dialog.blocking_save_file() else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        std::fs::write(&path, contents.as_bytes()).map_err(|e| e.to_string())?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_prefs_round_trip_and_defaults() {
        let dir = std::env::temp_dir().join(format!("levelset-shell-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("shell.json");
        assert_eq!(ShellPrefs::load(&path), ShellPrefs::default());
        let p = ShellPrefs { keep_awake: true, tray_hint_shown: false };
        p.save(&path).unwrap();
        assert_eq!(ShellPrefs::load(&path), p);
        std::fs::write(&path, "{\"keepAwake\":true}").unwrap();
        assert!(ShellPrefs::load(&path).keep_awake);
        std::fs::write(&path, "not json").unwrap();
        assert_eq!(ShellPrefs::load(&path), ShellPrefs::default());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
