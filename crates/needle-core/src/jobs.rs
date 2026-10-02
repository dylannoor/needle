//! The download job: one release, its fallback sources, and the state machine
//! that switches source when a transfer stalls or a file fails verification.
//! Pure: the backend feeds events in and performs the actions that come out.
//!
//! Contract with the backend:
//! - Map every transfer update to an item with [`Job::item_name`] (username +
//!   remote path) and drop updates that map to nothing: those belong to a
//!   transfer the job already cancelled or moved elsewhere.
//! - Report peer-side cancellations and denials as `Failed`. `Cancelled`
//!   transfer updates are ignored, because the only cancels the job expects
//!   are its own.
//! - Answer every `Research` with `NewSources`, an empty list when the search
//!   found nothing, so the job can give up.
//! - Send `Tick` every few seconds while the job is active.
//! - `KeepAnyway` only works when the profile moves rejected files to the
//!   Rejected folder (a deleted file cannot be kept). The kept file stays
//!   wherever the backend moved it.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::files::basename;
use crate::model::{
    Candidate, FileInfo, ItemState, ItemView, JobAction, JobEvent, JobStatus, JobView, LogEntry,
    OnFail, QualityProfile, Release, Tier, Tone, TransferStatus, Verdict,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    id: String,
    title: String,
    artist: Option<String>,
    format_label: String,
    tier: usize,
    profile: QualityProfile,
    output_dir: String,
    sources: Vec<Src>,
    items: Vec<Item>,
    phase: Phase,
    research: Research,
    /// Why the job is recovering, shown until the next transfer update.
    notice: Option<(String, String)>,
    log: Vec<LogEntry>,
    created_ms: u64,
    finished_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Src {
    cand: Candidate,
    /// Something was requested from this source at some point.
    used: bool,
    /// Last time the source was asked for files or sent bytes.
    last_activity_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Item {
    /// Path inside the release folder ("03.flac", or "CD2/03.flac").
    name: String,
    dest_dir: String,
    audio: bool,
    size: u64,
    bytes: u64,
    speed: f64,
    state: ItemState,
    /// The source the item is requested from (or came from), with its path there.
    source: Option<usize>,
    remote_path: String,
    tried: Vec<usize>,
    local_path: Option<String>,
    verdict: Option<Verdict>,
    /// Size of the last copy that failed verification: other sizes go first.
    rejected_size: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
enum Phase {
    Active,
    Paused,
    Cancelled,
    Failed(String),
    Done,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
enum Research {
    NotYet,
    Pending,
    Done,
}

impl Item {
    /// Requested and waiting for, or receiving, data.
    fn active(&self) -> bool {
        self.source.is_some()
            && matches!(
                self.state,
                ItemState::Pending | ItemState::Queued { .. } | ItemState::Downloading
            )
    }

    fn done(&self) -> bool {
        matches!(self.state, ItemState::Verified | ItemState::KeptAnyway)
    }

    /// No source is working on it and it is not done: it needs a new source.
    fn stranded(&self) -> bool {
        matches!(self.state, ItemState::Failed { .. } | ItemState::Rejected)
    }

    fn base(&self) -> &str {
        basename(&self.name)
    }
}

const COVER_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png"];

impl Job {
    /// `files`: names (without folder) to fetch; `None` means the audio files
    /// plus cover art. Files go to `output_dir` joined with the release's
    /// remote folder name, like Nicotine+ does.
    #[must_use]
    pub fn new(
        id: String,
        release: &Release,
        files: Option<Vec<String>>,
        profile: &QualityProfile,
        output_dir: String,
        now_ms: u64,
    ) -> Self {
        let best = &release.best;
        let root = Path::new(&output_dir).join(sanitize(basename(&best.folder)));
        let wanted = |f: &FileInfo| match &files {
            Some(names) => names.iter().any(|n| {
                n.eq_ignore_ascii_case(f.name()) || n.eq_ignore_ascii_case(&relative(best, f))
            }),
            None => f.is_audio() || is_cover(f.name()),
        };
        let items = best
            .files
            .iter()
            .filter(|f| wanted(f))
            .map(|f| {
                let name = relative(best, f);
                let sub = name.rsplit_once('/').map_or("", |(dir, _)| dir);
                let dest = sub
                    .split('/')
                    .filter(|p| !p.is_empty())
                    .fold(root.clone(), |p, d| p.join(sanitize(d)));
                Item {
                    name,
                    dest_dir: dest.to_string_lossy().into_owned(),
                    audio: f.is_audio(),
                    size: f.size,
                    bytes: 0,
                    speed: 0.0,
                    state: ItemState::Pending,
                    source: None,
                    remote_path: f.path.clone(),
                    tried: Vec::new(),
                    local_path: None,
                    verdict: None,
                    rejected_size: None,
                }
            })
            .collect();
        let sources = std::iter::once(best)
            .chain(&release.alternates)
            .map(|c| Src {
                cand: c.clone(),
                used: false,
                last_activity_ms: now_ms,
            })
            .collect();
        Job {
            id,
            title: release.title.clone(),
            artist: release.artist.clone(),
            format_label: release.format_label.clone(),
            tier: release.tier,
            profile: profile.clone(),
            output_dir,
            sources,
            items,
            phase: Phase::Active,
            research: Research::NotYet,
            notice: None,
            log: Vec::new(),
            created_ms: now_ms,
            finished_ms: None,
        }
    }

    #[must_use]
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The item a transfer from `username` for `remote_path` belongs to, if the
    /// job still expects it. Use the result as the `name` of transfer events.
    #[must_use]
    pub fn item_name(&self, username: &str, remote_path: &str) -> Option<&str> {
        self.items
            .iter()
            .find(|i| {
                i.remote_path == remote_path
                    && i.source
                        .is_some_and(|s| self.sources[s].cand.source.username == username)
            })
            .map(|i| i.name.as_str())
    }

    pub fn handle(&mut self, event: JobEvent, now_ms: u64) -> Vec<JobAction> {
        let mut out = Vec::new();
        match (event, &self.phase) {
            (JobEvent::Start, Phase::Active) => self.start(now_ms, &mut out),
            (JobEvent::Tick, Phase::Active) => self.tick(now_ms, &mut out),
            (JobEvent::Transfer { name, status }, Phase::Active) => {
                self.transfer(&name, status, now_ms, &mut out)
            }
            // A file may finish while the cancel for a pause is on its way.
            (
                JobEvent::Transfer {
                    name,
                    status: status @ TransferStatus::Completed { .. },
                },
                Phase::Paused,
            ) => {
                self.transfer(&name, status, now_ms, &mut out);
            }
            (JobEvent::Verified { name, verdict }, Phase::Active | Phase::Paused) => {
                self.verified(&name, verdict, now_ms, &mut out);
            }
            (JobEvent::VerifyError { name, error }, Phase::Active | Phase::Paused) => {
                self.verify_error(&name, &error, now_ms, &mut out);
            }
            (JobEvent::KeepAnyway { name }, Phase::Active | Phase::Paused | Phase::Failed(_)) => {
                self.keep_anyway(&name, now_ms, &mut out);
            }
            (JobEvent::NewSources { candidates }, Phase::Active | Phase::Paused) => {
                self.new_sources(candidates, now_ms, &mut out);
            }
            (JobEvent::Pause, Phase::Active) => {
                self.cancel_active(&mut out);
                self.phase = Phase::Paused;
                self.say(now_ms, Tone::Info, "Paused".into());
            }
            (JobEvent::Resume, Phase::Paused) => {
                self.phase = Phase::Active;
                self.say(now_ms, Tone::Info, "Resumed".into());
                self.start(now_ms, &mut out);
            }
            (JobEvent::Cancel, Phase::Active | Phase::Paused | Phase::Failed(_)) => {
                self.cancel_active(&mut out);
                self.phase = Phase::Cancelled;
                self.finished_ms = Some(now_ms);
                self.say(now_ms, Tone::Info, "Cancelled".into());
            }
            (JobEvent::Retry, Phase::Failed(_) | Phase::Cancelled) => self.retry(now_ms, &mut out),
            _ => return out,
        }
        if matches!(self.phase, Phase::Active | Phase::Failed(_)) {
            self.settle(now_ms, &mut out);
        }
        out
    }

    #[must_use]
    pub fn view(&self, now_ms: u64) -> JobView {
        let (status, detail) = self.status();
        let current = self.current_source();
        let switch_in_secs = match (&status, current) {
            (JobStatus::Queued { .. } | JobStatus::Waiting, Some(s)) => {
                let waited = now_ms.saturating_sub(self.sources[s].last_activity_ms) / 1000;
                Some(u64::from(self.profile.stuck.queue_wait_secs).saturating_sub(waited) as u32)
            }
            _ => None,
        };
        JobView {
            id: self.id.clone(),
            title: self.title.clone(),
            artist: self.artist.clone(),
            format_label: self.format_label.clone(),
            status,
            detail,
            current_user: current.map(|s| self.sources[s].cand.source.username.clone()),
            source_index: current.map_or(0, |s| s + 1),
            source_count: self.sources.len(),
            items: self
                .items
                .iter()
                .map(|i| ItemView {
                    name: i.name.clone(),
                    size: i.size,
                    bytes: if i.done() || i.state == ItemState::Verifying {
                        i.size
                    } else {
                        i.bytes
                    },
                    state: i.state.clone(),
                    local_path: i.local_path.clone(),
                    verdict: i.verdict.clone(),
                })
                .collect(),
            bytes: self
                .items
                .iter()
                .map(|i| {
                    if i.done() {
                        i.size
                    } else {
                        i.bytes.min(i.size)
                    }
                })
                .sum(),
            total: self.items.iter().map(|i| i.size).sum(),
            speed: self
                .items
                .iter()
                .filter(|i| i.state == ItemState::Downloading)
                .map(|i| i.speed)
                .sum(),
            switch_in_secs,
            log: self.log.clone(),
            output_dir: self.output_dir.clone(),
            created_ms: self.created_ms,
            finished_ms: self.finished_ms,
        }
    }

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    /// Requests every unfinished item: from its current source when it has
    /// one (after a pause or a restart), otherwise from the best source that
    /// has it. Also re-sends verifications a restart may have lost.
    fn start(&mut self, now: u64, out: &mut Vec<JobAction>) {
        let mut asked: Vec<usize> = Vec::new();
        for i in 0..self.items.len() {
            let item = &self.items[i];
            if item.state == ItemState::Verifying {
                self.send_verify(i, out);
            } else if let (true, Some(s)) = (item.active(), item.source) {
                self.items[i].state = ItemState::Pending;
                self.sources[s].last_activity_ms = now;
                self.request(i, out);
                asked.push(s);
            } else if item.state == ItemState::Pending
                && let Some(s) = self.assign(i, now, out)
            {
                asked.push(s);
            }
        }
        let files = self.items.iter().filter(|i| i.active()).count();
        if let Some(s) = asked.first() {
            let user = self.user(*s).to_string();
            let others = if asked.iter().any(|a| a != s) {
                " and other sources"
            } else {
                ""
            };
            self.say(
                now,
                Tone::Info,
                format!("Asked {user}{others} for {}", plural(files, "file")),
            );
        }
    }

    fn tick(&mut self, now: u64, out: &mut Vec<JobAction>) {
        let wait_secs = self.profile.stuck.queue_wait_secs;
        let (no_data, queue_wait) = (
            u64::from(self.profile.stuck.no_data_secs) * 1000,
            u64::from(wait_secs) * 1000,
        );
        for s in 0..self.sources.len() {
            let at_s: Vec<usize> = (0..self.items.len())
                .filter(|&i| self.items[i].active() && self.items[i].source == Some(s))
                .collect();
            if at_s.is_empty() {
                continue;
            }
            let idle = now.saturating_sub(self.sources[s].last_activity_ms);
            let downloading = at_s
                .iter()
                .any(|&i| self.items[i].state == ItemState::Downloading);
            let user = self.user(s).to_string();
            let why = if downloading && idle >= no_data {
                format!("{user} stopped sending data")
            } else if !downloading && idle >= queue_wait {
                format!("waited {} in queue at {user}", duration(wait_secs))
            } else {
                continue;
            };
            self.switch(&at_s, &why, now, out);
        }
    }

    fn transfer(&mut self, name: &str, status: TransferStatus, now: u64, out: &mut Vec<JobAction>) {
        let Some(i) = self.find(name) else { return };
        let (true, Some(s)) = (self.items[i].active(), self.items[i].source) else {
            return;
        };
        match status {
            TransferStatus::Queued { position } => {
                self.notice = None;
                self.items[i].state = ItemState::Queued { position };
                self.items[i].speed = 0.0;
            }
            TransferStatus::Progress {
                bytes,
                total,
                speed,
            } => {
                self.notice = None;
                let item = &mut self.items[i];
                if bytes > item.bytes || item.state != ItemState::Downloading {
                    self.sources[s].last_activity_ms = now;
                }
                item.state = ItemState::Downloading;
                item.bytes = bytes;
                item.speed = speed;
                if total > 0 {
                    item.size = total;
                }
            }
            TransferStatus::Completed { local_path } => {
                self.notice = None;
                self.sources[s].last_activity_ms = now;
                let verify = self.verify_tier().is_some();
                let item = &mut self.items[i];
                item.bytes = item.size;
                item.speed = 0.0;
                item.local_path = Some(local_path);
                if item.audio && verify {
                    item.state = ItemState::Verifying;
                    self.send_verify(i, out);
                } else {
                    item.state = ItemState::Verified;
                }
            }
            TransferStatus::Failed { reason } => self.item_failed(i, &reason, now, out),
            TransferStatus::TimedOut => self.item_failed(i, "timed out", now, out),
            TransferStatus::Cancelled => {}
        }
    }

    fn verified(&mut self, name: &str, verdict: Verdict, now: u64, out: &mut Vec<JobAction>) {
        let Some(i) = self.find(name) else { return };
        if self.items[i].state != ItemState::Verifying {
            return;
        }
        let ok = verdict.ok;
        let reason = verdict
            .reason
            .clone()
            .unwrap_or_else(|| "it does not match the profile".into());
        self.items[i].verdict = Some(verdict);
        if ok {
            self.items[i].state = ItemState::Verified;
            return;
        }
        let item = &mut self.items[i];
        item.state = ItemState::Rejected;
        item.rejected_size = Some(item.size);
        let base = item.base().to_string();
        self.discard(i, out);
        self.say(
            now,
            Tone::Warn,
            format!("{base} failed the check: {reason}"),
        );
        let check = if self.lossless_tier() {
            "failed the lossless check"
        } else {
            "failed the quality check"
        };
        match self.assign(i, now, out) {
            Some(s) => {
                let user = self.user(s).to_string();
                self.say(
                    now,
                    Tone::Info,
                    format!("Fetching {base} again from {user}"),
                );
                self.notice = Some((check.into(), format!("{base}, fetching it from {user}")));
            }
            None => self.notice = Some((check.into(), base)),
        }
    }

    fn verify_error(&mut self, name: &str, error: &str, now: u64, out: &mut Vec<JobAction>) {
        let Some(i) = self.find(name) else { return };
        if self.items[i].state != ItemState::Verifying {
            return;
        }
        self.discard(i, out);
        self.item_failed(i, &format!("unreadable: {error}"), now, out);
    }

    fn keep_anyway(&mut self, name: &str, now: u64, out: &mut Vec<JobAction>) {
        let Some(i) = self.find(name) else { return };
        let item = &self.items[i];
        let rejected = item.verdict.as_ref().is_some_and(|v| !v.ok) && !item.done();
        if !rejected {
            return;
        }
        let base = item.base().to_string();
        if self.profile.verify.on_fail == OnFail::Delete {
            self.say(
                now,
                Tone::Warn,
                format!("{base} was deleted after the failed check, so it cannot be kept"),
            );
            return;
        }
        if item.active() {
            self.cancel(i, out);
        }
        self.items[i].state = ItemState::KeptAnyway;
        self.say(now, Tone::Info, format!("Kept {base} anyway"));
        if matches!(self.phase, Phase::Failed(_)) && self.items.iter().all(|i| i.done() || !i.audio)
        {
            self.phase = Phase::Active;
        }
    }

    fn new_sources(&mut self, candidates: Vec<Candidate>, now: u64, out: &mut Vec<JobAction>) {
        self.research = Research::Done;
        let mut added = 0;
        for c in candidates {
            let known = self
                .sources
                .iter()
                .any(|s| s.cand.source.username == c.source.username && s.cand.folder == c.folder);
            let useful = self.items.iter().any(|i| {
                !i.done()
                    && c.files
                        .iter()
                        .any(|f| f.name().eq_ignore_ascii_case(i.base()))
            });
            if !known && useful {
                self.sources.push(Src {
                    cand: c,
                    used: false,
                    last_activity_ms: now,
                });
                added += 1;
            }
        }
        if added == 0 {
            self.say(
                now,
                Tone::Warn,
                "The new search found no other sources".into(),
            );
            return;
        }
        self.say(
            now,
            Tone::Info,
            format!("The new search found {}", plural(added, "more source")),
        );
        if self.phase == Phase::Active {
            for i in 0..self.items.len() {
                if self.items[i].stranded() {
                    self.assign(i, now, out);
                }
            }
        }
    }

    fn retry(&mut self, now: u64, out: &mut Vec<JobAction>) {
        for item in self.items.iter_mut().filter(|i| !i.done()) {
            item.tried.clear();
            item.source = None;
            item.bytes = 0;
            item.speed = 0.0;
            if item.state != ItemState::Verifying {
                item.state = ItemState::Pending;
            }
        }
        for s in &mut self.sources {
            s.used = false;
        }
        self.research = Research::NotYet;
        self.notice = None;
        self.phase = Phase::Active;
        self.finished_ms = None;
        self.say(now, Tone::Info, "Trying again".into());
        self.start(now, out);
    }

    // -----------------------------------------------------------------------
    // Decisions
    // -----------------------------------------------------------------------

    /// Done, waiting for a re-search, or out of options.
    fn settle(&mut self, now: u64, out: &mut Vec<JobAction>) {
        let audio_left = self.items.iter().any(|i| i.audio && !i.done());
        let busy = self
            .items
            .iter()
            .any(|i| i.active() || i.state == ItemState::Verifying);
        if !audio_left && !busy {
            if self.phase != Phase::Done {
                self.phase = Phase::Done;
                self.notice = None;
                self.finished_ms = Some(now);
                let (_, detail) = self.status();
                self.say(now, Tone::Ok, capitalize(&detail));
                out.push(JobAction::Finished);
            }
            return;
        }
        if self.phase != Phase::Active {
            return;
        }
        let used = self.sources.iter().filter(|s| s.used).count();
        let stranded = self
            .items
            .iter()
            .filter(|i| i.audio && i.stranded())
            .count();
        let limit = used >= self.profile.stuck.max_sources as usize;
        if self.research == Research::NotYet && (stranded > 0 || limit) {
            self.research = Research::Pending;
            let why = if limit {
                format!("Tried {}", plural(used, "source"))
            } else {
                "Ran out of sources".into()
            };
            self.say(now, Tone::Info, format!("{why}, searching again"));
            out.push(JobAction::Research {
                query: self.query(),
            });
        } else if self.research == Research::Done && stranded > 0 && !busy {
            let reason = format!("no source left for {}", plural(stranded, "file"));
            self.say(now, Tone::Warn, format!("Gave up: {reason}"));
            self.phase = Phase::Failed(reason);
            self.notice = None;
            self.finished_ms = Some(now);
            if self.profile.stuck.wishlist_when_exhausted {
                let query = self.query();
                self.say(
                    now,
                    Tone::Info,
                    format!("Added \"{query}\" to the wishlist"),
                );
                out.push(JobAction::AddToWishlist { query });
            }
        }
    }

    /// Moves `items` (all at one stuck source) to their next sources. Cover
    /// art alone never causes a switch: it is skipped instead.
    fn switch(&mut self, items: &[usize], why: &str, now: u64, out: &mut Vec<JobAction>) {
        let only_extras = items.iter().all(|&i| !self.items[i].audio);
        let mut next_user = None;
        for &i in items {
            self.cancel(i, out);
            if only_extras {
                self.items[i].state = ItemState::Failed {
                    reason: "skipped, the source stopped".into(),
                };
            } else if let Some(s) = self.assign(i, now, out) {
                next_user.get_or_insert(s);
            } else {
                self.items[i].state = ItemState::Failed {
                    reason: "no other source has it".into(),
                };
            }
        }
        let (text, detail) = match next_user {
            _ if only_extras => (format!("{why}, skipped the cover art"), None),
            Some(s) => {
                let user = self.user(s).to_string();
                (
                    format!("{why}, switched to {user}"),
                    Some(format!("now from {user}")),
                )
            }
            None => (
                format!("{why}, and no other source has these files"),
                Some("looking for other sources".into()),
            ),
        };
        self.say(now, Tone::Warn, text);
        if let Some(detail) = detail {
            self.notice = Some(("switched source".into(), detail));
        }
    }

    fn item_failed(&mut self, i: usize, reason: &str, now: u64, out: &mut Vec<JobAction>) {
        let base = self.items[i].base().to_string();
        let from = self.items[i]
            .source
            .map(|s| self.user(s).to_string())
            .unwrap_or_default();
        match self.assign(i, now, out) {
            Some(s) => {
                let user = self.user(s).to_string();
                self.say(
                    now,
                    Tone::Warn,
                    format!("{base} failed at {from} ({reason}), trying {user}"),
                );
                self.notice = Some(("retrying a file".into(), format!("{base}, now from {user}")));
            }
            None => {
                self.say(
                    now,
                    Tone::Warn,
                    format!("{base} failed at {from} ({reason})"),
                );
                self.items[i].state = ItemState::Failed {
                    reason: reason.into(),
                };
            }
        }
    }

    /// Points item `i` at the next source that has it and requests it.
    /// Returns the source, or `None` (item untouched) when none is left.
    fn assign(&mut self, i: usize, now: u64, out: &mut Vec<JobAction>) -> Option<usize> {
        let (s, file) = self.pick_source(i)?;
        if !self
            .items
            .iter()
            .any(|it| it.active() && it.source == Some(s))
        {
            self.sources[s].last_activity_ms = now;
        }
        self.sources[s].used = true;
        let item = &mut self.items[i];
        item.tried.push(s);
        item.source = Some(s);
        item.remote_path = file.path;
        item.size = file.size;
        item.bytes = 0;
        item.speed = 0.0;
        item.state = ItemState::Pending;
        self.request(i, out);
        Some(s)
    }

    /// The best untried source holding a file with the item's name. Same size
    /// first, except after a rejection, when a different size (a different
    /// rip) is the better bet.
    fn pick_source(&self, i: usize) -> Option<(usize, FileInfo)> {
        let item = &self.items[i];
        let mut matches = self
            .sources
            .iter()
            .enumerate()
            .filter(|(s, _)| !item.tried.contains(s))
            .filter_map(|(s, src)| {
                src.cand
                    .files
                    .iter()
                    .find(|f| f.name().eq_ignore_ascii_case(item.base()))
                    .map(|f| (s, f))
            });
        let prefer_other = item.rejected_size;
        let first = matches.clone().find(|(_, f)| match prefer_other {
            Some(bad) => f.size != bad,
            None => f.size == item.size,
        });
        first
            .or_else(|| matches.next())
            .map(|(s, f)| (s, f.clone()))
    }

    // -----------------------------------------------------------------------
    // Small helpers
    // -----------------------------------------------------------------------

    fn request(&self, i: usize, out: &mut Vec<JobAction>) {
        let item = &self.items[i];
        let s = item.source.expect("requested items have a source");
        out.push(JobAction::Request {
            username: self.user(s).to_string(),
            remote_path: item.remote_path.clone(),
            size: item.size,
            dest_dir: item.dest_dir.clone(),
        });
    }

    fn cancel(&mut self, i: usize, out: &mut Vec<JobAction>) {
        let item = &self.items[i];
        if let (true, Some(s)) = (item.active(), item.source) {
            out.push(JobAction::CancelTransfer {
                username: self.user(s).to_string(),
                remote_path: item.remote_path.clone(),
            });
        }
        let item = &mut self.items[i];
        item.speed = 0.0;
        item.state = ItemState::Pending;
    }

    /// Cancels every running transfer but keeps each item's source, so a
    /// resume asks the same peers again.
    fn cancel_active(&mut self, out: &mut Vec<JobAction>) {
        for i in 0..self.items.len() {
            if self.items[i].active() {
                self.cancel(i, out);
            }
        }
    }

    fn send_verify(&self, i: usize, out: &mut Vec<JobAction>) {
        let (Some(tier), Some(path)) = (self.verify_tier(), &self.items[i].local_path) else {
            return;
        };
        out.push(JobAction::Verify {
            name: self.items[i].name.clone(),
            local_path: path.clone(),
            tier,
            strictness: self.profile.verify.strictness,
        });
    }

    /// Deletes or sets aside a downloaded file that did not pass.
    fn discard(&mut self, i: usize, out: &mut Vec<JobAction>) {
        if let Some(path) = self.items[i].local_path.clone() {
            out.push(match self.profile.verify.on_fail {
                OnFail::Delete => JobAction::Delete { local_path: path },
                OnFail::MoveToRejected => JobAction::MoveToRejected { local_path: path },
            });
        }
    }

    /// The tier downloads are checked against. A release picked from the
    /// hidden list (below every tier) is not verified.
    fn verify_tier(&self) -> Option<Tier> {
        if !self.profile.verify.enabled {
            return None;
        }
        self.profile.tiers.get(self.tier).cloned()
    }

    fn lossless_tier(&self) -> bool {
        self.verify_tier()
            .is_some_and(|t| t.codecs.iter().all(|c| c.is_lossless()))
    }

    fn find(&self, name: &str) -> Option<usize> {
        self.items
            .iter()
            .position(|i| i.name == name)
            .or_else(|| self.items.iter().position(|i| i.base() == name))
    }

    fn user(&self, s: usize) -> &str {
        &self.sources[s].cand.source.username
    }

    /// The source most active items are at.
    fn current_source(&self) -> Option<usize> {
        let mut counts = vec![0usize; self.sources.len()];
        for s in self
            .items
            .iter()
            .filter(|i| i.active())
            .filter_map(|i| i.source)
        {
            counts[s] += 1;
        }
        (0..counts.len())
            .filter(|&s| counts[s] > 0)
            .max_by_key(|&s| (counts[s], usize::MAX - s))
    }

    fn query(&self) -> String {
        match &self.artist {
            Some(a) => format!("{a} {}", self.title),
            None => self.title.clone(),
        }
    }

    fn say(&mut self, at_ms: u64, tone: Tone, text: String) {
        self.log.push(LogEntry { at_ms, text, tone });
    }

    fn status(&self) -> (JobStatus, String) {
        let audio = self.items.iter().filter(|i| i.audio).count();
        let done = self.items.iter().filter(|i| i.audio && i.done()).count();
        let progress = format!("{done} of {audio} files done");
        match &self.phase {
            Phase::Paused => return (JobStatus::Paused, progress),
            Phase::Cancelled => return (JobStatus::Cancelled, progress),
            Phase::Failed(reason) => {
                return (
                    JobStatus::Failed {
                        reason: reason.clone(),
                    },
                    reason.clone(),
                );
            }
            Phase::Done => {
                let kept = self
                    .items
                    .iter()
                    .filter(|i| i.state == ItemState::KeptAnyway)
                    .count();
                let detail = match (self.verify_tier().is_some(), kept) {
                    (false, _) => "all files downloaded".into(),
                    (true, 0) if self.lossless_tier() => "all files verified lossless".into(),
                    (true, 0) => "all files verified".into(),
                    (true, k) => format!("{} verified, {k} kept anyway", plural(audio - k, "file")),
                };
                return (JobStatus::Done, detail);
            }
            Phase::Active => {}
        }
        if let Some((reason, detail)) = &self.notice {
            return (
                JobStatus::Recovering {
                    reason: reason.clone(),
                },
                detail.clone(),
            );
        }
        let user = self
            .current_source()
            .map(|s| self.user(s).to_string())
            .unwrap_or_default();
        let active = || self.items.iter().filter(|i| i.active());
        if active().any(|i| i.state == ItemState::Downloading) {
            return (JobStatus::Downloading, format!("from {user}"));
        }
        let verifying = self
            .items
            .iter()
            .filter(|i| i.state == ItemState::Verifying)
            .count();
        if verifying > 0 {
            return (
                JobStatus::Verifying,
                format!("checking {}", plural(verifying, "file")),
            );
        }
        let queued: Vec<Option<u32>> = active()
            .filter_map(|i| match i.state {
                ItemState::Queued { position } => Some(position),
                _ => None,
            })
            .collect();
        if !queued.is_empty() {
            let position = queued.iter().flatten().min().copied();
            let detail = match position {
                Some(p) => format!("position {p} at {user}"),
                None => format!("in queue at {user}"),
            };
            return (JobStatus::Queued { position }, detail);
        }
        if active().next().is_some() {
            return (JobStatus::Waiting, format!("waiting for {user}"));
        }
        if self.research == Research::Pending {
            return (
                JobStatus::Recovering {
                    reason: "searching again".into(),
                },
                "every source was tried".into(),
            );
        }
        (JobStatus::Waiting, progress)
    }
}

/// Path of `f` inside the candidate's folder, with `/` separators.
fn relative(c: &Candidate, f: &FileInfo) -> String {
    f.path
        .strip_prefix(&c.folder)
        .unwrap_or(&f.path)
        .trim_start_matches(['\\', '/'])
        .replace('\\', "/")
}

fn is_cover(name: &str) -> bool {
    name.rsplit_once('.')
        .is_some_and(|(_, ext)| COVER_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

/// A remote folder name made safe as a local one.
fn sanitize(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let clean = clean.trim().trim_end_matches('.').to_string();
    if clean.is_empty() {
        "download".into()
    } else {
        clean
    }
}

fn plural(n: usize, word: &str) -> String {
    if n == 1 {
        format!("1 {word}")
    } else {
        format!("{n} {word}s")
    }
}

fn duration(secs: u32) -> String {
    if secs >= 60 {
        format!("{} min", secs / 60)
    } else {
        format!("{secs} s")
    }
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    c.next()
        .map(|f| f.to_uppercase().chain(c).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Codec, Source, Strictness};

    const MIN: u64 = 60_000;

    fn track(folder: &str, name: &str, size: u64) -> FileInfo {
        FileInfo::from_attributes(format!("{folder}\\{name}"), size, &[(4, 44_100), (5, 16)])
    }

    /// Homework at `user`: three tracks plus cover art; `bump` changes the sizes (a different rip).
    fn homework(user: &str, bump: u64) -> Candidate {
        let folder = format!(r"@@{user}\Music\Daft Punk\1997 - Homework [FLAC]");
        let mut files: Vec<FileInfo> = (1..=3)
            .map(|i| track(&folder, &format!("{i:02}.flac"), 30_000_000 + i + bump))
            .collect();
        files.push(FileInfo::from_attributes(
            format!("{folder}\\cover.jpg"),
            400_000,
            &[],
        ));
        Candidate {
            id: format!("{user}-homework"),
            source: Source {
                username: user.into(),
                free_slot: true,
                avg_speed: 1_000_000,
                queue_len: Some(0),
            },
            folder,
            total_size: files.iter().map(|f| f.size).sum(),
            files,
        }
    }

    fn release(users: &[&str]) -> Release {
        Release {
            id: "homework".into(),
            title: "Homework".into(),
            artist: Some("Daft Punk".into()),
            year: Some(1997),
            best: homework(users[0], 0),
            alternates: users[1..].iter().map(|u| homework(u, 0)).collect(),
            tier: 1,
            format_label: "FLAC 16/44.1".into(),
            track_count: 3,
            expected_tracks: 3,
            score: 1.0,
        }
    }

    fn job_with(users: &[&str], profile: QualityProfile) -> (Job, Vec<JobAction>) {
        let mut job = Job::new(
            "j1".into(),
            &release(users),
            None,
            &profile,
            "/music".into(),
            0,
        );
        let actions = job.handle(JobEvent::Start, 0);
        (job, actions)
    }

    fn job(users: &[&str]) -> (Job, Vec<JobAction>) {
        job_with(users, QualityProfile::lossless_first())
    }

    /// (user, file name) of every Request.
    fn requests(actions: &[JobAction]) -> Vec<(String, String)> {
        actions
            .iter()
            .filter_map(|a| match a {
                JobAction::Request {
                    username,
                    remote_path,
                    ..
                } => Some((username.clone(), basename(remote_path).to_string())),
                _ => None,
            })
            .collect()
    }

    fn cancels(actions: &[JobAction]) -> Vec<(String, String)> {
        actions
            .iter()
            .filter_map(|a| match a {
                JobAction::CancelTransfer {
                    username,
                    remote_path,
                } => Some((username.clone(), basename(remote_path).to_string())),
                _ => None,
            })
            .collect()
    }

    fn pairs(list: &[(&str, &str)]) -> Vec<(String, String)> {
        list.iter()
            .map(|(u, n)| (u.to_string(), n.to_string()))
            .collect()
    }

    fn progress(job: &mut Job, name: &str, bytes: u64, now: u64) -> Vec<JobAction> {
        job.handle(
            JobEvent::Transfer {
                name: name.into(),
                status: TransferStatus::Progress {
                    bytes,
                    total: 0,
                    speed: 500_000.0,
                },
            },
            now,
        )
    }

    fn complete(job: &mut Job, name: &str, now: u64) -> Vec<JobAction> {
        let local_path = format!("/music/1997 - Homework [FLAC]/{name}");
        job.handle(
            JobEvent::Transfer {
                name: name.into(),
                status: TransferStatus::Completed { local_path },
            },
            now,
        )
    }

    fn verdict(ok: bool) -> Verdict {
        Verdict {
            ok,
            codec: Codec::Flac,
            sample_rate: Some(44_100),
            bit_depth: Some(16),
            bitrate_kbps: None,
            cutoff_hz: if ok { None } else { Some(16_000.0) },
            nyquist_hz: 22_050.0,
            reason: (!ok)
                .then(|| "stops at 16 kHz, typical of a 128 kbps MP3 saved as FLAC".into()),
            spectrum: vec![],
        }
    }

    fn verified(job: &mut Job, name: &str, ok: bool, now: u64) -> Vec<JobAction> {
        job.handle(
            JobEvent::Verified {
                name: name.into(),
                verdict: verdict(ok),
            },
            now,
        )
    }

    fn state(job: &Job, name: &str) -> ItemState {
        job.view(0)
            .items
            .into_iter()
            .find(|i| i.name == name)
            .expect("item exists")
            .state
    }

    fn last_log(job: &Job) -> String {
        job.view(0)
            .log
            .last()
            .expect("log has entries")
            .text
            .clone()
    }

    /// Downloads and verifies every file still at its source.
    fn finish_all(job: &mut Job, now: u64) -> Vec<JobAction> {
        let mut out = Vec::new();
        for name in ["01.flac", "02.flac", "03.flac", "cover.jpg"] {
            if job.find(name).is_some_and(|i| job.items[i].active()) {
                out.extend(complete(job, name, now));
                if name.ends_with(".flac") {
                    out.extend(verified(job, name, true, now));
                }
            }
        }
        out
    }

    #[test]
    fn start_requests_audio_and_cover_from_the_best_source_into_the_release_folder() {
        let (job, actions) = job(&["deepcrates", "vinyl_haus"]);
        assert_eq!(
            requests(&actions),
            pairs(&[
                ("deepcrates", "01.flac"),
                ("deepcrates", "02.flac"),
                ("deepcrates", "03.flac"),
                ("deepcrates", "cover.jpg")
            ])
        );
        let JobAction::Request { dest_dir, size, .. } = &actions[0] else {
            panic!("expected a request")
        };
        assert_eq!(
            Path::new(dest_dir),
            Path::new("/music/1997 - Homework [FLAC]")
        );
        assert_eq!(*size, 30_000_001);
        let v = job.view(0);
        assert_eq!(v.status, JobStatus::Waiting);
        assert_eq!(v.detail, "waiting for deepcrates");
        assert_eq!(
            (v.current_user.as_deref(), v.source_index, v.source_count),
            (Some("deepcrates"), 1, 2)
        );
        assert_eq!(last_log(&job), "Asked deepcrates for 4 files");
    }

    #[test]
    fn a_subset_of_files_can_be_requested() {
        let profile = QualityProfile::lossless_first();
        let mut job = Job::new(
            "j1".into(),
            &release(&["deepcrates"]),
            Some(vec!["02.flac".into()]),
            &profile,
            "/music".into(),
            0,
        );
        let actions = job.handle(JobEvent::Start, 0);
        assert_eq!(requests(&actions), pairs(&[("deepcrates", "02.flac")]));
        assert_eq!(job.view(0).items.len(), 1);
    }

    #[test]
    fn disc_subfolders_are_kept_locally() {
        let mut r = release(&["deepcrates"]);
        r.best.files = vec![track(&format!(r"{}\CD2", r.best.folder), "01.flac", 5)];
        let mut job = Job::new(
            "j1".into(),
            &r,
            None,
            &QualityProfile::lossless_first(),
            "/music".into(),
            0,
        );
        let actions = job.handle(JobEvent::Start, 0);
        let JobAction::Request { dest_dir, .. } = &actions[0] else {
            panic!("expected a request")
        };
        assert_eq!(
            Path::new(dest_dir),
            Path::new("/music/1997 - Homework [FLAC]/CD2")
        );
        assert_eq!(job.view(0).items[0].name, "CD2/01.flac");
    }

    #[test]
    fn progress_shows_downloading_and_sums_bytes() {
        let (mut job, _) = job(&["deepcrates"]);
        progress(&mut job, "01.flac", 10_000_000, 1000);
        let v = job.view(1000);
        assert_eq!(v.status, JobStatus::Downloading);
        assert_eq!(v.detail, "from deepcrates");
        assert_eq!(v.bytes, 10_000_000);
        assert_eq!(v.total, 90_000_006 + 400_000);
        assert_eq!(v.speed, 500_000.0);
        assert_eq!(state(&job, "01.flac"), ItemState::Downloading);
    }

    #[test]
    fn a_source_that_stops_sending_data_is_replaced() {
        let (mut job, _) = job(&["kdj_archive", "vinyl_haus"]);
        progress(&mut job, "01.flac", 1_000_000, 0);
        progress(&mut job, "01.flac", 1_000_000, MIN); // same bytes: not progress
        assert!(job.handle(JobEvent::Tick, 2 * MIN - 1).is_empty());

        let actions = job.handle(JobEvent::Tick, 2 * MIN);
        assert_eq!(cancels(&actions).len(), 4);
        assert_eq!(
            requests(&actions),
            pairs(&[
                ("vinyl_haus", "01.flac"),
                ("vinyl_haus", "02.flac"),
                ("vinyl_haus", "03.flac"),
                ("vinyl_haus", "cover.jpg")
            ])
        );
        assert_eq!(
            last_log(&job),
            "kdj_archive stopped sending data, switched to vinyl_haus"
        );
        let v = job.view(2 * MIN);
        assert_eq!(
            v.status,
            JobStatus::Recovering {
                reason: "switched source".into()
            }
        );
        assert_eq!(v.detail, "now from vinyl_haus");
        assert_eq!(
            (v.current_user.as_deref(), v.source_index),
            (Some("vinyl_haus"), 2)
        );
        assert_eq!(v.bytes, 0);
    }

    #[test]
    fn late_updates_from_the_old_source_map_to_nothing() {
        let (mut job, _) = job(&["kdj_archive", "vinyl_haus"]);
        let old_path = job.items[0].remote_path.clone();
        assert_eq!(job.item_name("kdj_archive", &old_path), Some("01.flac"));
        progress(&mut job, "01.flac", 1, 0);
        job.handle(JobEvent::Tick, 2 * MIN);
        assert_eq!(job.item_name("kdj_archive", &old_path), None);
        let new_path = job.items[0].remote_path.clone();
        assert_eq!(job.item_name("vinyl_haus", &new_path), Some("01.flac"));
    }

    #[test]
    fn waiting_too_long_in_a_queue_switches_source() {
        let (mut job, _) = job(&["hood_fan", "soul_sounds"]);
        for name in ["01.flac", "02.flac", "03.flac", "cover.jpg"] {
            job.handle(
                JobEvent::Transfer {
                    name: name.into(),
                    status: TransferStatus::Queued { position: Some(14) },
                },
                1000,
            );
        }
        let v = job.view(4 * MIN);
        assert_eq!(v.status, JobStatus::Queued { position: Some(14) });
        assert_eq!(v.detail, "position 14 at hood_fan");
        assert_eq!(v.switch_in_secs, Some(360));

        assert!(job.handle(JobEvent::Tick, 10 * MIN - 1).is_empty());
        let actions = job.handle(JobEvent::Tick, 10 * MIN);
        assert_eq!(requests(&actions).len(), 4);
        assert!(requests(&actions).iter().all(|(u, _)| u == "soul_sounds"));
        assert_eq!(
            last_log(&job),
            "waited 10 min in queue at hood_fan, switched to soul_sounds"
        );
    }

    #[test]
    fn a_downloading_file_keeps_the_queue_clock_from_switching() {
        let (mut job, _) = job(&["hood_fan", "soul_sounds"]);
        job.handle(
            JobEvent::Transfer {
                name: "02.flac".into(),
                status: TransferStatus::Queued { position: Some(1) },
            },
            0,
        );
        for minute in 1..=12 {
            progress(&mut job, "01.flac", minute * 1_000_000, minute * MIN);
            assert!(job.handle(JobEvent::Tick, minute * MIN).is_empty());
        }
    }

    #[test]
    fn a_failed_file_moves_to_the_next_source_alone() {
        let (mut job, _) = job(&["deepcrates", "vinyl_haus"]);
        let actions = job.handle(
            JobEvent::Transfer {
                name: "02.flac".into(),
                status: TransferStatus::Failed {
                    reason: "file not shared".into(),
                },
            },
            1000,
        );
        assert_eq!(requests(&actions), pairs(&[("vinyl_haus", "02.flac")]));
        assert!(cancels(&actions).is_empty());
        assert_eq!(
            last_log(&job),
            "02.flac failed at deepcrates (file not shared), trying vinyl_haus"
        );
        assert_eq!(job.view(1000).current_user.as_deref(), Some("deepcrates"));
    }

    #[test]
    fn timed_out_files_are_retried_too() {
        let (mut job, _) = job(&["deepcrates", "vinyl_haus"]);
        let actions = job.handle(
            JobEvent::Transfer {
                name: "01.flac".into(),
                status: TransferStatus::TimedOut,
            },
            0,
        );
        assert_eq!(requests(&actions), pairs(&[("vinyl_haus", "01.flac")]));
    }

    #[test]
    fn completed_audio_is_verified_against_the_release_tier() {
        let (mut job, _) = job(&["deepcrates"]);
        let actions = complete(&mut job, "01.flac", 1000);
        let [
            JobAction::Verify {
                name,
                local_path,
                tier,
                strictness,
            },
        ] = actions.as_slice()
        else {
            panic!("expected one verify, got {actions:?}")
        };
        assert_eq!(name, "01.flac");
        assert_eq!(local_path, "/music/1997 - Homework [FLAC]/01.flac");
        assert_eq!(tier.label, "FLAC 16-bit");
        assert_eq!(*strictness, Strictness::Normal);
        assert_eq!(state(&job, "01.flac"), ItemState::Verifying);
    }

    #[test]
    fn the_job_finishes_when_every_file_is_verified() {
        let (mut job, _) = job(&["deepcrates"]);
        let actions = finish_all(&mut job, 5 * MIN);
        assert_eq!(
            actions
                .iter()
                .filter(|a| **a == JobAction::Finished)
                .count(),
            1
        );
        assert!(!complete(&mut job, "cover.jpg", 6 * MIN).contains(&JobAction::Finished));
        let v = job.view(5 * MIN);
        assert_eq!(v.status, JobStatus::Done);
        assert_eq!(v.detail, "all files verified lossless");
        assert_eq!(v.finished_ms, Some(5 * MIN));
        assert_eq!(v.bytes, v.total);
        assert_eq!(state(&job, "cover.jpg"), ItemState::Verified);
    }

    #[test]
    fn without_verification_completed_files_count_as_done() {
        let mut profile = QualityProfile::lossless_first();
        profile.verify.enabled = false;
        let (mut job, _) = job_with(&["deepcrates"], profile);
        let mut actions = Vec::new();
        for name in ["01.flac", "02.flac", "03.flac", "cover.jpg"] {
            actions.extend(complete(&mut job, name, 1000));
        }
        assert!(
            !actions
                .iter()
                .any(|a| matches!(a, JobAction::Verify { .. }))
        );
        assert_eq!(actions.last(), Some(&JobAction::Finished));
        assert_eq!(job.view(1000).detail, "all files downloaded");
    }

    #[test]
    fn a_rejected_file_is_deleted_and_fetched_from_a_different_rip_first() {
        let mut r = release(&["deepcrates", "vinyl_haus"]);
        r.alternates.push(homework("soul_sounds", 7));
        let mut job = Job::new(
            "j1".into(),
            &r,
            None,
            &QualityProfile::lossless_first(),
            "/music".into(),
            0,
        );
        job.handle(JobEvent::Start, 0);
        complete(&mut job, "03.flac", 1000);
        let actions = verified(&mut job, "03.flac", false, 2000);
        assert_eq!(
            actions[0],
            JobAction::Delete {
                local_path: "/music/1997 - Homework [FLAC]/03.flac".into()
            }
        );
        assert_eq!(requests(&actions), pairs(&[("soul_sounds", "03.flac")]));
        let log: Vec<String> = job.view(0).log.iter().map(|l| l.text.clone()).collect();
        assert!(log.contains(&"03.flac failed the check: stops at 16 kHz, typical of a 128 kbps MP3 saved as FLAC".into()));
        let v = job.view(2000);
        assert_eq!(
            v.status,
            JobStatus::Recovering {
                reason: "failed the lossless check".into()
            }
        );
        assert_eq!(v.detail, "03.flac, fetching it from soul_sounds");
        assert!(
            v.items
                .iter()
                .find(|i| i.name == "03.flac")
                .is_some_and(|i| i.verdict.as_ref().is_some_and(|v| !v.ok))
        );
    }

    #[test]
    fn a_rejected_file_falls_back_to_an_identical_copy() {
        let (mut job, _) = job(&["deepcrates", "vinyl_haus"]);
        complete(&mut job, "03.flac", 1000);
        let actions = verified(&mut job, "03.flac", false, 2000);
        assert_eq!(requests(&actions), pairs(&[("vinyl_haus", "03.flac")]));
    }

    #[test]
    fn rejected_files_go_to_the_rejected_folder_and_can_be_kept() {
        let mut profile = QualityProfile::lossless_first();
        profile.verify.on_fail = OnFail::MoveToRejected;
        let (mut job, _) = job_with(&["deepcrates", "vinyl_haus"], profile);
        complete(&mut job, "03.flac", 1000);
        let actions = verified(&mut job, "03.flac", false, 2000);
        assert!(matches!(actions[0], JobAction::MoveToRejected { .. }));

        let actions = job.handle(
            JobEvent::KeepAnyway {
                name: "03.flac".into(),
            },
            3000,
        );
        assert_eq!(cancels(&actions), pairs(&[("vinyl_haus", "03.flac")]));
        assert_eq!(state(&job, "03.flac"), ItemState::KeptAnyway);
        assert_eq!(last_log(&job), "Kept 03.flac anyway");

        let actions = finish_all(&mut job, 4000);
        assert_eq!(actions.last(), Some(&JobAction::Finished));
        assert_eq!(job.view(4000).detail, "2 files verified, 1 kept anyway");
    }

    #[test]
    fn a_deleted_file_cannot_be_kept() {
        let (mut job, _) = job(&["deepcrates", "vinyl_haus"]);
        complete(&mut job, "03.flac", 1000);
        verified(&mut job, "03.flac", false, 2000);
        assert!(
            job.handle(
                JobEvent::KeepAnyway {
                    name: "03.flac".into()
                },
                3000
            )
            .is_empty()
        );
        assert_eq!(state(&job, "03.flac"), ItemState::Pending);
        assert_eq!(
            last_log(&job),
            "03.flac was deleted after the failed check, so it cannot be kept"
        );
    }

    #[test]
    fn keep_anyway_ignores_files_that_passed() {
        let mut profile = QualityProfile::lossless_first();
        profile.verify.on_fail = OnFail::MoveToRejected;
        let (mut job, _) = job_with(&["deepcrates"], profile);
        complete(&mut job, "01.flac", 0);
        verified(&mut job, "01.flac", true, 0);
        let logs = job.view(0).log.len();
        assert!(
            job.handle(
                JobEvent::KeepAnyway {
                    name: "01.flac".into()
                },
                0
            )
            .is_empty()
        );
        assert_eq!(state(&job, "01.flac"), ItemState::Verified);
        assert_eq!(job.view(0).log.len(), logs);
    }

    #[test]
    fn an_unreadable_file_is_removed_and_fetched_elsewhere() {
        let (mut job, _) = job(&["deepcrates", "vinyl_haus"]);
        complete(&mut job, "02.flac", 0);
        let actions = job.handle(
            JobEvent::VerifyError {
                name: "02.flac".into(),
                error: "not a FLAC stream".into(),
            },
            0,
        );
        assert!(matches!(actions[0], JobAction::Delete { .. }));
        assert_eq!(requests(&actions), pairs(&[("vinyl_haus", "02.flac")]));
    }

    #[test]
    fn running_out_of_sources_searches_again_then_uses_what_it_finds() {
        let (mut job, _) = job(&["deepcrates"]);
        let failed = TransferStatus::Failed {
            reason: "denied".into(),
        };
        let actions = job.handle(
            JobEvent::Transfer {
                name: "02.flac".into(),
                status: failed.clone(),
            },
            1000,
        );
        assert_eq!(
            actions,
            vec![JobAction::Research {
                query: "Daft Punk Homework".into()
            }]
        );
        assert_eq!(
            state(&job, "02.flac"),
            ItemState::Failed {
                reason: "denied".into()
            }
        );
        // Only once, even when another file fails.
        let actions = job.handle(
            JobEvent::Transfer {
                name: "03.flac".into(),
                status: failed,
            },
            2000,
        );
        assert!(actions.is_empty());

        // A different rip, found by name.
        let actions = job.handle(
            JobEvent::NewSources {
                candidates: vec![homework("deepcrates", 0), homework("soul_sounds", 99)],
            },
            3000,
        );
        assert_eq!(
            requests(&actions),
            pairs(&[("soul_sounds", "02.flac"), ("soul_sounds", "03.flac")])
        );
        assert_eq!(job.view(3000).source_count, 2);
        let JobAction::Request { size, .. } = &actions[0] else {
            panic!("expected a request")
        };
        assert_eq!(*size, 30_000_002 + 99);
    }

    #[test]
    fn exhausted_jobs_fail_and_go_on_the_wishlist() {
        let (mut job, _) = job(&["deepcrates"]);
        job.handle(
            JobEvent::Transfer {
                name: "02.flac".into(),
                status: TransferStatus::Failed {
                    reason: "denied".into(),
                },
            },
            1000,
        );
        // Other files still downloading: no verdict yet.
        assert!(
            job.handle(JobEvent::NewSources { candidates: vec![] }, 2000)
                .is_empty()
        );
        assert_eq!(job.view(2000).status, JobStatus::Waiting);

        complete(&mut job, "01.flac", 3000);
        verified(&mut job, "01.flac", true, 3000);
        complete(&mut job, "03.flac", 3000);
        complete(&mut job, "cover.jpg", 3000);
        let actions = verified(&mut job, "03.flac", true, 4000);
        assert_eq!(
            actions,
            vec![JobAction::AddToWishlist {
                query: "Daft Punk Homework".into()
            }]
        );
        let v = job.view(4000);
        assert_eq!(
            v.status,
            JobStatus::Failed {
                reason: "no source left for 1 file".into()
            }
        );
        assert_eq!(v.finished_ms, Some(4000));
        assert_eq!(
            last_log(&job),
            "Added \"Daft Punk Homework\" to the wishlist"
        );
    }

    #[test]
    fn the_wishlist_rule_can_be_off() {
        let mut profile = QualityProfile::lossless_first();
        profile.stuck.wishlist_when_exhausted = false;
        let (mut job, _) = job_with(&["deepcrates"], profile);
        job.handle(JobEvent::Pause, 0);
        job.handle(JobEvent::Cancel, 0);
        job.handle(JobEvent::Retry, 0);
        for name in ["01.flac", "02.flac", "03.flac", "cover.jpg"] {
            job.handle(
                JobEvent::Transfer {
                    name: name.into(),
                    status: TransferStatus::TimedOut,
                },
                0,
            );
        }
        let actions = job.handle(JobEvent::NewSources { candidates: vec![] }, 0);
        assert!(actions.is_empty());
        assert!(matches!(job.view(0).status, JobStatus::Failed { .. }));
    }

    #[test]
    fn reaching_max_sources_searches_again_while_continuing() {
        let mut profile = QualityProfile::lossless_first();
        profile.stuck.max_sources = 2;
        let (mut job, _) = job_with(&["kdj_archive", "vinyl_haus", "soul_sounds"], profile);
        progress(&mut job, "01.flac", 1, 0);
        let actions = job.handle(JobEvent::Tick, 2 * MIN);
        assert!(actions.contains(&JobAction::Research {
            query: "Daft Punk Homework".into()
        }));
        assert_eq!(requests(&actions).len(), 4);
    }

    #[test]
    fn stalled_cover_art_is_skipped_instead_of_switching() {
        let (mut job, _) = job(&["deepcrates", "vinyl_haus"]);
        for name in ["01.flac", "02.flac", "03.flac"] {
            complete(&mut job, name, 0);
            verified(&mut job, name, true, 0);
        }
        let actions = job.handle(JobEvent::Tick, 10 * MIN);
        assert_eq!(cancels(&actions), pairs(&[("deepcrates", "cover.jpg")]));
        assert!(requests(&actions).is_empty());
        assert!(actions.contains(&JobAction::Finished));
        assert_eq!(job.view(0).status, JobStatus::Done);
    }

    #[test]
    fn pause_resume_cancel_and_retry() {
        let (mut job, _) = job(&["deepcrates", "vinyl_haus"]);
        complete(&mut job, "01.flac", 0);
        verified(&mut job, "01.flac", true, 0);
        job.handle(
            JobEvent::Transfer {
                name: "02.flac".into(),
                status: TransferStatus::Failed {
                    reason: "denied".into(),
                },
            },
            0,
        );

        let actions = job.handle(JobEvent::Pause, MIN);
        assert_eq!(
            cancels(&actions),
            pairs(&[
                ("vinyl_haus", "02.flac"),
                ("deepcrates", "03.flac"),
                ("deepcrates", "cover.jpg")
            ])
        );
        assert_eq!(job.view(MIN).status, JobStatus::Paused);
        assert_eq!(job.view(MIN).detail, "1 of 3 files done");
        assert!(
            job.handle(JobEvent::Tick, 60 * MIN).is_empty(),
            "paused jobs never switch"
        );

        let actions = job.handle(JobEvent::Resume, 61 * MIN);
        assert_eq!(
            requests(&actions),
            pairs(&[
                ("vinyl_haus", "02.flac"),
                ("deepcrates", "03.flac"),
                ("deepcrates", "cover.jpg")
            ])
        );
        assert!(
            job.handle(JobEvent::Tick, 62 * MIN).is_empty(),
            "resume restarts the clocks"
        );

        let actions = job.handle(JobEvent::Cancel, 63 * MIN);
        assert_eq!(cancels(&actions).len(), 3);
        assert_eq!(job.view(0).status, JobStatus::Cancelled);
        assert!(job.handle(JobEvent::Resume, 63 * MIN).is_empty());

        let actions = job.handle(JobEvent::Retry, 64 * MIN);
        assert_eq!(
            requests(&actions),
            pairs(&[
                ("deepcrates", "02.flac"),
                ("deepcrates", "03.flac"),
                ("deepcrates", "cover.jpg")
            ])
        );
        assert_eq!(state(&job, "01.flac"), ItemState::Verified);
        assert_eq!(job.view(0).finished_ms, None);
    }

    #[test]
    fn a_file_finishing_during_pause_still_counts() {
        let (mut job, _) = job(&["deepcrates"]);
        job.handle(JobEvent::Pause, 0);
        let actions = complete(&mut job, "01.flac", 0);
        assert!(matches!(actions[0], JobAction::Verify { .. }));
        verified(&mut job, "01.flac", true, 0);
        assert_eq!(state(&job, "01.flac"), ItemState::Verified);
        assert_eq!(job.view(0).status, JobStatus::Paused);
    }

    #[test]
    fn a_restart_requests_open_files_again_and_resends_verifications() {
        let (mut job, _) = job(&["deepcrates"]);
        complete(&mut job, "01.flac", 0);
        progress(&mut job, "02.flac", 5, 0);
        let saved = serde_json::to_string(&job).expect("job serializes");
        let mut restored: Job = serde_json::from_str(&saved).expect("job deserializes");
        let actions = restored.handle(JobEvent::Start, MIN);
        assert!(matches!(&actions[0], JobAction::Verify { name, .. } if name == "01.flac"));
        assert_eq!(
            requests(&actions),
            pairs(&[
                ("deepcrates", "02.flac"),
                ("deepcrates", "03.flac"),
                ("deepcrates", "cover.jpg")
            ])
        );
    }

    #[test]
    fn events_for_unknown_files_are_ignored() {
        let (mut job, _) = job(&["deepcrates"]);
        let before = job.view(0);
        assert!(complete(&mut job, "99.flac", 0).is_empty());
        assert!(
            verified(&mut job, "01.flac", true, 0).is_empty(),
            "not verifying yet"
        );
        assert!(
            job.handle(
                JobEvent::Transfer {
                    name: "01.flac".into(),
                    status: TransferStatus::Cancelled
                },
                0
            )
            .is_empty()
        );
        assert_eq!(job.view(0), before);
    }
}
