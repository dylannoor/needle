//! Shared folders with visibility, folder scans for counts and unreadable
//! files, and the "owned" index (file name + size) behind `owned_check`.
//! Only folders visible to everyone go to the library: it has no buddies-only
//! share list, so buddies-only folders are not shared at all for now.

use std::collections::HashSet;
use std::path::Path;
use std::thread;

use needle_core::api::{ScanStatus, ShareFolder, SharesView, Visibility};
use needle_core::files::basename;
use walkdir::WalkDir;

use crate::state::{Shared, err, lock, now_ms};

#[derive(Default)]
pub struct ShareState {
    folders: Vec<ShareFolder>,
    unreadable: Vec<String>,
    owned: HashSet<(String, u64)>,
    owned_names: HashSet<String>,
    scan: u64,
}

pub fn public_dirs(state: &Shared) -> Vec<String> {
    lock(&state.store)
        .shares()
        .unwrap_or_default()
        .into_iter()
        .filter(|(_, v)| *v == Visibility::Everyone)
        .map(|(p, _)| p)
        .collect()
}

pub fn view(state: &Shared) -> SharesView {
    let s = lock(&state.shares);
    let shared: Vec<&ShareFolder> = s
        .folders
        .iter()
        .filter(|f| f.visibility != Visibility::Nobody)
        .collect();
    SharesView {
        folders: s.folders.clone(),
        shared_files: shared.iter().map(|f| f.files).sum(),
        shared_folders: shared.len() as u32,
        owned_files: s.owned.len() as u32,
        unreadable: s.unreadable.clone(),
    }
}

#[derive(Default, Debug, PartialEq)]
pub struct Scan {
    pub files: u32,
    pub bytes: u64,
    pub unreadable: Vec<String>,
    pub entries: Vec<(String, u64)>,
}

/// Walk `root`: file count, bytes, what could not be read, and (lowercase name, size) pairs.
pub fn scan_folder(root: &Path) -> Scan {
    let mut scan = Scan::default();
    for entry in WalkDir::new(root).follow_links(true) {
        match entry {
            Ok(e) if e.file_type().is_file() => match e.metadata() {
                Ok(m) => {
                    scan.files += 1;
                    scan.bytes += m.len();
                    let name = e.file_name().to_string_lossy().to_lowercase();
                    scan.entries.push((name, m.len()));
                }
                Err(_) => scan.unreadable.push(e.path().display().to_string()),
            },
            Ok(_) => {}
            Err(e) => scan.unreadable.push(
                e.path()
                    .map_or_else(|| root.display().to_string(), |p| p.display().to_string()),
            ),
        }
    }
    scan
}

fn emit(state: &Shared) {
    state.emit("shares:update", view(state));
}

/// Rebuild the folder list from the store and rescan everything on a thread.
pub fn rescan(state: &Shared) -> SharesView {
    let rows = lock(&state.store).shares().unwrap_or_default();
    let generation = {
        let mut s = lock(&state.shares);
        s.scan += 1;
        s.folders = rows
            .iter()
            .map(|(path, visibility)| {
                let old = s.folders.iter().find(|f| &f.path == path);
                ShareFolder {
                    path: path.clone(),
                    visibility: *visibility,
                    files: old.map_or(0, |f| f.files),
                    bytes: old.map_or(0, |f| f.bytes),
                    status: ScanStatus::Scanning { percent: 0 },
                }
            })
            .collect();
        s.scan
    };
    let st = state.clone();
    thread::spawn(move || run_scan(&st, generation));
    emit(state);
    view(state)
}

