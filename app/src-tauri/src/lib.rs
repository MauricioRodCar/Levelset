//! Levelset desktop shell (thin): window, notifications and the engine sidecar.
//! Engine lifecycle (spawn, ready line, random port + token, kill on exit) lives in `engine.rs`.

mod engine;
mod secrets;

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
        .plugin(tauri_plugin_notification::init())
        .manage(engine::Engine::default())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let handle = app.handle().clone();
            app.state::<engine::Engine>().start(data_dir, move |err| {
                let _ = handle.emit_engine_failed(&err);
                engine::show_error_box(
                    "Levelset",
                    &format!("Levelset could not start its local engine.\n\n{err}\n\nRestart Levelset to try again."),
                );
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_engine_info,
            get_engine_status,
            secrets::set_secret,
            secrets::has_secret,
            secrets::delete_secret
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
