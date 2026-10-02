//! The job runner: feeds events into `needle_core::jobs::Job`, performs the
//! actions that come out, persists every change and emits `jobs:update`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;
use std::thread;
use std::time::{Duration, Instant};

use needle_core::api::{DownloadedFile, ExtensionEvent, Settings};
use needle_core::files::basename;
use needle_core::jobs::Job;
use needle_core::model::{
    Candidate, Codec, FileInfo, JobAction, JobEvent, JobStatus, JobView, QualityProfile, Release,
    Source, Strictness, Tier, TransferStatus, Verdict,
};
use needle_core::releases::build_view;
use soulseek_rs::{Client, DownloadStatus};

use crate::state::{Shared, err, lock, now_ms};
use crate::throttle::Throttle;

pub struct JobEntry {
    pub job: Job,
    saved: Option<String>,
}

pub fn apply_settings(client: &Client, settings: &Settings) {
    client.set_upload_slots(settings.upload_slots.max(1) as usize);
    client.set_download_speed_limit(u64::from(settings.download_limit_kbps) * 1024);
}

pub fn load(state: &Shared) {
    let rows = lock(&state.store).jobs().unwrap_or_default();
    let mut jobs = lock(&state.jobs);
    for (id, json) in rows {
        if let Ok(job) = serde_json::from_str::<Job>(&json) {
            jobs.insert(
                id,
                JobEntry {
                    job,
                    saved: Some(json),
                },
            );
        }
    }
}

const fn is_active(status: &JobStatus) -> bool {
    !matches!(
        status,
        JobStatus::Done | JobStatus::Failed { .. } | JobStatus::Cancelled | JobStatus::Paused
    )
}

const fn is_finished(status: &JobStatus) -> bool {
    matches!(
        status,
        JobStatus::Done | JobStatus::Failed { .. } | JobStatus::Cancelled
    )
}

fn active_ids(state: &Shared) -> Vec<String> {
    let now = now_ms();
    lock(&state.jobs)
        .iter()
        .filter(|(_, e)| is_active(&e.job.view(now).status))
        .map(|(id, _)| id.clone())
        .collect()
}

/// Kick every unfinished job after a login; they request their files again.
pub fn resume_all(state: &Shared) {
    for id in active_ids(state) {
        feed(state, &id, JobEvent::Start);
    }
}

/// One-second ticker driving the stuck rules.
pub fn run_ticker(state: Shared) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(1));
            for id in active_ids(&state) {
                feed(&state, &id, JobEvent::Tick);
            }
        }
    });
}

pub fn view(state: &Shared, id: &str) -> Result<JobView, String> {
    lock(&state.jobs)
        .get(id)
        .map(|e| e.job.view(now_ms()))
        .ok_or_else(|| "That download no longer exists".to_string())
}

pub fn list(state: &Shared) -> Vec<JobView> {
    let now = now_ms();
    let mut views: Vec<JobView> = lock(&state.jobs)
        .values()
        .map(|e| e.job.view(now))
        .collect();
    views.sort_by(|a, b| {
        is_finished(&a.status)
            .cmp(&is_finished(&b.status))
            .then(b.created_ms.cmp(&a.created_ms))
    });
    views
}

pub fn feed(state: &Shared, id: &str, event: JobEvent) {
    let (actions, view, json) = {
        let mut jobs = lock(&state.jobs);
        let Some(entry) = jobs.get_mut(id) else {
            return;
        };
        let now = now_ms();
        let actions = entry.job.handle(event, now);
        let view = entry.job.view(now);
        let json = serde_json::to_string(&entry.job).ok();
        let changed = json != entry.saved;
        if changed {
            entry.saved.clone_from(&json);
        }
        (actions, view, json.filter(|_| changed))
    };
    if let Some(json) = json {
        let _ = lock(&state.store).save_job(id, &json, view.created_ms);
    }
    state.emit("jobs:update", view.clone());
    for action in actions {
        perform(state, id, &view, action);
    }
}

