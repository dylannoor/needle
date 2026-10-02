//! Extension state without Tauri: folders, enabled flags, storage and the
//! permission-checked host API. Paths are injected so tests use tempdirs.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use needle_core::api::{ExtensionInfo, ExtensionManifest};
use serde_json::{Map, Value};

use super::perms::{self, Permission};

const MAX_FILE: u64 = 20 * 1024 * 1024;
const MAX_SOURCE: u64 = 5 * 1024 * 1024;
const MAX_STORAGE: usize = 5 * 1024 * 1024;
const MAX_INSTALL: u64 = 100 * 1024 * 1024;

struct Ext {
    info: ExtensionInfo,
    perms: Vec<Permission>,
}

pub struct Host {
    home: PathBuf,
    data: PathBuf,
    builtin: Option<PathBuf>,
    exts: Vec<Ext>,
}

impl Host {
    pub fn new(home: PathBuf, data: PathBuf, builtin: Option<PathBuf>) -> Self {
        Host {
            home,
            data,
            builtin,
            exts: vec![],
        }
    }

    fn installed_dir(&self) -> PathBuf {
        self.data.join("extensions")
    }

    fn state_file(&self) -> PathBuf {
        self.data.join("extensions.json")
    }

    fn storage_file(&self, id: &str) -> PathBuf {
        self.data
            .join("extension-storage")
            .join(format!("{id}.json"))
    }

