//! Engine sidecar: start `levelset-engine.exe`, wait for its ready line, hand url + token
//! to the UI, and make sure it (and its skill worker processes) never outlive the app.
//!
//! Resolution order at startup:
//! 1. `LEVELSET_ENGINE_URL` set (dev): use it with `LEVELSET_ENGINE_TOKEN` (default "dev"), spawn nothing.
//! 2. `levelset-engine.exe` next to the app exe (installed app / `tauri build`): spawn it.
//! 3. Debug builds only: `engine\.venv\Scripts\python.exe -m levelset_engine` from the repo.
//!
//! The engine gets `--port 0 --token <random 32-byte hex> --workspace <app data>\workspace`
//! (`...\workspace\demo` and `--demo` when `LEVELSET_DEMO=1` or a file named `demo` exists in
//! the app data dir). It prints `LEVELSET_ENGINE_READY port=<p>` once listening; no ready line
//! within 20 s, or an early exit, is a failure: the UI gets an error from `get_engine_info`,
//! `get_engine_status` reports it and a native error box tells the user.
//!
//! Orphans: on Windows the child is put in a Job Object with KILL_ON_JOB_CLOSE. The job handle
//! lives as long as the app process, so when Levelset exits *or crashes* Windows kills the
//! engine and every multiprocessing worker it spawned (they inherit the job).

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

pub const READY_PREFIX: &str = "LEVELSET_ENGINE_READY port=";
pub const READY_TIMEOUT: Duration = Duration::from_secs(20);
const DEFAULT_ENGINE_TOKEN: &str = "dev";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct EngineInfo {
    pub url: String,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    /// "starting" | "ready" | "failed"
    pub state: &'static str,
    pub url: Option<String>,
    pub error: Option<String>,
    /// "env" | "sidecar" | "dev-python"
    pub source: Option<&'static str>,
    pub demo: bool,
}

#[derive(Debug, Clone)]
enum Phase {
    Starting,
    Ready(EngineInfo),
    Failed(String),
}

struct Inner {
    phase: Phase,
    source: Option<&'static str>,
    demo: bool,
    child: Option<Child>,
}

/// Managed Tauri state.
#[derive(Clone)]
pub struct Engine {
    inner: Arc<(Mutex<Inner>, Condvar)>,
}

impl Default for Engine {
    fn default() -> Self {
        Self {
            inner: Arc::new((
                Mutex::new(Inner {
                    phase: Phase::Starting,
                    source: None,
                    demo: false,
                    child: None,
                }),
                Condvar::new(),
            )),
        }
    }
}

impl Engine {
    /// Returns true if this call moved the engine out of `Starting`.
    fn set(&self, phase: Phase) -> bool {
        let (lock, cv) = &*self.inner;
        let mut g = lock.lock().unwrap();
        // first terminal state wins (a late ready line after a timeout is ignored)
        if matches!(g.phase, Phase::Starting) {
            g.phase = phase;
            cv.notify_all();
            true
        } else {
            false
        }
    }

    fn is_starting(&self) -> bool {
        matches!(self.inner.0.lock().unwrap().phase, Phase::Starting)
    }

    /// Block until the engine is ready or failed (or `limit` passes).
    pub fn wait(&self, limit: Duration) -> Result<EngineInfo, String> {
        let (lock, cv) = &*self.inner;
        let deadline = Instant::now() + limit;
        let mut g = lock.lock().unwrap();
        loop {
            match &g.phase {
                Phase::Ready(info) => return Ok(info.clone()),
                Phase::Failed(e) => return Err(e.clone()),
                Phase::Starting => {
                    let now = Instant::now();
                    if now >= deadline {
                        return Err("engine is still starting".into());
                    }
                    g = cv.wait_timeout(g, deadline - now).unwrap().0;
                }
            }
        }
    }

    pub fn status(&self) -> EngineStatus {
        let g = self.inner.0.lock().unwrap();
        let (state, url, error) = match &g.phase {
            Phase::Starting => ("starting", None, None),
            Phase::Ready(i) => ("ready", Some(i.url.clone()), None),
            Phase::Failed(e) => ("failed", None, Some(e.clone())),
        };
        EngineStatus {
            state,
            url,
            error,
            source: g.source,
            demo: g.demo,
        }
    }

    /// Kill the engine and its workers (app exit).
    pub fn shutdown(&self) {
        let child = self.inner.0.lock().unwrap().child.take();
        job::terminate();
        if let Some(mut c) = child {
            let _ = c.kill();
            let _ = c.wait();
        }
    }