pub fn create(
    state: &Shared,
    release: &Release,
    files: Option<Vec<String>>,
    profile: &QualityProfile,
) -> Result<JobView, String> {
    let settings = state.settings();
    let folder = basename(&release.best.folder);
    let folder = if folder.is_empty() {
        &release.title
    } else {
        folder
    };
    let output = Path::new(&settings.download_dir).join(sanitize(folder));
    let now = now_ms();
    let id = format!("j{now:x}{:x}", lock(&state.jobs).len());
    let job = Job::new(
        id.clone(),
        release,
        files,
        profile,
        output.display().to_string(),
        now,
    );
    lock(&state.jobs).insert(id.clone(), JobEntry { job, saved: None });
    feed(state, &id, JobEvent::Start);
    view(state, &id)
}

/// A one-candidate release from files picked while browsing a user.
pub fn browse_release(
    username: &str,
    folder: &str,
    files: Vec<FileInfo>,
    profile: &QualityProfile,
) -> Release {
    let audio = files.iter().filter(|f| f.is_audio()).count();
    let tier = profile.tier_of(&files).unwrap_or(0);
    let title = basename(folder).to_string();
    let format_label = files
        .iter()
        .find(|f| f.is_audio())
        .map_or("Files", |f| f.codec.label())
        .to_string();
    Release {
        id: format!("{username}\\{folder}"),
        title: if title.is_empty() {
            username.to_string()
        } else {
            title
        },
        artist: None,
        year: None,
        best: Candidate {
            id: format!("{username}\\{folder}"),
            source: Source {
                username: username.to_string(),
                free_slot: true,
                avg_speed: 0,
                queue_len: None,
            },
            folder: folder.to_string(),
            total_size: files.iter().map(|f| f.size).sum(),
            files,
        },
        alternates: vec![],
        tier,
        format_label,
        track_count: audio,
        expected_tracks: audio,
        score: 0.0,
    }
}

pub fn remove(state: &Shared, id: &str) -> Result<(), String> {
    let mut jobs = lock(&state.jobs);
    let finished = jobs
        .get(id)
        .is_some_and(|e| is_finished(&e.job.view(now_ms()).status));
    if !finished {
        return Err("Only finished, cancelled or failed downloads can be removed".into());
    }
    jobs.remove(id);
    drop(jobs);
    lock(&state.store).delete_job(id).map_err(err)
}

pub fn clear_finished(state: &Shared) {
    let now = now_ms();
    let ids: Vec<String> = lock(&state.jobs)
        .iter()
        .filter(|(_, e)| is_finished(&e.job.view(now).status))
        .map(|(id, _)| id.clone())
        .collect();
    for id in ids {
        let _ = remove(state, &id);
    }
}

/// Windows-hostile and path characters out of a folder name.
pub fn sanitize(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let clean = clean.trim().trim_matches('.').to_string();
    if clean.is_empty() {
        "Download".into()
    } else {
        clean
    }
}

/// `dir/name`, or `dir/name (1).ext` and so on when that is taken.
pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s, format!(".{e}")),
        _ => (name, String::new()),
    };
    (1..)
        .map(|i| dir.join(format!("{stem} ({i}){ext}")))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

/// Where a rejected file goes: the rejected folder, keeping its folder name.
pub fn rejected_path(rejected_dir: &Path, local_path: &Path) -> PathBuf {
    let folder = local_path
        .parent()
        .and_then(Path::file_name)
        .map(PathBuf::from)
        .unwrap_or_default();
    let name = local_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    unique_path(&rejected_dir.join(folder), &name)
}

fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(from, to).or_else(|_| {
        fs::copy(from, to)?;
        fs::remove_file(from)
    })
}