    /// Rescan built-in and installed folders. Built-ins win on duplicate ids.
    pub fn load(&mut self) {
        let enabled = self.read_enabled();
        let mut exts: Vec<Ext> = vec![];
        let sources = [
            (self.builtin.clone(), true),
            (Some(self.installed_dir()), false),
        ];
        for (root, builtin) in sources {
            let Some(root) = root else { continue };
            let Ok(entries) = fs::read_dir(&root) else {
                continue;
            };
            let mut dirs: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir() && !hidden(p))
                .collect();
            dirs.sort();
            for dir in dirs {
                let ext = self.load_dir(&dir, builtin, &enabled);
                if exts
                    .iter()
                    .any(|e| e.info.manifest.id == ext.info.manifest.id)
                {
                    eprintln!("extensions: skipping duplicate id at {}", dir.display());
                    continue;
                }
                exts.push(ext);
            }
        }
        self.exts = exts;
    }

    fn load_dir(&self, dir: &Path, builtin: bool, enabled: &BTreeMap<String, bool>) -> Ext {
        let dir_str = dir.to_string_lossy().into_owned();
        match read_manifest(dir, &self.home) {
            Ok((manifest, perms)) => Ext {
                info: ExtensionInfo {
                    enabled: enabled.get(&manifest.id).copied().unwrap_or(false),
                    manifest,
                    dir: dir_str,
                    error: None,
                    builtin,
                },
                perms,
            },
            Err(error) => {
                let name = dir
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                Ext {
                    info: ExtensionInfo {
                        manifest: ExtensionManifest {
                            id: name.clone(),
                            name,
                            version: "0.0.0".into(),
                            description: String::new(),
                            author: None,
                            main: String::new(),
                            panel: None,
                            permissions: vec![],
                        },
                        enabled: false,
                        dir: dir_str,
                        error: Some(error),
                        builtin,
                    },
                    perms: vec![],
                }
            }
        }
    }

    pub fn list(&self) -> Vec<ExtensionInfo> {
        self.exts.iter().map(|e| e.info.clone()).collect()
    }

    fn get(&self, id: &str) -> Result<&Ext, String> {
        self.exts
            .iter()
            .find(|e| e.info.manifest.id == id)
            .ok_or_else(|| format!("no extension \"{id}\""))
    }

    fn enabled(&self, id: &str) -> Result<&Ext, String> {
        let ext = self.get(id)?;
        if !ext.info.enabled {
            return Err(format!("extension \"{id}\" is disabled"));
        }
        Ok(ext)
    }

    pub fn subscribers(&self, event: &str) -> Vec<String> {
        self.exts
            .iter()
            .filter(|e| e.info.enabled)
            .filter(|e| {
                e.perms
                    .iter()
                    .any(|p| matches!(p, Permission::Event(n) if n == event))
            })
            .map(|e| e.info.manifest.id.clone())
            .collect()
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool) -> Result<Vec<ExtensionInfo>, String> {
        let ext = self.get(id)?;
        if enabled && let Some(err) = &ext.info.error {
            return Err(format!("cannot enable \"{id}\": {err}"));
        }
        self.write_enabled(id, enabled)?;
        self.load();
        Ok(self.list())
    }

    /// Copy a folder into the installed dir after validating its manifest.
    /// Reinstalling replaces the old copy and disables it, so new permissions
    /// are approved again.
    pub fn install(&mut self, src: &Path) -> Result<Vec<ExtensionInfo>, String> {
        let src = src
            .canonicalize()
            .map_err(|e| format!("cannot open {}: {e}", src.display()))?;
        let (manifest, _) = read_manifest(&src, &self.home)?;
        let id = manifest.id;
        if self.get(&id).is_ok_and(|e| e.info.builtin) {
            return Err(format!("\"{id}\" is a built-in extension"));
        }
        let root = self.installed_dir();
        fs::create_dir_all(&root).map_err(io)?;
        let root = root.canonicalize().map_err(io)?;
        if src.starts_with(&root) {
            return Err("that folder is already an installed extension".into());
        }
        let staging = root.join(format!(".{id}.installing"));
        let _ = fs::remove_dir_all(&staging);
        let mut budget = MAX_INSTALL;
        if let Err(e) = copy_dir(&src, &staging, &mut budget) {
            let _ = fs::remove_dir_all(&staging);
            return Err(e);
        }
        let dest = root.join(&id);
        if dest.exists() {
            fs::remove_dir_all(&dest).map_err(io)?;
        }
        fs::rename(&staging, &dest).map_err(io)?;
        self.write_enabled(&id, false)?;
        self.load();
        Ok(self.list())
    }

    pub fn uninstall(&mut self, id: &str) -> Result<Vec<ExtensionInfo>, String> {
        let ext = self.get(id)?;
        if ext.info.builtin {
            return Err(format!("\"{id}\" is built in and cannot be removed"));
        }
        fs::remove_dir_all(&ext.info.dir).map_err(io)?;
        let _ = fs::remove_file(self.storage_file(id));
        self.write_enabled(id, false)?;
        self.load();
        Ok(self.list())
    }

    /// Source text of the worker, the panel, or a `.js` module the worker
    /// imports, always from inside the extension's own folder.
    pub fn source(&self, id: &str, file: &str) -> Result<String, String> {
        let ext = self.get(id)?;
        if let Some(err) = &ext.info.error {
            return Err(err.clone());
        }
        let m = &ext.info.manifest;
        let is_module = file.ends_with(".js") || file.ends_with(".mjs");
        if file != m.main && Some(file) != m.panel.as_deref() && !is_module {
            return Err(format!("\"{file}\" is not a source file of \"{id}\""));
        }
        let path = inner_file(Path::new(&ext.info.dir), file)?;
        read_limited(&path, MAX_SOURCE)
    }

    pub fn notify_args(&self, id: &str, args: &Value) -> Result<(String, String), String> {
        let ext = self.enabled(id)?;
        if !ext.perms.contains(&Permission::Notify) {
            return Err(format!("\"{id}\" has no notify permission"));
        }
        let title = str_arg(args, "title")?;
        let body = args.get("body").and_then(Value::as_str).unwrap_or("");
        Ok((truncate(title, 200), truncate(body, 1000)))
    }

    pub fn call(&self, id: &str, method: &str, args: &Value) -> Result<Value, String> {
        let ext = self.enabled(id)?;
        let path = |write| perms::check_path(&ext.perms, str_arg(args, "path")?, write, &self.home);
        match method {
            "fs.readText" => {
                let p = path(false)?;
                read_limited(&p, MAX_FILE).map(Value::String)
            }
            "fs.writeText" => {
                let text = str_arg(args, "text")?;
                if text.len() as u64 > MAX_FILE {
                    return Err("text is larger than 20 MB".into());
                }
                let p = path(true)?;
                if let Some(parent) = p.parent() {
                    fs::create_dir_all(parent).map_err(io)?;
                }
                write_atomic(&p, text.as_bytes())?;
                Ok(Value::Null)
            }
            "fs.exists" => Ok(Value::Bool(path(false)?.exists())),
            "fs.mkdir" => {
                fs::create_dir_all(path(true)?).map_err(io)?;
                Ok(Value::Null)
            }
            "storage.get" => {
                let key = key_arg(args)?;
                Ok(self.read_storage(id)?.remove(key).unwrap_or(Value::Null))
            }
            "storage.set" => {
                let key = key_arg(args)?;
                let mut store = self.read_storage(id)?;
                match args.get("value") {
                    None | Some(Value::Null) => store.remove(key),
                    Some(v) => store.insert(key.to_string(), v.clone()),
                };
                let text = serde_json::to_string(&store).map_err(|e| e.to_string())?;
                if text.len() > MAX_STORAGE {
                    return Err("extension storage is full (5 MB)".into());
                }
                let file = self.storage_file(id);
                fs::create_dir_all(file.parent().unwrap_or(&self.data)).map_err(io)?;
                write_atomic(&file, text.as_bytes())?;
                Ok(Value::Null)
            }
            "settings.get" => Ok(self
                .read_storage(id)?
                .remove("settings")
                .filter(Value::is_object)
                .unwrap_or_else(|| Value::Object(Map::new()))),
            "notify" => Err("notify is handled by the app".into()),
            _ => Err(format!("unknown method \"{method}\"")),
        }
    }

    fn read_storage(&self, id: &str) -> Result<Map<String, Value>, String> {
        match fs::read_to_string(self.storage_file(id)) {
            Ok(text) => serde_json::from_str(&text).map_err(|e| format!("storage is corrupt: {e}")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
            Err(e) => Err(io(e)),
        }
    }

    fn read_enabled(&self) -> BTreeMap<String, bool> {
        fs::read_to_string(self.state_file())
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| serde_json::from_value(v.get("enabled")?.clone()).ok())
            .unwrap_or_default()
    }

    fn write_enabled(&self, id: &str, enabled: bool) -> Result<(), String> {
        let mut map = self.read_enabled();
        if enabled {
            map.insert(id.to_string(), true);
        } else {
            map.remove(id);
        }
        fs::create_dir_all(&self.data).map_err(io)?;
        let text = serde_json::to_string_pretty(&serde_json::json!({ "enabled": map }))
            .map_err(|e| e.to_string())?;
        write_atomic(&self.state_file(), text.as_bytes())
    }
}