    /// Resolve or spawn the engine. Returns immediately; readiness is reported via `wait`/`status`.
    /// `on_fail` runs (on a background thread) if the engine cannot start.
    pub fn start(&self, app_data_dir: PathBuf, on_fail: impl Fn(String) + Send + Sync + 'static) {
        // 1. dev override
        if let Some(url) = clean(std::env::var("LEVELSET_ENGINE_URL").ok()) {
            let token = clean(std::env::var("LEVELSET_ENGINE_TOKEN").ok())
                .unwrap_or_else(|| DEFAULT_ENGINE_TOKEN.to_string());
            self.inner.0.lock().unwrap().source = Some("env");
            self.set(Phase::Ready(EngineInfo {
                url: url.trim_end_matches('/').to_string(),
                token,
            }));
            return;
        }

        let demo = demo_requested(&app_data_dir);
        let workspace = workspace_dir(&app_data_dir, demo);
        let token = random_token();
        let Some((mut cmd, source)) = engine_command() else {
            self.inner.0.lock().unwrap().demo = demo;
            let msg = "levelset-engine.exe was not found next to Levelset.exe".to_string();
            if self.set(Phase::Failed(msg.clone())) {
                on_fail(msg);
            }
            return;
        };
        let _ = std::fs::create_dir_all(&workspace);
        cmd.arg("--port")
            .arg("0")
            .arg("--token")
            .arg(&token)
            .arg("--workspace")
            .arg(&workspace);
        if demo {
            cmd.arg("--demo");
        }
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_window(&mut cmd);

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let msg = format!("could not start the engine: {e}");
                if self.set(Phase::Failed(msg.clone())) {
                    on_fail(msg);
                }
                return;
            }
        };
        job::assign(&child);
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        {
            let mut g = self.inner.0.lock().unwrap();
            g.source = Some(source);
            g.demo = demo;
            g.child = Some(child);
        }

        // stderr: keep the tail for error messages, and keep draining so the pipe never fills
        let tail = Arc::new(Mutex::new(String::new()));
        if let Some(err) = stderr {
            let tail = tail.clone();
            std::thread::spawn(move || {
                let mut r = BufReader::new(err);
                let mut buf = [0u8; 4096];
                while let Ok(n) = r.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    let mut t = tail.lock().unwrap();
                    t.push_str(&String::from_utf8_lossy(&buf[..n]));
                    if t.len() > 4000 {
                        let cut = t.len() - 2000;
                        let cut = (cut..t.len()).find(|i| t.is_char_boundary(*i)).unwrap_or(0);
                        t.drain(..cut);
                    }
                }
            });
        }

        // stdout: the ready line, then keep draining
        let on_fail = Arc::new(on_fail);
        if let Some(out) = stdout {
            let me = self.clone();
            let tail = tail.clone();
            let on_fail = on_fail.clone();
            let token = token.clone();
            std::thread::spawn(move || {
                let mut ready = false;
                for line in BufReader::new(out).lines() {
                    let Ok(line) = line else { break };
                    if !ready {
                        if let Some(port) = parse_ready_line(&line) {
                            ready = true;
                            me.set(Phase::Ready(EngineInfo {
                                url: format!("http://127.0.0.1:{port}"),
                                token: token.clone(),
                            }));
                        }
                    }
                }
                // stdout closed: the engine exited
                if me.is_starting() {
                    std::thread::sleep(Duration::from_millis(200)); // let stderr drain
                    let detail = last_lines(&tail.lock().unwrap(), 6);
                    let msg = if detail.is_empty() {
                        "the engine exited before it was ready".to_string()
                    } else {
                        format!("the engine exited before it was ready:\n{detail}")
                    };
                    if me.set(Phase::Failed(msg.clone())) {
                        on_fail(msg);
                    }
                }
            });
        }

        // timeout watchdog
        let me = self.clone();
        std::thread::spawn(move || {
            if me.wait(READY_TIMEOUT).is_err() {
                let msg = format!(
                    "the engine did not report ready within {} s",
                    READY_TIMEOUT.as_secs()
                );
                if me.set(Phase::Failed(msg.clone())) {
                    me.shutdown();
                    on_fail(msg);
                }
            }
        });
    }
}

