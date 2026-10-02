//! Manifest permissions and the path checks behind the `fs.*` host calls.

use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub enum Permission {
    Event(String),
    FsRead(PathBuf),
    /// Write implies read.
    FsWrite(PathBuf),
    Notify,
}

/// Parse one manifest permission. Unknown kinds are an error, not ignored.
pub fn parse(raw: &str, home: &Path) -> Result<Permission, String> {
    if raw == "notify" {
        return Ok(Permission::Notify);
    }
    if let Some(name) = raw.strip_prefix("events:") {
        let ok = !name.is_empty()
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
        return if ok {
            Ok(Permission::Event(name.to_string()))
        } else {
            Err(format!("invalid event name in \"{raw}\""))
        };
    }
    let fs = |dir: &str| -> Result<PathBuf, String> {
        let dir = absolute(dir, home)?;
        if dir.parent().is_none() {
            return Err(format!("\"{raw}\" grants the whole filesystem"));
        }
        Ok(dir)
    };
    if let Some(dir) = raw.strip_prefix("fs:read:") {
        return Ok(Permission::FsRead(fs(dir)?));
    }
    if let Some(dir) = raw.strip_prefix("fs:write:") {
        return Ok(Permission::FsWrite(fs(dir)?));
    }
    Err(format!("unknown permission \"{raw}\""))
}

/// Expand `~`, require an absolute path and fold `.` and `..` lexically.
pub fn absolute(raw: &str, home: &Path) -> Result<PathBuf, String> {
    let expanded = if raw == "~" {
        home.to_path_buf()
    } else if let Some(rest) = raw.strip_prefix("~/") {
        home.join(rest)
    } else {
        PathBuf::from(raw)
    };
    if raw.is_empty() || !expanded.is_absolute() {
        return Err(format!("path must be absolute or start with ~/: \"{raw}\""));
    }
    let mut out = PathBuf::new();
    for c in expanded.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    Ok(out)
}

/// Resolve symlinks in the longest existing prefix of an absolute, already
/// normalized path and append the missing rest. A dangling symlink is an error,
/// since writing through it would land wherever it points.
pub fn resolve(path: &Path) -> Result<PathBuf, String> {
    let mut existing = path.to_path_buf();
    let mut rest = Vec::new();
    while existing.symlink_metadata().is_err() {
        match existing.file_name() {
            Some(name) => rest.push(name.to_owned()),
            None => break,
        }
        existing.pop();
    }
    let mut out = existing
        .canonicalize()
        .map_err(|e| format!("cannot resolve {}: {e}", existing.display()))?;
    out.extend(rest.iter().rev());
    Ok(out)
}