/// Parse and validate `<dir>/manifest.json`.
pub fn read_manifest(
    dir: &Path,
    home: &Path,
) -> Result<(ExtensionManifest, Vec<Permission>), String> {
    let text = read_limited(&dir.join("manifest.json"), 1024 * 1024)
        .map_err(|e| format!("manifest.json: {e}"))?;
    let m: ExtensionManifest =
        serde_json::from_str(&text).map_err(|e| format!("manifest.json: {e}"))?;
    let id_ok = !m.id.is_empty()
        && m.id.len() <= 64
        && !m.id.starts_with('-')
        && m.id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !id_ok {
        return Err(format!("invalid id \"{}\": use a-z, 0-9 and -", m.id));
    }
    if m.name.trim().is_empty() {
        return Err("name is empty".into());
    }
    if !semverish(&m.version) {
        return Err(format!("invalid version \"{}\": use x.y.z", m.version));
    }
    inner_file(dir, &m.main).map_err(|e| format!("main: {e}"))?;
    if let Some(panel) = &m.panel {
        inner_file(dir, panel).map_err(|e| format!("panel: {e}"))?;
    }
    let perms = m
        .permissions
        .iter()
        .map(|p| perms::parse(p, home))
        .collect::<Result<Vec<_>, _>>()?;
    Ok((m, perms))
}