fn clean(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// `LEVELSET_ENGINE_READY port=51234` -> 51234
pub fn parse_ready_line(line: &str) -> Option<u16> {
    line.trim()
        .strip_prefix(READY_PREFIX)?
        .trim()
        .parse()
        .ok()
        .filter(|p| *p != 0)
}

pub fn demo_requested(app_data_dir: &Path) -> bool {
    let env = std::env::var("LEVELSET_DEMO").unwrap_or_default();
    matches!(env.trim(), "1" | "true" | "yes") || app_data_dir.join("demo").exists()
}

pub fn workspace_dir(app_data_dir: &Path, demo: bool) -> PathBuf {
    let ws = app_data_dir.join("workspace");
    if demo {
        ws.join("demo")
    } else {
        ws
    }
}

/// 32 random bytes as 64 hex chars.
pub fn random_token() -> String {
    let mut buf = [0u8; 32];
    getrandom::fill(&mut buf).expect("OS random number generator unavailable");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn last_lines(s: &str, n: usize) -> String {
    let lines: Vec<&str> = s.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

fn engine_command() -> Option<(Command, &'static str)> {
    let exe_name = if cfg!(windows) {
        "levelset-engine.exe"
    } else {
        "levelset-engine"
    };
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
    {
        let sidecar = dir.join(exe_name);
        if sidecar.is_file() {
            let mut cmd = Command::new(&sidecar);
            cmd.current_dir(&dir);
            return Some((cmd, "sidecar"));
        }
    }
    #[cfg(debug_assertions)]
    {
        // tauri dev without a built sidecar: run the engine from source
        let engine_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("engine");
        let py = if cfg!(windows) {
            engine_dir.join(".venv").join("Scripts").join("python.exe")
        } else {
            engine_dir.join(".venv").join("bin").join("python")
        };
        if py.is_file() {
            let mut cmd = Command::new(py);
            cmd.current_dir(&engine_dir)
                .arg("-m")
                .arg("levelset_engine");
            return Some((cmd, "dev-python"));
        }
    }
    None
}

#[cfg(windows)]
fn hide_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_window(_cmd: &mut Command) {}

/// Native error box (no WebView needed, so it works even if the UI never loads).
pub fn show_error_box(title: &str, text: &str) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            MessageBoxW, MB_ICONERROR, MB_OK, MB_SETFOREGROUND,
        };
        let wide = |s: &str| {
            s.encode_utf16()
                .chain(std::iter::once(0))
                .collect::<Vec<u16>>()
        };
        let (t, m) = (wide(title), wide(text));
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                m.as_ptr(),
                t.as_ptr(),
                MB_OK | MB_ICONERROR | MB_SETFOREGROUND,
            );
        }
    }
    #[cfg(not(windows))]
    eprintln!("{title}: {text}");
}

#[cfg(windows)]
mod job {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use std::sync::OnceLock;

    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    struct Job(HANDLE);
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    /// One job for the app's lifetime; never closed explicitly, so the OS closes it (and kills
    /// everything in it) when the Levelset process ends for any reason.
    static JOB: OnceLock<Option<Job>> = OnceLock::new();

    fn job() -> Option<HANDLE> {
        JOB.get_or_init(|| unsafe {
            let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if h.is_null() {
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                h,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                return None;
            }
            Some(Job(h))
        })
        .as_ref()
        .map(|j| j.0)
    }

    pub fn assign(child: &Child) {
        if let Some(h) = job() {
            unsafe {
                AssignProcessToJobObject(h, child.as_raw_handle() as HANDLE);
            }
        }
    }

    pub fn terminate() {
        if let Some(Some(j)) = JOB.get() {
            unsafe {
                TerminateJobObject(j.0, 0);
            }
        }
    }
}

#[cfg(not(windows))]
mod job {
    pub fn assign(_child: &std::process::Child) {}
    pub fn terminate() {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_line_parsing() {
        assert_eq!(
            parse_ready_line("LEVELSET_ENGINE_READY port=51234"),
            Some(51234)
        );
        assert_eq!(
            parse_ready_line("  LEVELSET_ENGINE_READY port=8765\r\n"),
            Some(8765)
        );
        assert_eq!(parse_ready_line("LEVELSET_ENGINE_READY port=0"), None);
        assert_eq!(parse_ready_line("INFO: started"), None);
    }

    #[test]
    fn token_is_64_hex_and_random() {
        let a = random_token();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, random_token());
    }

    #[test]
    fn demo_workspace_is_separate() {
        let d = Path::new("C:/data");
        assert_eq!(workspace_dir(d, false), d.join("workspace"));
        assert_eq!(workspace_dir(d, true), d.join("workspace").join("demo"));
    }

    #[test]
    fn env_override_is_ready_without_spawning() {
        std::env::set_var("LEVELSET_ENGINE_URL", "http://127.0.0.1:9001/");
        std::env::set_var("LEVELSET_ENGINE_TOKEN", "abc");
        let e = Engine::default();
        e.start(PathBuf::from("unused"), |_| panic!("must not fail"));
        std::env::remove_var("LEVELSET_ENGINE_URL");
        std::env::remove_var("LEVELSET_ENGINE_TOKEN");
        let info = e.wait(Duration::from_secs(1)).unwrap();
        assert_eq!(
            info,
            EngineInfo {
                url: "http://127.0.0.1:9001".into(),
                token: "abc".into()
            }
        );
        assert_eq!(e.status().source, Some("env"));
    }
}