fn run_scan(state: &Shared, generation: u64) {
    let current = |s: &Shared| lock(&s.shares).scan == generation;
    let folders: Vec<(String, Visibility)> = lock(&state.shares)
        .folders
        .iter()
        .map(|f| (f.path.clone(), f.visibility))
        .collect();
    let mut owned = HashSet::new();
    let mut unreadable = vec![];
    let total = folders.len().max(1);
    for (i, (path, visibility)) in folders.iter().enumerate() {
        if !current(state) {
            return;
        }
        let root = Path::new(path);
        let scan = scan_folder(root);
        let status = if !root.is_dir() {
            ScanStatus::Error {
                message: "Folder not found".into(),
            }
        } else if *visibility == Visibility::Nobody {
            ScanStatus::NotShared
        } else {
            ScanStatus::Scanned { at_ms: now_ms() }
        };
        owned.extend(scan.entries);
        unreadable.extend(scan.unreadable);
        {
            let mut s = lock(&state.shares);
            let percent = (((i + 1) * 100) / total) as u8;
            for f in &mut s.folders {
                if f.path == *path {
                    f.files = scan.files;
                    f.bytes = scan.bytes;
                    f.status = status.clone();
                } else if matches!(f.status, ScanStatus::Scanning { .. }) {
                    f.status = ScanStatus::Scanning { percent };
                }
            }
        }
        emit(state);
    }
    let download_dir = state.settings().download_dir;
    if !folders
        .iter()
        .any(|(p, _)| Path::new(&download_dir).starts_with(p))
    {
        owned.extend(scan_folder(Path::new(&download_dir)).entries);
    }
    {
        let mut s = lock(&state.shares);
        if s.scan != generation {
            return;
        }
        s.owned_names = owned.iter().map(|(n, _)| n.clone()).collect();
        s.owned = owned;
        s.unreadable = unreadable;
    }
    emit(state);
    if let Ok(client) = state.client() {
        let _ = client.set_shared_directories(public_dirs(state));
    }
}

pub fn add(state: &Shared, path: &str, visibility: Visibility) -> Result<SharesView, String> {
    if !Path::new(path).is_dir() {
        return Err(format!("{path} is not a folder"));
    }
    lock(&state.store)
        .set_share(path, visibility)
        .map_err(err)?;
    Ok(rescan(state))
}

pub fn remove(state: &Shared, path: &str) -> Result<SharesView, String> {
    lock(&state.store).remove_share(path).map_err(err)?;
    Ok(rescan(state))
}

pub fn set_visibility(
    state: &Shared,
    path: &str,
    visibility: Visibility,
) -> Result<SharesView, String> {
    if !lock(&state.store)
        .shares()
        .map_err(err)?
        .iter()
        .any(|(p, _)| p == path)
    {
        return Err(format!("{path} is not in your shares"));
    }
    lock(&state.store)
        .set_share(path, visibility)
        .map_err(err)?;
    Ok(rescan(state))
}

/// Whether each remote path is a file you already have: by name and size when
/// the size is known from a kept search, by name alone otherwise.
pub fn owned_check(state: &Shared, paths: &[String]) -> Vec<bool> {
    let sizes: Vec<Option<u64>> = {
        let searches = lock(&state.searches);
        paths.iter().map(|p| searches.size_of(p)).collect()
    };
    let s = lock(&state.shares);
    paths
        .iter()
        .zip(sizes)
        .map(|(path, size)| {
            let name = basename(path).to_lowercase();
            match size {
                Some(size) => s.owned.contains(&(name, size)),
                None => s.owned_names.contains(&name),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn scan_counts_files_bytes_and_lowercases_names() {
        let dir = std::env::temp_dir().join(format!("needle-shares-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("Album")).unwrap();
        fs::write(dir.join("Album/01 Intro.FLAC"), b"12345").unwrap();
        fs::write(dir.join("cover.jpg"), b"12").unwrap();
        let mut scan = scan_folder(&dir);
        scan.entries.sort();
        assert_eq!(scan.files, 2);
        assert_eq!(scan.bytes, 7);
        assert!(scan.unreadable.is_empty());
        assert_eq!(
            scan.entries,
            vec![("01 intro.flac".into(), 5), ("cover.jpg".into(), 2)]
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn scanning_a_missing_folder_reports_it_unreadable() {
        let scan = scan_folder(Path::new("/definitely/not/here/needle"));
        assert_eq!(scan.files, 0);
        assert_eq!(scan.unreadable.len(), 1);
    }
}