fn semverish(v: &str) -> bool {
    let core = v.split(['-', '+']).next().unwrap_or("");
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// An existing file at a plain relative path inside `dir`, symlinks included.
fn inner_file(dir: &Path, rel: &str) -> Result<PathBuf, String> {
    let plain = !rel.is_empty()
        && !rel.contains('\\')
        && Path::new(rel)
            .components()
            .all(|c| matches!(c, Component::Normal(_)));
    if !plain {
        return Err(format!(
            "\"{rel}\" must be a relative path inside the extension"
        ));
    }
    let dir = dir.canonicalize().map_err(io)?;
    let path = dir
        .join(rel)
        .canonicalize()
        .map_err(|_| format!("\"{rel}\" does not exist"))?;
    if !path.starts_with(&dir) || !path.is_file() {
        return Err(format!("\"{rel}\" is not a file inside the extension"));
    }
    Ok(path)
}

fn read_limited(path: &Path, max: u64) -> Result<String, String> {
    let len = fs::metadata(path).map_err(io)?.len();
    if len > max {
        return Err(format!(
            "{} is larger than {} MB",
            path.display(),
            max / 1024 / 1024
        ));
    }
    fs::read_to_string(path).map_err(io)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let name = path.file_name().ok_or("not a file path")?.to_string_lossy();
    let tmp = path.with_file_name(format!(".{name}.{}.tmp", std::process::id()));
    fs::write(&tmp, bytes)
        .and_then(|_| fs::rename(&tmp, path))
        .map_err(|e| {
            let _ = fs::remove_file(&tmp);
            io(e)
        })
}

/// Copy regular files and folders, skipping symlinks, within a byte budget.
fn copy_dir(src: &Path, dest: &Path, budget: &mut u64) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(io)?;
    for entry in fs::read_dir(src).map_err(io)? {
        let entry = entry.map_err(io)?;
        let kind = entry.file_type().map_err(io)?;
        let to = dest.join(entry.file_name());
        if kind.is_dir() {
            copy_dir(&entry.path(), &to, budget)?;
        } else if kind.is_file() {
            let len = entry.metadata().map_err(io)?.len();
            *budget = budget
                .checked_sub(len)
                .ok_or("extension folder is larger than 100 MB")?;
            fs::copy(entry.path(), &to).map_err(io)?;
        }
    }
    Ok(())
}

fn hidden(p: &Path) -> bool {
    p.file_name()
        .is_some_and(|n| n.to_string_lossy().starts_with('.'))
}

fn str_arg<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing string argument \"{key}\""))
}

fn key_arg(args: &Value) -> Result<&str, String> {
    let key = str_arg(args, "key")?;
    if key.is_empty() || key.len() > 200 {
        return Err("key must be 1 to 200 characters".into());
    }
    Ok(key)
}