fn perform(state: &Shared, id: &str, view: &JobView, action: JobAction) {
    match action {
        JobAction::Request {
            username,
            remote_path,
            size,
            dest_dir,
        } => {
            request(state, id, username, remote_path, size, dest_dir);
        }
        JobAction::CancelTransfer {
            username,
            remote_path,
        } => {
            if let Ok(client) = state.client() {
                let _ = client.cancel_download(&username, &remote_path);
                let _ = client.remove_download(&username, &remote_path);
            }
        }
        JobAction::Verify {
            name,
            local_path,
            tier,
            strictness,
        } => {
            let (st, id) = (state.clone(), id.to_string());
            let job = (view.title.clone(), view.artist.clone());
            thread::spawn(move || verify(&st, &id, &job, name, &local_path, &tier, strictness));
        }
        JobAction::Delete { local_path } => {
            let _ = fs::remove_file(local_path);
        }
        JobAction::MoveToRejected { local_path } => {
            let from = Path::new(&local_path);
            let to = rejected_path(Path::new(&state.settings().rejected_dir), from);
            let _ = move_file(from, &to);
        }
        JobAction::Research { query } => {
            let (st, id) = (state.clone(), id.to_string());
            let names: Vec<String> = view.items.iter().map(|i| i.name.clone()).collect();
            thread::spawn(move || {
                let candidates = research(&st, &query, &names);
                feed(&st, &id, JobEvent::NewSources { candidates });
            });
        }
        JobAction::AddToWishlist { query } => {
            let _ = lock(&state.store).add_wish(&query, now_ms());
        }
        JobAction::Finished => {
            let file = DownloadedFile {
                job_id: id.to_string(),
                local_path: view.output_dir.clone(),
                title: view.title.clone(),
                artist: view.artist.clone(),
                album: Some(view.title.clone()),
                track_number: None,
                duration_secs: None,
                codec: Codec::Other,
                sample_rate: None,
                bit_depth: None,
                bitrate_kbps: None,
                size: view.total,
            };
            dispatch(state, "download.completed", &file);
        }
    }
}

fn dispatch(state: &Shared, name: &str, file: &DownloadedFile) {
    crate::extensions::dispatch(
        &state.app,
        ExtensionEvent {
            name: name.into(),
            payload: serde_json::to_value(file).unwrap_or_default(),
        },
    );
}

/// Transfer updates go through `Job::item_name`; updates for a transfer the
/// job no longer expects are dropped.
fn feed_transfer(
    state: &Shared,
    id: &str,
    username: &str,
    remote_path: &str,
    status: TransferStatus,
) {
    let name = lock(&state.jobs)
        .get(id)
        .and_then(|e| e.job.item_name(username, remote_path).map(str::to_string));
    if let Some(name) = name {
        feed(state, id, JobEvent::Transfer { name, status });
    }
}

/// Where a file streams while downloading: one folder per job and remote
/// folder, so equal file names from different discs never share a `.part`.
pub fn incomplete_dir(incomplete: &Path, job_id: &str, remote_path: &str) -> PathBuf {
    let folder = remote_path
        .rfind(['\\', '/'])
        .map_or("", |i| &remote_path[..i]);
    incomplete.join(job_id).join(sanitize(basename(folder)))
}

fn request(
    state: &Shared,
    id: &str,
    username: String,
    remote_path: String,
    size: u64,
    dest_dir: String,
) {
    // Offline: the job is kicked again with Start after the next login.
    let Ok(client) = state.client() else {
        return;
    };
    let tmp = incomplete_dir(
        Path::new(&state.settings().incomplete_dir),
        id,
        &remote_path,
    );
    if let Err(e) = fs::create_dir_all(&tmp).and_then(|()| fs::create_dir_all(&dest_dir)) {
        let reason = format!("Could not create the download folder: {e}");
        return feed_transfer(
            state,
            id,
            &username,
            &remote_path,
            TransferStatus::Failed { reason },
        );
    }
    let _ = client.remove_download(&username, &remote_path);
    match client.download(
        remote_path.clone(),
        username.clone(),
        size,
        tmp.display().to_string(),
    ) {
        Ok((_, rx)) => {
            let st = state.clone();
            let t = Transfer {
                id: id.to_string(),
                username,
                remote_path,
                tmp,
                dest: PathBuf::from(dest_dir),
            };
            thread::spawn(move || forward(&st, &t, &rx));
        }
        Err(e) => feed_transfer(
            state,
            id,
            &username,
            &remote_path,
            TransferStatus::Failed {
                reason: e.to_string(),
            },
        ),
    }
}

struct Transfer {
    id: String,
    username: String,
    remote_path: String,
    tmp: PathBuf,
    dest: PathBuf,
}

