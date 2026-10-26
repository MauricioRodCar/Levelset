//! Secrets (e.g. the optional Claude API key) in the OS credential store:
//! Windows Credential Manager on Windows, via the `keyring` crate.
//!
//! The UI can save, check and delete a secret but can never read it back:
//! there is deliberately no `get_secret` command. The engine / future AI code
//! reads it on the Rust side only.
//!
//! The Claude API key (`claude_api_key`) is pushed to the engine, never to the UI:
//! `PUT /ai/key` once the engine is healthy and after every save, `DELETE /ai/key`
//! after a delete. The engine keeps it in memory only. The key never appears in an
//! error message, a log line or a command result.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use keyring::Entry;

use crate::engine::{Engine, EngineInfo, READY_TIMEOUT};

/// The secret the AI assistant uses (Settings > AI saves it under this name).
pub const CLAUDE_KEY: &str = "claude_api_key";

/// Credential Manager "target" prefix: entries show up as `Levelset/<name>`.
const SERVICE: &str = "Levelset";
const MAX_SECRET_LEN: usize = 4096;

/// Secret names are short machine names: 1-64 chars of `a-z 0-9 _ . -`, starting with a letter.
pub fn validate_name(name: &str) -> Result<(), String> {
    let ok_len = !name.is_empty() && name.len() <= 64;
    let ok_first = name.chars().next().is_some_and(|c| c.is_ascii_lowercase());
    let ok_chars = name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '.' | '-'));
    if ok_len && ok_first && ok_chars {
        Ok(())
    } else {
        Err(format!("invalid secret name: {name:?}"))
    }
}

fn validate_value(value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err("the secret is empty".into());
    }
    if value.len() > MAX_SECRET_LEN {
        return Err("the secret is too long".into());
    }
    Ok(())
}

fn entry(name: &str) -> Result<Entry, String> {
    validate_name(name)?;
    Entry::new(SERVICE, name).map_err(|e| e.to_string())
}

fn store_secret(name: &str, value: &str) -> Result<(), String> {
    validate_value(value)?;
    entry(name)?
        .set_password(value.trim())
        .map_err(|e| e.to_string())
}

