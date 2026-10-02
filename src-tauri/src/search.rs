//! Searches: a worker per search polls the library while the search window
//! runs and emits throttled `search:update` views. Raw results of the last 20
//! searches stay in memory so a view can be rebuilt with another profile.

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use needle_core::api::ExtensionEvent;
use needle_core::model::{FileInfo, QualityProfile, RawResult, SearchView, Source};
use needle_core::releases::build_view;
use soulseek_rs::{Client, SearchResult};

use crate::state::{Shared, err, lock, now_ms};
use crate::throttle::Throttle;

pub const WINDOW: Duration = Duration::from_secs(12);
const KEEP: usize = 20;

#[derive(Clone)]
pub struct SearchEntry {
    pub query: String,
    pub profile_id: Option<String>,
    pub results: Vec<RawResult>,
    pub done: bool,
    cancel: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct Searches {
    entries: HashMap<String, SearchEntry>,
    order: VecDeque<String>,
    counter: u64,
}

impl Searches {
    fn next_id(&mut self, prefix: &str) -> String {
        self.counter += 1;
        format!("{prefix}{:x}-{}", now_ms(), self.counter)
    }

    fn insert(&mut self, id: String, entry: SearchEntry) {
        self.entries.insert(id.clone(), entry);
        self.order.push_back(id);
        while self.order.len() > KEEP {
            if let Some(old) = self.order.pop_front()
                && let Some(e) = self.entries.remove(&old)
            {
                e.cancel.store(true, Ordering::Relaxed);
            }
        }
    }

    pub fn get(&self, id: &str) -> Option<&SearchEntry> {
        self.entries.get(id)
    }

    pub fn last(&self) -> Option<&SearchEntry> {
        self.order.iter().rev().find_map(|id| self.entries.get(id))
    }

