//! Secrets (e.g. the optional Claude API key) in the OS credential store:
//! Windows Credential Manager on Windows, via the `keyring` crate.
//!
//! The UI can save, check and delete a secret but can never read it back:
//! there is deliberately no `get_secret` command. The engine / future AI code
//! reads it on the Rust side only.

use keyring::Entry;

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

/// Save (or replace) a secret. The value never comes back to the UI.
#[tauri::command]
pub fn set_secret(name: String, value: String) -> Result<(), String> {
    validate_value(&value)?;
    entry(&name)?
        .set_password(value.trim())
        .map_err(|e| e.to_string())
}

/// True when a secret with this name is stored.
#[tauri::command]
pub fn has_secret(name: String) -> Result<bool, String> {
    match entry(&name)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

/// Delete a secret. Deleting a missing secret is not an error.
#[tauri::command]
pub fn delete_secret(name: String) -> Result<(), String> {
    match entry(&name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
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
        assert!(set_secret("Bad Name".into(), "v".into()).is_err());
        assert!(has_secret("Bad Name".into()).is_err());
        assert!(delete_secret("Bad Name".into()).is_err());
    }
}
