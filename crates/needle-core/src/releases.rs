//! Turns thousands of raw search hits into a short list of releases.

use crate::model::{QualityProfile, RawResult, SearchView};

/// Group `results` into releases, rank them against `profile`, and count what
/// was hidden. `include_hidden` also returns releases that failed the profile.
#[must_use]
pub fn build_view(
    _search_id: &str,
    _query: &str,
    _results: &[RawResult],
    _profile: &QualityProfile,
    _include_hidden: bool,
) -> SearchView {
    todo!("engine agent")
}