fn forward(state: &Shared, t: &Transfer, rx: &Receiver<DownloadStatus>) {
    let name = basename(&t.remote_path);
    let mut throttle = Throttle::new(Duration::from_millis(250));
    for status in rx {
        let terminal = status.is_terminal();
        let status = match status {
            DownloadStatus::Queued => TransferStatus::Queued { position: None },
            DownloadStatus::InProgress {
                bytes_downloaded,
                total_bytes,
                speed_bytes_per_sec,
            } => {
                if !throttle.ready(Instant::now()) {
                    continue;
                }
                TransferStatus::Progress {
                    bytes: bytes_downloaded,
                    total: total_bytes,
                    speed: speed_bytes_per_sec,
                }
            }
            DownloadStatus::Paused { .. } => continue,
            DownloadStatus::Completed => {
                let to = unique_path(&t.dest, name);
                match move_file(&t.tmp.join(name), &to) {
                    Ok(()) => {
                        let _ = fs::remove_dir(&t.tmp);
                        TransferStatus::Completed {
                            local_path: to.display().to_string(),
                        }
                    }
                    Err(e) => TransferStatus::Failed {
                        reason: format!("Could not move the finished file: {e}"),
                    },
                }
            }
            DownloadStatus::Cancelled => TransferStatus::Cancelled,
            DownloadStatus::TimedOut => TransferStatus::TimedOut,
            DownloadStatus::Failed(reason) => TransferStatus::Failed {
                reason: reason.unwrap_or_else(|| "The transfer failed".into()),
            },
        };
        feed_transfer(state, &t.id, &t.username, &t.remote_path, status);
        if terminal {
            break;
        }
    }
}

fn verify(
    state: &Shared,
    id: &str,
    job: &(String, Option<String>),
    name: String,
    local_path: &str,
    tier: &Tier,
    strictness: Strictness,
) {
    let path = Path::new(local_path);
    let result =
        std::panic::catch_unwind(|| needle_core::verify::verify_file(path, tier, strictness));
    let event = match result {
        Ok(Ok(verdict)) => {
            if verdict.ok {
                dispatch(
                    state,
                    "download.verified",
                    &downloaded_file(id, job, path, &verdict),
                );
            }
            JobEvent::Verified { name, verdict }
        }
        Ok(Err(e)) => JobEvent::VerifyError {
            name,
            error: e.to_string(),
        },
        Err(_) => JobEvent::VerifyError {
            name,
            error: "The verifier crashed on this file".into(),
        },
    };
    feed(state, id, event);
}

/// The payload extensions get for a verified file, with tags read by lofty.
pub fn downloaded_file(
    id: &str,
    job: &(String, Option<String>),
    path: &Path,
    verdict: &Verdict,
) -> DownloadedFile {
    use lofty::prelude::*;
    let tagged = lofty::read_from_path(path).ok();
    let tag = tagged
        .as_ref()
        .and_then(|t| t.primary_tag().or_else(|| t.first_tag()));
    let text = |f: fn(&lofty::tag::Tag) -> Option<std::borrow::Cow<'_, str>>| {
        tag.and_then(f)
            .map(|s| s.to_string())
            .filter(|s| !s.trim().is_empty())
    };
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    DownloadedFile {
        job_id: id.to_string(),
        local_path: path.display().to_string(),
        title: text(|t| t.title()).unwrap_or(stem),
        artist: text(|t| t.artist()).or_else(|| job.1.clone()),
        album: text(|t| t.album()).or_else(|| Some(job.0.clone())),
        track_number: tag.and_then(Accessor::track),
        duration_secs: tagged
            .as_ref()
            .map(|t| t.properties().duration().as_secs() as u32)
            .filter(|d| *d > 0),
        codec: verdict.codec,
        sample_rate: verdict.sample_rate,
        bit_depth: verdict.bit_depth,
        bitrate_kbps: verdict.bitrate_kbps,
        size: fs::metadata(path).map_or(0, |m| m.len()),
    }
}

/// Fresh sources for a stuck job: every folder in the new results that holds
/// at least one of the job's files.
fn research(state: &Shared, query: &str, names: &[String]) -> Vec<Candidate> {
    let Ok(results) = crate::search::collect(state, query) else {
        return vec![];
    };
    let view = build_view("research", query, &results, &state.profile(None), true);
    candidates_with(view.releases.into_iter().chain(view.hidden_releases), names)
}

