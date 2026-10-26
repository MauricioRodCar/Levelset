//! Levelset desktop shell (thin): window, notifications and the engine sidecar.
//! Engine lifecycle (spawn, ready line, random port + token, kill on exit) lives in `engine.rs`.

mod engine;
mod secrets;
mod system;

use std::time::Duration;

use tauri::Manager;

pub use engine::{EngineInfo, EngineStatus};

/// Called by the UI at startup (src/api/engine.ts). Waits for the engine's ready line
/// (at most the 20 s start timeout) and returns its url + per-launch token.
#[tauri::command]
async fn get_engine_info(engine: tauri::State<'_, engine::Engine>) -> Result<EngineInfo, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        engine.wait(engine::READY_TIMEOUT + Duration::from_secs(1))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Non-blocking engine state for the UI: starting | ready | failed (+ error, source, demo).
#[tauri::command]
fn get_engine_status(engine: tauri::State<'_, engine::Engine>) -> EngineStatus {
    engine.status()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // A second launch (e.g. while hidden in the tray) focuses this window instead of starting a second engine.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| system::show_main(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![system::AUTOSTART_ARG]),
        ))
        // closing the main window hides it to the tray; Quit in the tray menu exits (system.rs)
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    system::on_close_requested(window);
                }
            }
        })
        .manage(engine::Engine::default())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            system::setup(app, data_dir.clone(), app.state::<engine::Engine>().inner().clone())?;
            let handle = app.handle().clone();
            app.state::<engine::Engine>().start(data_dir, move |err| {
                let _ = handle.emit_engine_failed(&err);
                engine::show_error_box(
                    "Levelset",
                    &format!("Levelset could not start its local engine.\n\n{err}\n\nRestart Levelset to try again."),
                );
            });
            // Claude key -> engine memory once it is healthy (never to the UI)
            secrets::push_claude_key(app.state::<engine::Engine>().inner().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_engine_info,
            get_engine_status,
            secrets::set_secret,
            secrets::has_secret,
            secrets::delete_secret,
            system::get_system_prefs,
            system::set_autostart,
            system::set_keep_awake,
            system::set_demo_mode,
            system::set_tray_labels,
            system::save_text_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building Levelset");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            handle.state::<engine::Engine>().shutdown();
        }
    });
}

/// `engine://failed` event so a mounted UI can switch to its error state immediately.
trait EmitEngineFailed {
    fn emit_engine_failed(&self, err: &str) -> tauri::Result<()>;
}

impl EmitEngineFailed for tauri::AppHandle {
    fn emit_engine_failed(&self, err: &str) -> tauri::Result<()> {
        use tauri::Emitter;
        self.emit("engine://failed", err)
    }
}
