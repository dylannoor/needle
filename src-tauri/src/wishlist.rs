//! Wishlist: every wish is searched on the server's wishlist interval, and a
//! wish that matches a release it did not match before raises `wishlist:hit`.

use std::thread;
use std::time::{Duration, Instant};

use needle_core::api::WishItem;
use needle_core::model::RawResult;
use needle_core::releases::build_view;

use crate::search::{WINDOW, raw_result, store_finished, wire_query};
use crate::state::{Shared, err, lock, now_ms};

const FIRST_RUN: Duration = Duration::from_secs(30);

pub fn list(state: &Shared) -> Result<Vec<WishItem>, String> {
    lock(&state.store).wishlist().map_err(err)
}

pub fn add(state: &Shared, query: &str) -> Result<Vec<WishItem>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("Type what you are looking for".into());
    }
    lock(&state.store).add_wish(query, now_ms()).map_err(err)?;
    list(state)
}

pub fn remove(state: &Shared, query: &str) -> Result<Vec<WishItem>, String> {
    lock(&state.store).remove_wish(query).map_err(err)?;
    list(state)
}

/// Whether `now` holds a release id that `before` did not.
pub fn has_new(before: &[String], now: &[String]) -> bool {
    now.iter().any(|id| !before.contains(id))
}

pub fn run(state: &Shared, generation: u64) {
    let mut next = Instant::now() + FIRST_RUN;
    while crate::session::alive(state, generation) {
        thread::sleep(Duration::from_secs(1));
        if Instant::now() < next {
            continue;
        }
        run_once(state);
        next = Instant::now() + state.client().map_or(FIRST_RUN, |c| c.wishlist_interval());
    }
}

fn run_once(state: &Shared) {
    let (Ok(client), Ok(wishes)) = (state.client(), list(state)) else {
        return;
    };
    if wishes.is_empty() {
        return;
    }
    let exclusions = state.settings().search_exclusions;
    let wires: Vec<String> = wishes
        .iter()
        .map(|w| wire_query(&w.query, &exclusions))
        .collect();
    for wire in &wires {
        let _ = client.start_wishlist_search(wire);
    }
    thread::sleep(WINDOW);
    let profile = state.profile(None);
    let settings = state.settings();
    for (mut wish, wire) in wishes.into_iter().zip(wires) {
        let results: Vec<RawResult> = client
            .get_search_results(&wire)
            .iter()
            .map(raw_result)
            .collect();
        let _ = client.forget_search(&wire);
        let view = build_view("wishlist", &wish.query, &results, &profile, false);
        let ids: Vec<String> = view.releases.iter().map(|r| r.id.clone()).collect();
        let before = lock(&state.store).wish_seen(&wish.query);
        wish.last_run_ms = Some(now_ms());
        wish.matches = ids.len() as u32;
        wish.search_id = Some(store_finished(state, &wish.query, results));
        let _ = lock(&state.store).record_wish_run(&wish, &ids);
        if has_new(&before, &ids) {
            if settings.notify_wishlist_hits {
                state.notify("Found on your wishlist", &wish.query);
            }
            state.emit("wishlist:hit", wish);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn a_hit_needs_a_release_that_was_not_there_before() {
        assert!(!has_new(&ids(&[]), &ids(&[])));
        assert!(has_new(&ids(&[]), &ids(&["a"])));
        assert!(!has_new(&ids(&["a", "b"]), &ids(&["b"])));
        assert!(!has_new(&ids(&["a", "b"]), &ids(&["a", "b"])));
        assert!(has_new(&ids(&["a", "b"]), &ids(&["b", "c"])));
    }
}