/// The resolved path if one of the granted directories contains it.
pub fn check_path(
    perms: &[Permission],
    raw: &str,
    write: bool,
    home: &Path,
) -> Result<PathBuf, String> {
    let target = resolve(&absolute(raw, home)?)?;
    let granted = perms.iter().any(|p| {
        let dir = match p {
            Permission::FsWrite(d) => d,
            Permission::FsRead(d) if !write => d,
            _ => return false,
        };
        resolve(dir).is_ok_and(|dir| target.starts_with(dir))
    });
    if granted {
        Ok(target)
    } else {
        let verb = if write { "write" } else { "read" };
        Err(format!("no permission to {verb} {raw}"))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::fs;

    /// A fresh, canonical temp dir removed on drop.
    pub struct TempDir(pub PathBuf);
    impl TempDir {
        pub fn new() -> Self {
            use std::sync::atomic::{AtomicU32, Ordering};
            static N: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir().join(format!(
                "needle-ext-test-{}-{}",
                std::process::id(),
                N.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            TempDir(dir.canonicalize().unwrap())
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn home() -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(r"C:\home\me")
        } else {
            PathBuf::from("/home/me")
        }
    }

    #[test]
    fn parses_known_permissions() {
        let h = home();
        assert_eq!(parse("notify", &h), Ok(Permission::Notify));
        assert_eq!(
            parse("events:download.verified", &h),
            Ok(Permission::Event("download.verified".into()))
        );
        assert_eq!(
            parse("fs:write:~/Music", &h),
            Ok(Permission::FsWrite(h.join("Music")))
        );
        #[cfg(unix)]
        assert_eq!(
            parse("fs:read:/data/./x/../y", &h),
            Ok(Permission::FsRead("/data/y".into()))
        );
    }

    #[test]
    fn rejects_unknown_and_malformed_permissions() {
        let h = home();
        for bad in [
            "",
            "network",
            "jobs:read",
            "notify:all",
            "events:",
            "events:a b",
            "fs:read:",
            "fs:read:relative/dir",
            "fs:write:Music",
            "fs:write:/",
            "fs:write:/..",
            "fs:exec:/tmp",
            "~/Music",
        ] {
            assert!(parse(bad, &h).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn absolute_expands_home_and_folds_dots() {
        let h = home();
        assert_eq!(absolute("~", &h).unwrap(), h);
        assert_eq!(
            absolute("~/Music/../Music/./a", &h).unwrap(),
            h.join("Music").join("a")
        );
        #[cfg(unix)]
        assert_eq!(absolute("/../../etc", &h).unwrap(), PathBuf::from("/etc"));
        assert!(absolute("~user/x", &h).is_err());
        assert!(absolute("./x", &h).is_err());
        assert!(absolute("", &h).is_err());
    }

    #[test]
    fn allows_paths_inside_the_grant_including_missing_ones() {
        let t = TempDir::new();
        let grant = t.0.join("music");
        fs::create_dir(&grant).unwrap();
        let perms = [Permission::FsWrite(grant.clone())];
        let p = format!("{}/Needle/new/rekordbox.xml", grant.display());
        assert_eq!(
            check_path(&perms, &p, true, &t.0).unwrap(),
            grant.join("Needle/new/rekordbox.xml")
        );
        assert_eq!(
            check_path(&perms, grant.to_str().unwrap(), true, &t.0).unwrap(),
            grant
        );
    }

    #[test]
    fn tilde_paths_resolve_against_home() {
        let t = TempDir::new();
        fs::create_dir(t.0.join("Music")).unwrap();
        let perms = [parse("fs:write:~/Music", &t.0).unwrap()];
        assert_eq!(
            check_path(&perms, "~/Music/a.xml", true, &t.0).unwrap(),
            t.0.join("Music/a.xml")
        );
        assert!(check_path(&perms, "~/Documents/a.xml", true, &t.0).is_err());
    }

    #[test]
    fn dot_dot_cannot_leave_the_grant() {
        let t = TempDir::new();
        let grant = t.0.join("music");
        fs::create_dir(&grant).unwrap();
        let perms = [Permission::FsWrite(grant.clone())];
        for p in [
            format!("{}/../secret", grant.display()),
            format!("{}/a/../../secret", grant.display()),
            format!("{}/../music-evil/x", grant.display()),
        ] {
            assert!(check_path(&perms, &p, true, &t.0).is_err(), "{p}");
        }
        // `..` that stays inside is fine.
        let inside = format!("{}/a/../b", grant.display());
        assert_eq!(
            check_path(&perms, &inside, true, &t.0).unwrap(),
            grant.join("b")
        );
    }

    #[test]
    fn sibling_with_same_prefix_is_not_inside() {
        let t = TempDir::new();
        fs::create_dir(t.0.join("music")).unwrap();
        fs::create_dir(t.0.join("music2")).unwrap();
        let perms = [Permission::FsRead(t.0.join("music"))];
        let p = format!("{}/music2/x", t.0.display());
        assert!(check_path(&perms, &p, false, &t.0).is_err());
    }

    #[test]
    fn read_grant_does_not_allow_write_but_write_allows_read() {
        let t = TempDir::new();
        let p = format!("{}/x.txt", t.0.display());
        let read = [Permission::FsRead(t.0.clone())];
        assert!(check_path(&read, &p, false, &t.0).is_ok());
        assert!(check_path(&read, &p, true, &t.0).is_err());
        let write = [Permission::FsWrite(t.0.clone())];
        assert!(check_path(&write, &p, false, &t.0).is_ok());
    }

    #[test]
    fn no_fs_permission_means_no_access() {
        let t = TempDir::new();
        let perms = [Permission::Notify, Permission::Event("x".into())];
        let p = format!("{}/x", t.0.display());
        assert!(check_path(&perms, &p, false, &t.0).is_err());
        assert!(check_path(&[], &p, false, &t.0).is_err());
    }

    #[test]
    fn relative_paths_are_rejected() {
        let t = TempDir::new();
        let perms = [Permission::FsWrite(t.0.clone())];
        assert!(check_path(&perms, "x.txt", true, &t.0).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_inside_grant_pointing_out_is_rejected() {
        use std::os::unix::fs::symlink;
        let t = TempDir::new();
        let grant = t.0.join("music");
        let outside = t.0.join("outside");
        fs::create_dir(&grant).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("secret"), "x").unwrap();
        symlink(&outside, grant.join("link")).unwrap();
        symlink(outside.join("secret"), grant.join("file-link")).unwrap();
        let perms = [Permission::FsWrite(grant.clone())];
        for p in [
            format!("{}/link/secret", grant.display()),
            format!("{}/link/new-file", grant.display()),
            format!("{}/file-link", grant.display()),
        ] {
            assert!(check_path(&perms, &p, true, &t.0).is_err(), "{p}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn dangling_symlink_is_rejected() {
        use std::os::unix::fs::symlink;
        let t = TempDir::new();
        let grant = t.0.join("music");
        fs::create_dir(&grant).unwrap();
        symlink(t.0.join("nowhere"), grant.join("dangling")).unwrap();
        let perms = [Permission::FsWrite(grant.clone())];
        let p = format!("{}/dangling", grant.display());
        assert!(check_path(&perms, &p, true, &t.0).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_grant_and_symlink_into_grant_are_followed() {
        use std::os::unix::fs::symlink;
        let t = TempDir::new();
        let real = t.0.join("real-music");
        fs::create_dir(&real).unwrap();
        symlink(&real, t.0.join("Music")).unwrap();
        // The grant itself is a symlink (common for ~/Music on synced setups).
        let perms = [Permission::FsWrite(t.0.join("Music"))];
        let p = format!("{}/Music/a.xml", t.0.display());
        assert_eq!(
            check_path(&perms, &p, true, &t.0).unwrap(),
            real.join("a.xml")
        );
        // A path outside that symlinks into the grant is allowed: it ends inside.
        symlink(&real, t.0.join("alias")).unwrap();
        let q = format!("{}/alias/b.xml", t.0.display());
        assert_eq!(
            check_path(&perms, &q, true, &t.0).unwrap(),
            real.join("b.xml")
        );
    }

    #[cfg(unix)]
    #[test]
    fn dot_dot_through_symlink_is_folded_before_resolving() {
        use std::os::unix::fs::symlink;
        let t = TempDir::new();
        let grant = t.0.join("music");
        let deep = t.0.join("outside/deep");
        fs::create_dir(&grant).unwrap();
        fs::create_dir_all(&deep).unwrap();
        symlink(&deep, grant.join("link")).unwrap();
        // The OS would read outside/x; we fold `..` first and use music/x.
        let perms = [Permission::FsWrite(grant.clone())];
        let p = format!("{}/link/../x", grant.display());
        assert_eq!(check_path(&perms, &p, true, &t.0).unwrap(), grant.join("x"));
    }
}