fn truncate(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

fn io(e: std::io::Error) -> String {
    e.to_string()
}

#[cfg(test)]
mod tests {
    use super::super::perms::tests::TempDir;
    use super::*;
    use serde_json::json;

    struct Fixture {
        t: TempDir,
        host: Host,
    }

    fn manifest(id: &str, perms: &[&str]) -> Value {
        json!({
            "id": id, "name": "Test", "version": "1.0.0", "description": "d",
            "main": "worker.js", "panel": "panel.html", "permissions": perms,
        })
    }

    fn write_ext(dir: &Path, manifest: &Value) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("manifest.json"), manifest.to_string()).unwrap();
        fs::write(dir.join("worker.js"), "import './lib/xml.js';").unwrap();
        fs::write(dir.join("panel.html"), "<p>panel</p>").unwrap();
        fs::create_dir_all(dir.join("lib")).unwrap();
        fs::write(dir.join("lib/xml.js"), "export {}").unwrap();
    }

    /// Home, data and a built-in "rekordbox" with music write + notify.
    fn fixture() -> Fixture {
        let t = TempDir::new();
        fs::create_dir_all(t.0.join("home/Music")).unwrap();
        write_ext(
            &t.0.join("builtin/rekordbox"),
            &manifest(
                "rekordbox",
                &["events:download.verified", "fs:write:~/Music", "notify"],
            ),
        );
        let mut host = Host::new(
            t.0.join("home"),
            t.0.join("data"),
            Some(t.0.join("builtin")),
        );
        host.load();
        Fixture { t, host }
    }

    fn enabled_fixture() -> Fixture {
        let mut f = fixture();
        f.host.set_enabled("rekordbox", true).unwrap();
        f
    }

    #[test]
    fn loads_builtins_disabled_by_default() {
        let f = fixture();
        let list = f.host.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].manifest.id, "rekordbox");
        assert!(list[0].builtin);
        assert!(!list[0].enabled);
        assert_eq!(list[0].error, None);
    }

    #[test]
    fn enabled_state_persists_across_reload() {
        let f = enabled_fixture();
        let mut again = Host::new(
            f.t.0.join("home"),
            f.t.0.join("data"),
            Some(f.t.0.join("builtin")),
        );
        again.load();
        assert!(again.list()[0].enabled);
        again.set_enabled("rekordbox", false).unwrap();
        again.load();
        assert!(!again.list()[0].enabled);
    }

    #[test]
    fn set_enabled_unknown_id_fails() {
        let mut f = fixture();
        assert!(f.host.set_enabled("nope", true).is_err());
    }

    #[test]
    fn invalid_manifest_is_listed_with_error_and_cannot_be_enabled() {
        let mut f = fixture();
        write_ext(
            &f.t.0.join("builtin/broken"),
            &manifest("broken", &["network"]),
        );
        f.host.load();
        let broken = f
            .host
            .list()
            .into_iter()
            .find(|e| e.manifest.id == "broken")
            .unwrap();
        assert!(broken.error.unwrap().contains("unknown permission"));
        assert!(f.host.set_enabled("broken", true).is_err());
    }

    #[test]
    fn manifest_validation() {
        let t = TempDir::new();
        let home = t.0.join("home");
        let check = |m: Value| {
            let dir = t.0.join("x");
            let _ = fs::remove_dir_all(&dir);
            write_ext(&dir, &m);
            read_manifest(&dir, &home)
        };
        assert!(check(manifest("ok-1", &["notify"])).is_ok());
        for id in [
            "",
            "Upper",
            "under_score",
            "-lead",
            "dot.ted",
            &"a".repeat(65),
        ] {
            assert!(check(manifest(id, &[])).is_err(), "id {id:?}");
        }
        assert!(check(manifest(&"a".repeat(64), &[])).is_ok());
        for v in ["1", "1.0", "1.0.0.0", "a.b.c", "1..0", ""] {
            let mut m = manifest("x", &[]);
            m["version"] = json!(v);
            assert!(check(m).is_err(), "version {v:?}");
        }
        for v in ["0.1.0", "1.2.3-beta.1", "1.2.3+build"] {
            let mut m = manifest("x", &[]);
            m["version"] = json!(v);
            assert!(check(m).is_ok(), "version {v:?}");
        }
        for main in [
            "missing.js",
            "../worker.js",
            "/etc/passwd",
            "./worker.js",
            "lib",
        ] {
            let mut m = manifest("x", &[]);
            m["main"] = json!(main);
            assert!(check(m).is_err(), "main {main:?}");
        }
        let mut m = manifest("x", &[]);
        m["panel"] = Value::Null;
        assert!(check(m).is_ok());
        let mut m = manifest("x", &[]);
        m["name"] = json!(" ");
        assert!(check(m).is_err());
    }

    #[test]
    fn install_copies_validates_and_starts_disabled() {
        let mut f = fixture();
        let src = f.t.0.join("src/my-ext");
        write_ext(&src, &manifest("my-ext", &["fs:read:~/Music"]));
        let list = f.host.install(&src).unwrap();
        let ext = list.iter().find(|e| e.manifest.id == "my-ext").unwrap();
        assert!(!ext.builtin && !ext.enabled);
        assert!(Path::new(&ext.dir).join("lib/xml.js").is_file());
        assert!(Path::new(&ext.dir).starts_with(f.t.0.join("data/extensions")));
    }

    #[test]
    fn reinstall_replaces_and_disables() {
        let mut f = fixture();
        let src = f.t.0.join("src/my-ext");
        write_ext(&src, &manifest("my-ext", &[]));
        f.host.install(&src).unwrap();
        f.host.set_enabled("my-ext", true).unwrap();
        fs::write(src.join("worker.js"), "// v2").unwrap();
        let list = f.host.install(&src).unwrap();
        assert!(
            !list
                .iter()
                .find(|e| e.manifest.id == "my-ext")
                .unwrap()
                .enabled
        );
        assert_eq!(f.host.source("my-ext", "worker.js").unwrap(), "// v2");
    }

    #[test]
    fn install_rejects_invalid_or_builtin_or_self() {
        let mut f = fixture();
        let bad = f.t.0.join("src/bad");
        write_ext(&bad, &manifest("bad", &["fs:write:relative"]));
        assert!(f.host.install(&bad).is_err());
        assert!(!f.t.0.join("data/extensions/bad").exists());

        let clash = f.t.0.join("src/clash");
        write_ext(&clash, &manifest("rekordbox", &[]));
        assert!(f.host.install(&clash).unwrap_err().contains("built-in"));

        assert!(f.host.install(&f.t.0.join("src/missing")).is_err());

        let ok = f.t.0.join("src/ok");
        write_ext(&ok, &manifest("ok", &[]));
        f.host.install(&ok).unwrap();
        assert!(f.host.install(&f.t.0.join("data/extensions/ok")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn install_skips_symlinks() {
        let mut f = fixture();
        let src = f.t.0.join("src/linky");
        write_ext(&src, &manifest("linky", &[]));
        fs::write(f.t.0.join("secret"), "s").unwrap();
        std::os::unix::fs::symlink(f.t.0.join("secret"), src.join("secret")).unwrap();
        f.host.install(&src).unwrap();
        assert!(!f.t.0.join("data/extensions/linky/secret").exists());
    }

    #[test]
    fn uninstall_removes_installed_but_not_builtin() {
        let mut f = fixture();
        let src = f.t.0.join("src/my-ext");
        write_ext(&src, &manifest("my-ext", &[]));
        f.host.install(&src).unwrap();
        f.host.set_enabled("my-ext", true).unwrap();
        f.host
            .call("my-ext", "storage.set", &json!({"key": "a", "value": 1}))
            .unwrap();
        let list = f.host.uninstall("my-ext").unwrap();
        assert!(list.iter().all(|e| e.manifest.id != "my-ext"));
        assert!(!f.t.0.join("data/extensions/my-ext").exists());
        assert!(!f.t.0.join("data/extension-storage/my-ext.json").exists());
        assert!(f.host.uninstall("rekordbox").is_err());
        assert!(f.host.uninstall("nope").is_err());
    }

    #[test]
    fn source_serves_main_panel_and_inner_modules_only() {
        let f = fixture();
        assert_eq!(
            f.host.source("rekordbox", "panel.html").unwrap(),
            "<p>panel</p>"
        );
        assert!(f.host.source("rekordbox", "worker.js").is_ok());
        assert_eq!(
            f.host.source("rekordbox", "lib/xml.js").unwrap(),
            "export {}"
        );
        assert!(f.host.source("rekordbox", "manifest.json").is_err());
        assert!(
            f.host
                .source("rekordbox", "../rekordbox/worker.js")
                .is_err()
        );
        assert!(f.host.source("rekordbox", "/etc/hosts.js").is_err());
        assert!(f.host.source("rekordbox", "missing.js").is_err());
        assert!(f.host.source("nope", "worker.js").is_err());
    }

    #[test]
    fn calls_require_an_enabled_extension() {
        let f = fixture();
        let err = f
            .host
            .call("rekordbox", "storage.get", &json!({"key": "a"}))
            .unwrap_err();
        assert!(err.contains("disabled"));
        assert!(
            f.host
                .call("nope", "storage.get", &json!({"key": "a"}))
                .is_err()
        );
        assert!(
            f.host
                .notify_args("rekordbox", &json!({"title": "t"}))
                .is_err()
        );
    }

    #[test]
    fn fs_write_read_exists_mkdir_inside_grant() {
        let f = enabled_fixture();
        let h = &f.host;
        let p = "~/Music/Needle/deep/rekordbox.xml";
        assert_eq!(
            h.call("rekordbox", "fs.exists", &json!({"path": p}))
                .unwrap(),
            json!(false)
        );
        h.call(
            "rekordbox",
            "fs.writeText",
            &json!({"path": p, "text": "<x/>"}),
        )
        .unwrap();
        assert_eq!(
            h.call("rekordbox", "fs.readText", &json!({"path": p}))
                .unwrap(),
            json!("<x/>")
        );
        assert_eq!(
            h.call("rekordbox", "fs.exists", &json!({"path": p}))
                .unwrap(),
            json!(true)
        );
        h.call(
            "rekordbox",
            "fs.writeText",
            &json!({"path": p, "text": "<y/>"}),
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(f.t.0.join("home/Music/Needle/deep/rekordbox.xml")).unwrap(),
            "<y/>"
        );
        let leftovers: Vec<_> = fs::read_dir(f.t.0.join("home/Music/Needle/deep"))
            .unwrap()
            .collect();
        assert_eq!(leftovers.len(), 1, "no temp files left behind");
        h.call("rekordbox", "fs.mkdir", &json!({"path": "~/Music/a/b"}))
            .unwrap();
        assert!(f.t.0.join("home/Music/a/b").is_dir());
    }

    #[test]
    fn fs_calls_outside_grant_are_denied_and_touch_nothing() {
        let f = enabled_fixture();
        let h = &f.host;
        for p in ["~/Documents/x.xml", "~/Music/../x.xml", "x.xml"] {
            assert!(
                h.call(
                    "rekordbox",
                    "fs.writeText",
                    &json!({"path": p, "text": "x"})
                )
                .is_err(),
                "{p}"
            );
            assert!(
                h.call("rekordbox", "fs.readText", &json!({"path": p}))
                    .is_err(),
                "{p}"
            );
            assert!(
                h.call("rekordbox", "fs.exists", &json!({"path": p}))
                    .is_err(),
                "{p}"
            );
            assert!(
                h.call("rekordbox", "fs.mkdir", &json!({"path": p}))
                    .is_err(),
                "{p}"
            );
        }
        assert!(!f.t.0.join("home/Documents").exists());
        assert!(!f.t.0.join("home/x.xml").exists());
    }

    #[test]
    fn fs_args_are_validated() {
        let f = enabled_fixture();
        assert!(f.host.call("rekordbox", "fs.readText", &json!({})).is_err());
        assert!(
            f.host
                .call("rekordbox", "fs.readText", &json!({"path": 1}))
                .is_err()
        );
        assert!(
            f.host
                .call("rekordbox", "fs.writeText", &json!({"path": "~/Music/a"}))
                .is_err()
        );
        assert!(
            f.host
                .call("rekordbox", "fs.delete", &json!({"path": "~/Music/a"}))
                .is_err()
        );
    }

    #[test]
    fn file_size_limit() {
        let f = enabled_fixture();
        let at = "a".repeat(MAX_FILE as usize);
        f.host
            .call(
                "rekordbox",
                "fs.writeText",
                &json!({"path": "~/Music/big", "text": at}),
            )
            .unwrap();
        assert!(
            f.host
                .call("rekordbox", "fs.readText", &json!({"path": "~/Music/big"}))
                .is_ok()
        );
        let over = "a".repeat(MAX_FILE as usize + 1);
        assert!(
            f.host
                .call(
                    "rekordbox",
                    "fs.writeText",
                    &json!({"path": "~/Music/big2", "text": over.clone()})
                )
                .is_err()
        );
        fs::write(f.t.0.join("home/Music/big3"), over).unwrap();
        assert!(
            f.host
                .call("rekordbox", "fs.readText", &json!({"path": "~/Music/big3"}))
                .is_err()
        );
    }

    #[test]
    fn storage_roundtrip_and_isolation() {
        let mut f = enabled_fixture();
        let h = &f.host;
        assert_eq!(
            h.call("rekordbox", "storage.get", &json!({"key": "lib"}))
                .unwrap(),
            Value::Null
        );
        h.call(
            "rekordbox",
            "storage.set",
            &json!({"key": "lib", "value": [1, {"a": "b"}]}),
        )
        .unwrap();
        assert_eq!(
            h.call("rekordbox", "storage.get", &json!({"key": "lib"}))
                .unwrap(),
            json!([1, {"a": "b"}])
        );
        h.call(
            "rekordbox",
            "storage.set",
            &json!({"key": "lib", "value": null}),
        )
        .unwrap();
        assert_eq!(
            h.call("rekordbox", "storage.get", &json!({"key": "lib"}))
                .unwrap(),
            Value::Null
        );

        let src = f.t.0.join("src/other");
        write_ext(&src, &manifest("other", &[]));
        f.host.install(&src).unwrap();
        f.host.set_enabled("other", true).unwrap();
        f.host
            .call("rekordbox", "storage.set", &json!({"key": "k", "value": 1}))
            .unwrap();
        assert_eq!(
            f.host
                .call("other", "storage.get", &json!({"key": "k"}))
                .unwrap(),
            Value::Null
        );
    }

    #[test]
    fn storage_key_and_size_limits() {
        let f = enabled_fixture();
        let h = &f.host;
        assert!(
            h.call("rekordbox", "storage.set", &json!({"key": "", "value": 1}))
                .is_err()
        );
        assert!(
            h.call(
                "rekordbox",
                "storage.set",
                &json!({"key": "k".repeat(201), "value": 1})
            )
            .is_err()
        );
        assert!(
            h.call(
                "rekordbox",
                "storage.set",
                &json!({"key": "k".repeat(200), "value": 1})
            )
            .is_ok()
        );
        let big = "a".repeat(MAX_STORAGE);
        assert!(
            h.call(
                "rekordbox",
                "storage.set",
                &json!({"key": "big", "value": big})
            )
            .unwrap_err()
            .contains("full")
        );
        assert_eq!(
            h.call("rekordbox", "storage.get", &json!({"key": "big"}))
                .unwrap(),
            Value::Null
        );
    }

    #[test]
    fn settings_get_reads_the_settings_key() {
        let f = enabled_fixture();
        let h = &f.host;
        assert_eq!(
            h.call("rekordbox", "settings.get", &json!({})).unwrap(),
            json!({})
        );
        h.call(
            "rekordbox",
            "storage.set",
            &json!({"key": "settings", "value": {"path": "~/Music/x.xml"}}),
        )
        .unwrap();
        assert_eq!(
            h.call("rekordbox", "settings.get", &Value::Null).unwrap(),
            json!({"path": "~/Music/x.xml"})
        );
    }

    #[test]
    fn notify_needs_permission_and_title() {
        let mut f = enabled_fixture();
        assert_eq!(
            f.host
                .notify_args("rekordbox", &json!({"title": "Hi", "body": "there"}))
                .unwrap(),
            ("Hi".to_string(), "there".to_string())
        );
        assert!(
            f.host
                .notify_args("rekordbox", &json!({"body": "x"}))
                .is_err()
        );
        let src = f.t.0.join("src/quiet");
        write_ext(&src, &manifest("quiet", &[]));
        f.host.install(&src).unwrap();
        f.host.set_enabled("quiet", true).unwrap();
        assert!(
            f.host
                .notify_args("quiet", &json!({"title": "x"}))
                .unwrap_err()
                .contains("notify")
        );
    }

    #[test]
    fn first_party_extensions_have_valid_manifests() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../extensions");
        let home = std::env::temp_dir().join("needle-home");
        let mut host = Host::new(home, std::env::temp_dir().join("needle-none"), Some(root));
        host.load();
        let list = host.list();
        assert!(list.iter().any(|e| e.manifest.id == "rekordbox"));
        for e in list {
            assert_eq!(e.error, None, "{}", e.manifest.id);
        }
    }

    #[test]
    fn subscribers_are_enabled_extensions_with_the_event_permission() {
        let mut f = fixture();
        assert!(f.host.subscribers("download.verified").is_empty());
        f.host.set_enabled("rekordbox", true).unwrap();
        assert_eq!(f.host.subscribers("download.verified"), vec!["rekordbox"]);
        assert!(f.host.subscribers("download.completed").is_empty());
    }
}