fn secret_exists(name: &str) -> Result<bool, String> {
    match entry(name)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

fn remove_secret(name: &str) -> Result<(), String> {
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Save (or replace) a secret. The value never comes back to the UI.
#[tauri::command]
pub fn set_secret(
    engine: tauri::State<'_, Engine>,
    name: String,
    value: String,
) -> Result<(), String> {
    store_secret(&name, &value)?;
    if name == CLAUDE_KEY {
        push_claude_key(engine.inner().clone());
    }
    Ok(())
}

/// True when a secret with this name is stored.
#[tauri::command]
pub fn has_secret(name: String) -> Result<bool, String> {
    secret_exists(&name)
}

/// Delete a secret. Deleting a missing secret is not an error.
#[tauri::command]
pub fn delete_secret(engine: tauri::State<'_, Engine>, name: String) -> Result<(), String> {
    remove_secret(&name)?;
    if name == CLAUDE_KEY {
        push_claude_key(engine.inner().clone());
    }
    Ok(())
}

// ------------------------------------------------------------------ key push to the engine

/// In the background: wait until the engine is ready and healthy, then send it the stored
/// Claude key (`PUT /ai/key`) or tell it there is none (`DELETE /ai/key`). Called at startup
/// and after `set_secret` / `delete_secret` of `claude_api_key`. Failures only print a
/// key-free line on stderr: AI then reports "no key" until the next push.
pub fn push_claude_key(engine: Engine) {
    std::thread::spawn(move || {
        let Ok(info) = engine.wait(READY_TIMEOUT + Duration::from_secs(1)) else {
            return;
        };
        if !wait_healthy(&info) {
            eprintln!("levelset: engine not healthy, Claude key not pushed");
            return;
        }
        let stored = entry(CLAUDE_KEY).and_then(|e| match e.get_password() {
            Ok(k) => Ok(Some(k)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        });
        let result = match stored {
            Ok(Some(key)) => {
                let body = serde_json::json!({ "key": key }).to_string();
                engine_request(&info, "PUT", "/ai/key", Some(&body))
            }
            Ok(None) => engine_request(&info, "DELETE", "/ai/key", None),
            Err(_) => {
                eprintln!("levelset: could not read the Claude key from Credential Manager");
                return;
            }
        };
        match result {
            Ok(204) => {}
            Ok(status) => eprintln!("levelset: engine answered {status} to the Claude key push"),
            Err(e) => eprintln!("levelset: Claude key push failed: {e}"),
        }
    });
}

fn wait_healthy(info: &EngineInfo) -> bool {
    for _ in 0..50 {
        if matches!(engine_request(info, "GET", "/health", None), Ok(200)) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

/// `http://127.0.0.1:<port>` -> socket address. Only an engine on this computer is accepted.
fn engine_addr(url: &str) -> Result<SocketAddr, String> {
    let rest = url
        .strip_prefix("http://")
        .ok_or_else(|| "engine url is not http://".to_string())?;
    let host_port = rest.split('/').next().unwrap_or_default();
    let host_port = host_port.replacen("localhost", "127.0.0.1", 1);
    let addr: SocketAddr = host_port
        .parse()
        .map_err(|_| "engine url has no host:port".to_string())?;
    if addr.ip().is_loopback() {
        Ok(addr)
    } else {
        Err("engine is not on this computer".into())
    }
}

/// Minimal HTTP/1.1 request to the local engine; returns the status code.
/// Errors carry only the I/O error kind, never the request (which may hold the key).
fn engine_request(
    info: &EngineInfo,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<u16, String> {
    let addr = engine_addr(&info.url)?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(2))
        .map_err(|e| format!("connect: {}", e.kind()))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|e| format!("socket: {}", e.kind()))?;
    let body = body.unwrap_or("");
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {addr}\r\nAuthorization: Bearer {token}\r\n\
         Content-Type: application/json\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n{body}",
        token = info.token,
        len = body.len(),
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("send: {}", e.kind()))?;
    let mut head = [0u8; 64];
    let n = stream
        .read(&mut head)
        .map_err(|e| format!("read: {}", e.kind()))?;
    parse_status(&head[..n]).ok_or_else(|| "bad HTTP answer".to_string())
}

fn parse_status(head: &[u8]) -> Option<u16> {
    let line = String::from_utf8_lossy(head);
    let mut parts = line.split_whitespace();
    if !parts.next()?.starts_with("HTTP/1.") {
        return None;
    }
    parts.next()?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_machine_names() {
        for ok in ["claude_api_key", "a", "sec.user-agent", "k2"] {
            assert!(validate_name(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn rejects_bad_names() {
        let long = "a".repeat(65);
        for bad in [
            "",
            "Claude",
            "1key",
            "_key",
            "key name",
            "key/../x",
            "clé",
            long.as_str(),
        ] {
            assert!(validate_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn rejects_empty_or_huge_values() {
        assert!(validate_value("  ").is_err());
        assert!(validate_value(&"x".repeat(MAX_SECRET_LEN + 1)).is_err());
        assert!(validate_value("sk-ant-abc").is_ok());
    }

    #[test]
    fn invalid_name_fails_before_touching_the_store() {
        assert!(store_secret("Bad Name", "v").is_err());
        assert!(secret_exists("Bad Name").is_err());
        assert!(remove_secret("Bad Name").is_err());
    }

    #[test]
    fn engine_address_is_loopback_only() {
        assert_eq!(
            engine_addr("http://127.0.0.1:8765").unwrap(),
            "127.0.0.1:8765".parse::<SocketAddr>().unwrap()
        );
        assert!(engine_addr("http://localhost:9001/").is_ok());
        assert!(engine_addr("http://10.0.0.5:8765").is_err());
        assert!(engine_addr("https://127.0.0.1:8765").is_err());
        assert!(engine_addr("http://127.0.0.1").is_err());
    }

    #[test]
    fn status_line_parsing() {
        assert_eq!(parse_status(b"HTTP/1.1 204 No Content\r\n"), Some(204));
        assert_eq!(parse_status(b"HTTP/1.0 422 Unprocessable"), Some(422));
        assert_eq!(parse_status(b"garbage"), None);
    }

    #[test]
    fn push_errors_never_contain_the_key() {
        // nothing listens on port 9: the request fails and the error stays key-free
        let info = EngineInfo {
            url: "http://127.0.0.1:9".into(),
            token: "t".into(),
        };
        let body = r#"{"key":"sk-ant-secret-value"}"#;
        if let Err(e) = engine_request(&info, "PUT", "/ai/key", Some(body)) {
            assert!(!e.contains("sk-ant"));
        }
    }
}