    /// Size of a remote file seen in any kept search.
    pub fn size_of(&self, path: &str) -> Option<u64> {
        self.entries
            .values()
            .flat_map(|e| &e.results)
            .flat_map(|r| &r.files)
            .find(|f| f.path == path)
            .map(|f| f.size)
    }
}

pub fn file_info(file: &soulseek_rs::File) -> FileInfo {
    let mut attrs: Vec<(u32, u32)> = file.attribs.iter().map(|(k, v)| (*k, *v)).collect();
    attrs.sort_unstable();
    FileInfo::from_attributes(file.name.clone(), file.size, &attrs)
}

pub fn raw_result(result: &SearchResult) -> RawResult {
    RawResult {
        source: Source {
            username: result.username.clone(),
            free_slot: result.slots > 0,
            avg_speed: result.speed,
            // The library parses past the queue length without keeping it.
            queue_len: None,
        },
        files: result.files.iter().map(file_info).collect(),
    }
}

/// The query as sent: the user's words plus the exclusion terms from settings.
pub fn wire_query(query: &str, exclusions: &[String]) -> String {
    let mut out = query.trim().to_string();
    for term in exclusions
        .iter()
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
    {
        out.push(' ');
        if !term.starts_with('-') {
            out.push('-');
        }
        out.push_str(term);
    }
    out
}

impl SearchEntry {
    pub fn view(&self, id: &str, profile: &QualityProfile, include_hidden: bool) -> SearchView {
        let mut v = build_view(id, &self.query, &self.results, profile, include_hidden);
        v.done = self.done;
        v
    }
}

/// A copy of a kept search, so views are built without holding the lock.
pub fn snapshot(state: &Shared, id: &str) -> Option<SearchEntry> {
    lock(&state.searches).get(id).cloned()
}

pub enum Kind {
    Network,
    User(String),
    Room(String),
}

pub fn start(
    state: &Shared,
    query: String,
    profile_id: Option<String>,
    kind: Kind,
) -> Result<String, String> {
    let client = state.client()?;
    let query = query.trim().to_string();
    if query.is_empty() {
        return Err("Type something to search for".into());
    }
    let wire = wire_query(&query, &state.settings().search_exclusions);
    let cancel = Arc::new(AtomicBool::new(false));
    match &kind {
        Kind::Network => {
            let (c, w, flag) = (client.clone(), wire.clone(), cancel.clone());
            thread::spawn(move || {
                let _ = c.search_with_cancel(&w, WINDOW, Some(flag));
            });
        }
        Kind::User(user) => client.search_user(user, &wire).map_err(err)?,
        Kind::Room(room) => client.search_room(room, &wire).map_err(err)?,
    }
    let _ = lock(&state.store).push_history(&query, now_ms());
    let id = {
        let mut searches = lock(&state.searches);
        let id = searches.next_id("s");
        searches.insert(
            id.clone(),
            SearchEntry {
                query,
                profile_id,
                results: vec![],
                done: false,
                cancel: cancel.clone(),
            },
        );
        id
    };
    let st = state.clone();
    let sid = id.clone();
    thread::spawn(move || run(&st, &client, &sid, &wire, &cancel));
    Ok(id)
}

fn run(state: &Shared, client: &Client, id: &str, wire: &str, cancel: &AtomicBool) {
    let started = Instant::now();
    let mut throttle = Throttle::new(Duration::from_millis(250));
    let mut seen = 0;
    loop {
        thread::sleep(Duration::from_millis(100));
        let finished = cancel.load(Ordering::Relaxed) || started.elapsed() >= WINDOW;
        let count = client.get_search_results_count(wire);
        if finished || (count != seen && throttle.ready(Instant::now())) {
            seen = count;
            let results: Vec<RawResult> = client
                .get_search_results(wire)
                .iter()
                .map(raw_result)
                .collect();
            if !publish(state, id, results, finished) {
                break;
            }
        }
        if finished {
            break;
        }
    }
    let _ = client.forget_search(wire);
}

/// Store results and emit the view. False when the search was dropped.
fn publish(state: &Shared, id: &str, results: Vec<RawResult>, done: bool) -> bool {
    let entry = {
        let mut searches = lock(&state.searches);
        let Some(entry) = searches.entries.get_mut(id) else {
            return false;
        };
        entry.results = results;
        entry.done = done;
        entry.clone()
    };
    let view = entry.view(id, &state.profile(entry.profile_id.as_deref()), false);
    let query = entry.query;
    if done {
        crate::extensions::dispatch(
            &state.app,
            ExtensionEvent {
                name: "search.completed".into(),
                payload: serde_json::json!({
                    "searchId": id,
                    "query": query,
                    "releases": view.releases.len(),
                }),
            },
        );
    }
    state.emit("search:update", view);
    true
}

pub fn cancel(state: &Shared, id: &str) {
    if let Some(e) = lock(&state.searches).entries.get(id) {
        e.cancel.store(true, Ordering::Relaxed);
    }
}

/// Run a search to the end on the calling thread and return what came back.
pub fn collect(state: &Shared, query: &str) -> Result<Vec<RawResult>, String> {
    let client = state.client()?;
    let wire = wire_query(query, &state.settings().search_exclusions);
    let results = client.search(&wire, WINDOW).map_err(err)?;
    let _ = client.forget_search(&wire);
    Ok(results.iter().map(raw_result).collect())
}

/// Keep finished results under a fresh id (wishlist runs), so the UI can open them.
pub fn store_finished(state: &Shared, query: &str, results: Vec<RawResult>) -> String {
    let mut searches = lock(&state.searches);
    let id = searches.next_id("w");
    searches.insert(
        id.clone(),
        SearchEntry {
            query: query.to_string(),
            profile_id: None,
            results,
            done: true,
            cancel: Arc::new(AtomicBool::new(false)),
        },
    );
    id
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use needle_core::model::Codec;

    use super::*;

    fn file(name: &str, attribs: &[(u32, u32)]) -> soulseek_rs::File {
        soulseek_rs::File {
            username: "kdj".into(),
            name: name.into(),
            size: 31_457_280,
            attribs: attribs.iter().copied().collect::<HashMap<_, _>>(),
        }
    }

    #[test]
    fn search_result_becomes_raw_result_with_attributes() {
        let result = SearchResult {
            token: 1,
            files: vec![
                file(
                    r"@@music\Artist\Album\01 Intro.flac",
                    &[(1, 245), (4, 96_000), (5, 24)],
                ),
                file(
                    r"@@music\Artist\Album\02 Song.mp3",
                    &[(0, 320), (1, 200), (2, 0)],
                ),
            ],
            slots: 0,
            speed: 1_200_000,
            username: "kdj".into(),
        };
        let raw = raw_result(&result);
        assert_eq!(raw.source.username, "kdj");
        assert!(!raw.source.free_slot);
        assert_eq!(raw.source.avg_speed, 1_200_000);
        assert_eq!(raw.source.queue_len, None);
        let flac = &raw.files[0];
        assert_eq!(flac.path, r"@@music\Artist\Album\01 Intro.flac");
        assert_eq!(flac.size, 31_457_280);
        assert_eq!(flac.codec, Codec::Flac);
        assert_eq!(
            (flac.sample_rate, flac.bit_depth, flac.duration_secs),
            (Some(96_000), Some(24), Some(245))
        );
        assert_eq!(flac.bitrate_kbps, None);
        let mp3 = &raw.files[1];
        assert_eq!((mp3.codec, mp3.bitrate_kbps), (Codec::Mp3, Some(320)));
    }

    #[test]
    fn free_slot_follows_slot_count_and_empty_answers_survive() {
        let result = SearchResult {
            token: 2,
            files: vec![],
            slots: 3,
            speed: 0,
            username: "x".into(),
        };
        let raw = raw_result(&result);
        assert!(raw.source.free_slot);
        assert!(raw.files.is_empty());
    }

    #[test]
    fn wire_query_appends_exclusions_once_with_a_minus() {
        assert_eq!(wire_query("  aphex twin ", &[]), "aphex twin");
        let ex = vec!["live".to_string(), "-remix".to_string(), "  ".to_string()];
        assert_eq!(wire_query("aphex twin", &ex), "aphex twin -live -remix");
    }

    #[test]
    fn keeps_only_the_last_20_searches_and_cancels_evicted_ones() {
        let mut s = Searches::default();
        let mut first_cancel = None;
        for i in 0..21 {
            let cancel = Arc::new(AtomicBool::new(false));
            if i == 0 {
                first_cancel = Some(cancel.clone());
            }
            let id = s.next_id("s");
            s.insert(
                id,
                SearchEntry {
                    query: format!("q{i}"),
                    profile_id: None,
                    results: vec![],
                    done: false,
                    cancel,
                },
            );
        }
        assert_eq!(s.entries.len(), 20);
        assert!(first_cancel.unwrap().load(Ordering::Relaxed));
        assert_eq!(s.last().unwrap().query, "q20");
    }
}