pub fn candidates_with(
    releases: impl Iterator<Item = Release>,
    names: &[String],
) -> Vec<Candidate> {
    releases
        .flat_map(|r| std::iter::once(r.best).chain(r.alternates))
        .filter(|c| {
            c.files
                .iter()
                .any(|f| names.iter().any(|n| basename(n) == f.name()))
        })
        .collect()
}

pub fn reveal(state: &Shared, id: &str) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = view(state, id)?.output_dir;
    if !Path::new(&dir).exists() {
        return Err("The download folder does not exist yet".into());
    }
    state.app.opener().open_path(dir, None::<&str>).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("needle-transfers-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn incomplete_dir_separates_jobs_and_remote_folders() {
        let base = Path::new("/dl/.incomplete");
        assert_eq!(
            incomplete_dir(base, "j1", r"@@m\Album\CD1\01.flac"),
            PathBuf::from("/dl/.incomplete/j1/CD1")
        );
        assert_eq!(
            incomplete_dir(base, "j1", r"@@m\Album\CD2\01.flac"),
            PathBuf::from("/dl/.incomplete/j1/CD2")
        );
        assert_eq!(
            incomplete_dir(base, "j1", "01.flac"),
            PathBuf::from("/dl/.incomplete/j1/Download")
        );
    }

    #[test]
    fn rejected_path_keeps_the_folder_name() {
        let to = rejected_path(
            Path::new("/dl/Rejected"),
            Path::new("/dl/Artist - Album (2001)/03 Track.flac"),
        );
        assert_eq!(
            to,
            PathBuf::from("/dl/Rejected/Artist - Album (2001)/03 Track.flac")
        );
    }

    #[test]
    fn unique_path_numbers_taken_names() {
        let dir = temp("unique");
        assert_eq!(unique_path(&dir, "a.flac"), dir.join("a.flac"));
        fs::write(dir.join("a.flac"), b"x").unwrap();
        fs::write(dir.join("a (1).flac"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "a.flac"), dir.join("a (2).flac"));
        fs::write(dir.join("README"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "README"), dir.join("README (1)"));
        fs::write(dir.join(".hidden"), b"x").unwrap();
        assert_eq!(unique_path(&dir, ".hidden"), dir.join(".hidden (1)"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn move_file_creates_the_destination_folder() {
        let dir = temp("move");
        fs::write(dir.join("f.mp3"), b"abc").unwrap();
        let to = dir.join("Rejected/Album/f.mp3");
        move_file(&dir.join("f.mp3"), &to).unwrap();
        assert_eq!(fs::read(&to).unwrap(), b"abc");
        assert!(!dir.join("f.mp3").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn browse_release_wraps_picked_files_in_one_candidate() {
        let profile = QualityProfile::lossless_first();
        let flac = |n: &str| {
            FileInfo::from_attributes(
                format!(r"@@m\Artist - Album\{n}"),
                30_000_000,
                &[(4, 44_100), (5, 16)],
            )
        };
        let files = vec![
            flac("01.flac"),
            flac("02.flac"),
            FileInfo::from_attributes(r"@@m\Artist - Album\cover.jpg".into(), 100, &[]),
        ];
        let r = browse_release("kdj", r"@@m\Artist - Album", files, &profile);
        assert_eq!(r.title, "Artist - Album");
        assert_eq!(r.best.source.username, "kdj");
        assert_eq!(r.best.total_size, 60_000_100);
        assert_eq!((r.track_count, r.expected_tracks), (2, 2));
        assert_eq!(r.format_label, "FLAC");
        assert_eq!(r.tier, profile.tier_of(&r.best.files).unwrap());
        assert!(r.alternates.is_empty());

        let other = browse_release(
            "kdj",
            "",
            vec![FileInfo::from_attributes("notes.txt".into(), 1, &[])],
            &profile,
        );
        assert_eq!(
            (
                other.title.as_str(),
                other.format_label.as_str(),
                other.tier
            ),
            ("kdj", "Files", 0)
        );
    }

    #[test]
    fn sanitize_strips_separators_and_never_returns_empty() {
        assert_eq!(sanitize("AC/DC: Live?"), "AC_DC_ Live_");
        assert_eq!(sanitize(" .. "), "Download");
        assert_eq!(sanitize("Album (2001)"), "Album (2001)");
    }
}
