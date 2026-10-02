//! Turns thousands of raw search hits into a short list of releases.

use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};

use crate::model::{
    Candidate, Codec, FileInfo, HiddenCounts, QualityProfile, RawResult, Release, SearchView,
    Source,
};

/// Group `results` into releases, rank them against `profile`, and count what
/// was hidden. `include_hidden` also returns releases that failed the profile.
/// `done` is always false: the backend knows when the search is over.
#[must_use]
pub fn build_view(
    search_id: &str,
    query: &str,
    results: &[RawResult],
    profile: &QualityProfile,
    include_hidden: bool,
) -> SearchView {
    let (candidates, total_peers) = group_candidates(results);
    let total_files = candidates.iter().map(|c| c.files.len()).sum();

    let mut hidden = HiddenCounts::default();
    let mut shown = Vec::new();
    let mut held_back = Vec::new();
    let mut expected: HashMap<String, usize> = HashMap::new();
    for c in candidates {
        let audio = c.files.iter().filter(|f| f.is_audio()).count();
        let parsed = parse_folder(&c.folder);
        if audio > 0 {
            let max = expected.entry(parsed.key()).or_default();
            *max = (*max).max(audio);
        }
        let tier = if audio == 0 {
            None
        } else {
            profile.tier_of(&c.files)
        };
        let queue = c.source.queue_len.filter(|q| *q > profile.max_queue);
        let reason = if audio == 0 {
            hidden.not_audio += c.files.len();
            Some("Only artwork and text files".to_string())
        } else if tier.is_none() {
            hidden.below_profile += c.files.len();
            Some(match profile.tiers.last() {
                Some(t) => format!(
                    "{} is below your lowest tier ({})",
                    format_label(&c.files),
                    t.label
                ),
                None => format!("{} is not in your profile", format_label(&c.files)),
            })
        } else if let Some(q) = queue {
            hidden.queue_too_long += c.files.len();
            Some(format!("Queue of {q}, your limit is {}", profile.max_queue))
        } else {
            None
        };
        let scored = Scored {
            sig: signature(&c.files),
            tier: tier.unwrap_or(profile.tiers.len()),
            audio,
            parsed,
            reason,
            c,
        };
        if scored.reason.is_none() {
            shown.push(scored);
        } else if include_hidden {
            held_back.push(scored);
        }
    }

    SearchView {
        search_id: search_id.into(),
        query: query.into(),
        releases: into_releases(shown, profile, &expected),
        hidden_releases: into_releases(held_back, profile, &expected),
        hidden,
        total_files,
        total_peers,
        done: false,
    }
}

struct Scored {
    c: Candidate,
    reason: Option<String>,
    tier: usize,
    audio: usize,
    parsed: Parsed,
    sig: u64,
}

/// One candidate per (user, folder), with disc subfolders folded into their
/// release folder and duplicate paths dropped. Returns the peer count too.
fn group_candidates(results: &[RawResult]) -> (Vec<Candidate>, usize) {
    let mut latest: HashMap<&str, &Source> = HashMap::new();
    let mut index: HashMap<(&str, &str), usize> = HashMap::new();
    let mut seen: HashSet<(&str, &str)> = HashSet::new();
    let mut out: Vec<Candidate> = Vec::new();
    for r in results {
        let user = r.source.username.as_str();
        latest.insert(user, &r.source);
        for f in &r.files {
            if !seen.insert((user, &f.path)) {
                continue;
            }
            let folder = release_folder(f.folder());
            let i = *index.entry((user, folder)).or_insert_with(|| {
                out.push(Candidate {
                    id: format!("{:016x}", hash(&(user, folder))),
                    source: r.source.clone(),
                    folder: folder.into(),
                    files: Vec::new(),
                    total_size: 0,
                });
                out.len() - 1
            });
            out[i].total_size += f.size;
            out[i].files.push(f.clone());
        }
    }
    for c in &mut out {
        c.source = latest[c.source.username.as_str()].clone();
    }
    (out, latest.len())
}

/// Copies with the same audio files (name and size) become one release.
fn into_releases(
    cands: Vec<Scored>,
    profile: &QualityProfile,
    expected: &HashMap<String, usize>,
) -> Vec<Release> {
    let mut index: HashMap<u64, usize> = HashMap::new();
    let mut groups: Vec<Vec<Scored>> = Vec::new();
    for s in cands {
        let i = *index.entry(s.sig).or_insert_with(|| {
            groups.push(Vec::new());
            groups.len() - 1
        });
        groups[i].push(s);
    }

    let tiers = profile.tiers.len();
    let mut releases: Vec<Release> = groups
        .into_iter()
        .map(|mut copies| {
            // Copies share their file set, so completeness cannot tell them apart.
            copies.sort_by(|a, b| {
                score(b.tier, tiers, 0.0, &b.c.source)
                    .total_cmp(&score(a.tier, tiers, 0.0, &a.c.source))
                    .then_with(|| a.c.id.cmp(&b.c.id))
            });
            let mut copies = copies.into_iter();
            let best = copies.next().expect("groups are never empty");
            let expected_tracks = expected
                .get(&best.parsed.key())
                .copied()
                .unwrap_or(0)
                .max(best.audio);
            let complete = if profile.prefer_complete && expected_tracks > 0 {
                best.audio as f64 / expected_tracks as f64
            } else {
                0.0
            };
            Release {
                id: format!("{:016x}", best.sig),
                title: best.parsed.title,
                artist: best.parsed.artist,
                year: best.parsed.year,
                format_label: format_label(&best.c.files),
                tier: best.tier,
                track_count: best.audio,
                expected_tracks,
                score: score(best.tier, tiers, complete, &best.c.source),
                hidden_reason: best.reason,
                best: best.c,
                alternates: copies.map(|s| s.c).collect(),
            }
        })
        .collect();
    releases.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.id.cmp(&b.id)));
    releases
}

/// Higher is better. Each criterion gets its own band of digits so it only
/// breaks ties left by the ones before it: tier, completeness, free slot,
/// queue length, speed.
fn score(tier: usize, tiers: usize, complete: f64, s: &Source) -> f64 {
    let tier = tiers.saturating_sub(tier) as f64 * 1e9;
    let complete = (complete * 100.0).round() * 1e6;
    let slot = if s.free_slot { 1e5 } else { 0.0 };
    let queue = f64::from(99 - s.queue_len.unwrap_or(0).min(99)) * 1e3;
    let speed = f64::from((s.avg_speed / 1024).min(999));
    tier + complete + slot + queue + speed
}

/// Stable across runs and machines, unlike `DefaultHasher`'s guarantees.
struct Fnv(u64);

impl Hasher for Fnv {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for b in bytes {
            self.0 = (self.0 ^ u64::from(*b)).wrapping_mul(0x100_0000_01b3);
        }
    }
}

fn hash(value: &impl Hash) -> u64 {
    let mut h = Fnv(0xcbf2_9ce4_8422_2325);
    value.hash(&mut h);
    h.finish()
}

/// The audio files as a set of (lowercase name, size), hashed.
fn signature(files: &[FileInfo]) -> u64 {
    let mut set: Vec<(String, u64)> = files
        .iter()
        .filter(|f| f.is_audio())
        .map(|f| (f.name().to_lowercase(), f.size))
        .collect();
    set.sort_unstable();
    hash(&set)
}

/// `Album\CD1` belongs to `Album`.
fn release_folder(folder: &str) -> &str {
    match folder.rfind(['\\', '/']) {
        Some(i) if is_disc_folder(&folder[i + 1..]) => &folder[..i],
        _ => folder,
    }
}

fn is_disc_folder(name: &str) -> bool {
    let name = name.trim().to_ascii_lowercase();
    ["cd", "disc", "disk"]
        .iter()
        .filter_map(|p| name.strip_prefix(p))
        .any(|rest| {
            rest.trim_start_matches([' ', '_', '.', '-'])
                .starts_with(|c: char| c.is_ascii_digit())
        })
}

// ---------------------------------------------------------------------------
// Folder names
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq)]
struct Parsed {
    artist: Option<String>,
    title: String,
    year: Option<u16>,
}

impl Parsed {
    /// Groups spellings of the same release for `expected_tracks`.
    fn key(&self) -> String {
        let norm = |s: &str| {
            s.chars()
                .filter(|c| c.is_alphanumeric())
                .flat_map(char::to_lowercase)
                .collect::<String>()
        };
        format!(
            "{}\n{}",
            norm(self.artist.as_deref().unwrap_or("")),
            norm(&self.title)
        )
    }
}

/// `Music\Daft Punk\1997 - Homework [FLAC]` → Daft Punk, Homework, 1997.
fn parse_folder(folder: &str) -> Parsed {
    let mut parts = folder.rsplit(['\\', '/']).filter(|p| !p.is_empty());
    let name = parts.next().unwrap_or(folder);
    let parent = parts.next();

    let mut year = None;
    let stripped = strip_brackets(&name.replace('_', " "), &mut year);
    let stripped = strip_leading_year(&stripped, &mut year);
    let (artist, title) = match stripped.split_once(" - ") {
        Some((a, t)) => (Some(tidy(a)), t),
        None => (None, stripped),
    };
    let title = strip_trailing_tags(strip_leading_year(title, &mut year));
    let title = if title.is_empty() { tidy(name) } else { title };
    let artist = artist
        .filter(|a| !a.is_empty())
        .or_else(|| parent.filter(|p| is_artist_folder(p)).map(tidy));
    Parsed {
        artist,
        title,
        year,
    }
}

fn tidy(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(['-', '.', ' '])
        .to_string()
}

fn as_year(s: &str) -> Option<u16> {
    if s.len() != 4 || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok().filter(|y| (1900..2100).contains(y))
}

/// Drops `[FLAC]`, `(24-96)`, `(2LP)` and `(1997)` (keeping the year), but
/// keeps groups that are part of the title, like `(Deluxe Edition)`.
fn strip_brackets(s: &str, year: &mut Option<u16>) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(open) = rest.find(['[', '(', '{']) {
        let close = match rest.as_bytes()[open] {
            b'[' => ']',
            b'(' => ')',
            _ => '}',
        };
        let Some(len) = rest[open + 1..].find(close) else {
            break;
        };
        let inner = &rest[open + 1..open + 1 + len];
        out.push_str(&rest[..open]);
        let tokens: Vec<&str> = inner
            .split([' ', '-', ',', '/', '+', ';'])
            .filter(|t| !t.is_empty())
            .collect();
        if !tokens.is_empty()
            && tokens
                .iter()
                .all(|t| as_year(t).is_some() || is_tag(t, true))
        {
            if let Some(y) = tokens.iter().find_map(|t| as_year(t)) {
                year.get_or_insert(y);
            }
        } else {
            out.push_str(&rest[open..=open + 1 + len]);
        }
        rest = &rest[open + 2 + len..];
    }
    out.push_str(rest);
    tidy(&out)
}

/// `1997 - Homework` → `Homework`, unless the year is the whole title.
fn strip_leading_year<'a>(s: &'a str, year: &mut Option<u16>) -> &'a str {
    let s = s.trim();
    let Some(y) = s.get(..4).and_then(as_year) else {
        return s;
    };
    if s[4..].starts_with(|c: char| c.is_alphanumeric()) {
        return s;
    }
    let rest = s[4..].trim_start_matches([' ', '-', '.', '_']);
    if rest.is_empty() {
        return s;
    }
    year.get_or_insert(y);
    rest
}

/// `Homework 24-96 FLAC` → `Homework`. Never strips the title to nothing.
/// A bare trailing year stays: it is too often part of the title ("Alive 2007").
fn strip_trailing_tags(s: &str) -> String {
    let mut words: Vec<&str> = s.split_whitespace().collect();
    while words.len() > 1 {
        let tokens: Vec<&str> = words[words.len() - 1]
            .split(['-', ',', '/'])
            .filter(|t| !t.is_empty())
            .collect();
        if !(tokens.is_empty() || tokens.iter().all(|t| is_tag(t, tokens.len() > 1))) {
            break;
        }
        words.pop();
    }
    tidy(&words.join(" "))
}

const TAG_WORDS: &[&str] = &[
    "flac", "mp3", "aac", "alac", "ogg", "opus", "wav", "aiff", "web", "webrip", "dl", "cd",
    "cdrip", "cdq", "vinyl", "lp", "ep", "lossless", "hi", "res", "hires", "hd", "bit", "khz", "k",
    "kbps", "cbr", "vbr", "v0", "v1", "v2", "16bit", "24bit",
];

/// A format tag: a known word, optionally after a number (`24bit`, `2LP`), or
/// a bare number when `numbers` is set (inside brackets, or `24-96`).
fn is_tag(token: &str, numbers: bool) -> bool {
    let t = token.to_ascii_lowercase();
    if t.bytes().all(|b| b.is_ascii_digit() || b == b'.') {
        return numbers || matches!(t.as_str(), "320" | "256" | "192");
    }
    let word = t.trim_start_matches(|c: char| c.is_ascii_digit() || c == '.');
    TAG_WORDS.contains(&word)
}

const CONTAINER_FOLDERS: &[&str] = &[
    "music",
    "my music",
    "albums",
    "album",
    "mp3",
    "flac",
    "downloads",
    "download",
    "complete",
    "completed",
    "shared",
    "share",
    "soulseek",
    "slsk",
    "vinyl",
    "lossless",
    "rips",
    "new",
    "misc",
    "various",
    "va",
    "incoming",
    "media",
    "audio",
];

/// Whether a parent folder name is likely an artist and not `Music` or `D:`.
fn is_artist_folder(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    !(lower.is_empty()
        || lower.starts_with("@@")
        || lower.ends_with(':')
        || as_year(&lower).is_some()
        || CONTAINER_FOLDERS.contains(&lower.as_str())
        || lower
            .split([' ', '-'])
            .filter(|t| !t.is_empty())
            .all(|t| is_tag(t, true)))
}

// ---------------------------------------------------------------------------
// Format label
// ---------------------------------------------------------------------------

/// "FLAC 16/44.1", "FLAC 24/96", "MP3 320", "MP3 V0" from the most common
/// attributes of the audio files.
fn format_label(files: &[FileInfo]) -> String {
    let audio: Vec<&FileInfo> = files.iter().filter(|f| f.is_audio()).collect();
    let Some(codec) = majority(audio.iter().map(|f| f.codec)) else {
        return Codec::Other.label().into();
    };
    let same: Vec<&FileInfo> = audio.into_iter().filter(|f| f.codec == codec).collect();
    let label = codec.label();
    if codec.is_lossless() {
        return match majority(same.iter().map(|f| (f.bit_depth, f.sample_rate))) {
            Some((Some(depth), Some(rate))) => format!("{label} {depth}/{}", khz(rate)),
            Some((Some(depth), None)) => format!("{label} {depth}-bit"),
            _ => label.into(),
        };
    }
    if majority(same.iter().map(|f| f.vbr == Some(true))) == Some(true) {
        let rates: Vec<u32> = same
            .iter()
            .filter(|f| f.vbr == Some(true))
            .filter_map(|f| f.bitrate_kbps)
            .collect();
        let avg = if rates.is_empty() {
            0
        } else {
            rates.iter().sum::<u32>() / rates.len() as u32
        };
        return match (codec, avg) {
            (Codec::Mp3, 220..) => "MP3 V0".into(),
            (Codec::Mp3, 170..) => "MP3 V2".into(),
            _ => format!("{label} VBR"),
        };
    }
    match majority(same.iter().map(|f| f.bitrate_kbps)) {
        Some(Some(kbps)) => format!("{label} {kbps}"),
        _ => label.into(),
    }
}

fn khz(rate: u32) -> String {
    if rate.is_multiple_of(1000) {
        (rate / 1000).to_string()
    } else {
        format!("{:.1}", f64::from(rate) / 1000.0)
    }
}

/// Most common value; the first seen wins a tie.
fn majority<T: PartialEq + Copy>(values: impl Iterator<Item = T>) -> Option<T> {
    let mut counts: Vec<(T, usize)> = Vec::new();
    for v in values {
        match counts.iter_mut().find(|(c, _)| *c == v) {
            Some((_, n)) => *n += 1,
            None => counts.push((v, 1)),
        }
    }
    let mut best: Option<(T, usize)> = None;
    for (v, n) in counts {
        if best.is_none_or(|(_, b)| n > b) {
            best = Some((v, n));
        }
    }
    best.map(|(v, _)| v)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src(user: &str) -> Source {
        Source {
            username: user.into(),
            free_slot: true,
            avg_speed: 1_000_000,
            queue_len: Some(0),
        }
    }

    fn flac(path: &str, size: u64) -> FileInfo {
        FileInfo::from_attributes(path.into(), size, &[(4, 44_100), (5, 16)])
    }

    fn mp3(path: &str, size: u64, kbps: u32, vbr: bool) -> FileInfo {
        FileInfo::from_attributes(
            path.into(),
            size,
            &[(0, kbps), (2, u32::from(vbr)), (4, 44_100)],
        )
    }

    fn other(path: &str) -> FileInfo {
        FileInfo::from_attributes(path.into(), 50_000, &[])
    }

    /// Homework as `folder\NN.flac` with `n` tracks of predictable sizes.
    fn homework(folder: &str, n: u64) -> Vec<FileInfo> {
        (1..=n)
            .map(|i| flac(&format!("{folder}\\{i:02}.flac"), 30_000_000 + i))
            .collect()
    }

    fn result(source: Source, files: Vec<FileInfo>) -> RawResult {
        RawResult { source, files }
    }

    fn view(results: &[RawResult]) -> SearchView {
        build_view(
            "s1",
            "daft punk homework",
            results,
            &QualityProfile::lossless_first(),
            false,
        )
    }

    #[test]
    fn parses_common_folder_layouts() {
        let cases = [
            (
                r"Music\Daft Punk\1997 - Homework [FLAC]",
                Some("Daft Punk"),
                "Homework",
                Some(1997),
            ),
            (
                r"@@shares\Daft Punk - Homework (1997) [FLAC 16-44]",
                Some("Daft Punk"),
                "Homework",
                Some(1997),
            ),
            (
                r"Albums\Daft Punk\Homework",
                Some("Daft Punk"),
                "Homework",
                None,
            ),
            (
                r"vinyl\DP - Homework (2LP) 24-96",
                Some("DP"),
                "Homework",
                None,
            ),
            (r"Music\Homework", None, "Homework", None),
            (
                r"D:\Daft_Punk-stuff\Daft_Punk - Homework_(WEB)",
                Some("Daft Punk"),
                "Homework",
                None,
            ),
            (
                r"Prince\Prince - 1999 (1982)",
                Some("Prince"),
                "1999",
                Some(1982),
            ),
            (
                r"Music\Daft Punk\Homework (Deluxe Edition) [FLAC]",
                Some("Daft Punk"),
                "Homework (Deluxe Edition)",
                None,
            ),
            ("Homework WEB FLAC", None, "Homework", None),
            (
                r"Daft Punk\\Alive 2007",
                Some("Daft Punk"),
                "Alive 2007",
                None,
            ),
        ];
        for (folder, artist, title, year) in cases {
            let p = parse_folder(folder);
            assert_eq!(
                p,
                Parsed {
                    artist: artist.map(String::from),
                    title: title.into(),
                    year
                },
                "parsing {folder}"
            );
        }
    }

    #[test]
    fn identical_copies_become_one_release_with_ranked_alternates() {
        let folder = r"Music\Daft Punk\1997 - Homework [FLAC]";
        let slow = Source {
            avg_speed: 50_000,
            ..src("vinyl_haus")
        };
        let busy = Source {
            free_slot: false,
            ..src("hood_fan")
        };
        let results = vec![
            result(slow, homework(folder, 16)),
            result(busy, homework(r"Albums\Homework", 16)),
            result(src("deepcrates"), homework(folder, 16)),
        ];
        let v = view(&results);
        assert_eq!(v.releases.len(), 1);
        let r = &v.releases[0];
        assert_eq!(r.best.source.username, "deepcrates");
        let alts: Vec<&str> = r
            .alternates
            .iter()
            .map(|c| c.source.username.as_str())
            .collect();
        assert_eq!(alts, ["vinyl_haus", "hood_fan"]);
        assert_eq!(
            (r.title.as_str(), r.artist.as_deref(), r.year),
            ("Homework", Some("Daft Punk"), Some(1997))
        );
        assert_eq!(r.format_label, "FLAC 16/44.1");
        assert_eq!(r.tier, 1);
        assert_eq!((r.track_count, r.expected_tracks), (16, 16));
        assert_eq!(v.total_files, 48);
        assert_eq!(v.total_peers, 3);
    }

    #[test]
    fn release_id_survives_more_results_arriving() {
        let folder = r"Music\Daft Punk\Homework";
        let first = view(&[result(
            Source {
                avg_speed: 10,
                ..src("vinyl_haus")
            },
            homework(folder, 16),
        )]);
        let later = view(&[
            result(
                Source {
                    avg_speed: 10,
                    ..src("vinyl_haus")
                },
                homework(folder, 16),
            ),
            result(src("deepcrates"), homework(folder, 16)),
        ]);
        assert_eq!(first.releases[0].id, later.releases[0].id);
        assert_eq!(later.releases[0].best.source.username, "deepcrates");
    }

    #[test]
    fn candidate_ids_are_stable_per_user_and_folder() {
        let a = view(&[result(src("deepcrates"), homework("Homework", 3))]);
        let b = view(&[result(src("deepcrates"), homework("Homework", 3))]);
        assert_eq!(a.releases[0].best.id, b.releases[0].best.id);
        let c = view(&[result(src("vinyl_haus"), homework("Homework", 3))]);
        assert_ne!(a.releases[0].best.id, c.releases[0].best.id);
    }

    #[test]
    fn better_tier_beats_free_slot_and_speed() {
        let hires: Vec<FileInfo> = (1..=3)
            .map(|i| {
                FileInfo::from_attributes(
                    format!(r"Homework 24-96\{i:02}.flac"),
                    90_000_000 + i,
                    &[(4, 96_000), (5, 24)],
                )
            })
            .collect();
        let v = view(&[
            result(src("deepcrates"), homework("Homework", 3)),
            result(
                Source {
                    free_slot: false,
                    avg_speed: 1000,
                    queue_len: Some(20),
                    ..src("kdj_archive")
                },
                hires,
            ),
        ]);
        assert_eq!(v.releases[0].best.source.username, "kdj_archive");
        assert_eq!(v.releases[0].format_label, "FLAC 24/96");
        assert_eq!(v.releases[0].tier, 0);
    }

    #[test]
    fn complete_copies_rank_above_incomplete_ones_and_report_expected_tracks() {
        let v = view(&[
            result(src("deepcrates"), homework(r"Daft Punk\Homework", 12)),
            result(
                Source {
                    free_slot: false,
                    avg_speed: 1000,
                    ..src("vinyl_haus")
                },
                homework(r"Daft Punk - Homework", 16),
            ),
        ]);
        assert_eq!(v.releases.len(), 2);
        assert_eq!(v.releases[0].best.source.username, "vinyl_haus");
        assert_eq!(v.releases[1].track_count, 12);
        assert_eq!(v.releases[1].expected_tracks, 16);
    }

    #[test]
    fn free_slot_then_shorter_queue_then_speed() {
        let v = view(&[
            result(
                Source {
                    queue_len: Some(9),
                    ..src("hood_fan")
                },
                homework("A", 2),
            ),
            result(
                Source {
                    queue_len: Some(2),
                    avg_speed: 10,
                    ..src("soul_sounds")
                },
                homework("A", 2),
            ),
            result(
                Source {
                    free_slot: false,
                    queue_len: Some(0),
                    ..src("kdj_archive")
                },
                homework("A", 2),
            ),
            result(
                Source {
                    queue_len: Some(2),
                    avg_speed: 900_000,
                    ..src("deepcrates")
                },
                homework("A", 2),
            ),
        ]);
        let order: Vec<&str> = std::iter::once(&v.releases[0].best)
            .chain(&v.releases[0].alternates)
            .map(|c| c.source.username.as_str())
            .collect();
        assert_eq!(
            order,
            ["deepcrates", "soul_sounds", "hood_fan", "kdj_archive"]
        );
    }

    #[test]
    fn disc_folders_belong_to_their_release() {
        let mut files = vec![
            flac(r"Music\Daft Punk - Alive 2007\CD1\01.flac", 1),
            flac(r"Music\Daft Punk - Alive 2007\CD1\02.flac", 2),
            flac(r"Music\Daft Punk - Alive 2007\Disc 2\01.flac", 3),
        ];
        files.push(other(r"Music\Daft Punk - Alive 2007\cover.jpg"));
        let v = view(&[result(src("deepcrates"), files)]);
        assert_eq!(v.releases.len(), 1);
        let r = &v.releases[0];
        assert_eq!(r.best.folder, r"Music\Daft Punk - Alive 2007");
        assert_eq!(r.track_count, 3);
        assert_eq!(r.best.files.len(), 4);
        assert_eq!(r.title, "Alive 2007");
    }

    #[test]
    fn hidden_files_are_counted_by_reason() {
        let lossy: Vec<FileInfo> = (1..=4)
            .map(|i| mp3(&format!(r"Homework 128\{i}.mp3"), i, 128, false))
            .collect();
        let art = vec![other(r"Scans\front.jpg"), other(r"Scans\back.jpg")];
        let v = view(&[
            result(src("deepcrates"), homework("Homework", 3)),
            result(src("hood_fan"), lossy),
            result(src("vinyl_haus"), art),
            result(
                Source {
                    queue_len: Some(51),
                    ..src("kdj_archive")
                },
                homework("Homework", 5),
            ),
            result(
                Source {
                    queue_len: Some(50),
                    ..src("soul_sounds")
                },
                homework("Homework", 3),
            ),
        ]);
        assert_eq!(
            v.hidden,
            HiddenCounts {
                below_profile: 4,
                queue_too_long: 5,
                not_audio: 2
            }
        );
        assert_eq!(v.releases.len(), 1);
        assert_eq!(
            v.releases[0].alternates.len(),
            1,
            "a queue of exactly max_queue is fine"
        );
        assert!(v.hidden_releases.is_empty());
        let shown: usize = v
            .releases
            .iter()
            .flat_map(|r| std::iter::once(&r.best).chain(&r.alternates))
            .map(|c| c.files.len())
            .sum();
        assert_eq!(shown + 4 + 5 + 2, v.total_files);
    }

    #[test]
    fn hidden_releases_are_returned_on_request() {
        let lossy: Vec<FileInfo> = (1..=4)
            .map(|i| mp3(&format!(r"Homework 128\{i}.mp3"), i, 128, false))
            .collect();
        let v = build_view(
            "s1",
            "q",
            &[result(src("hood_fan"), lossy)],
            &QualityProfile::lossless_first(),
            true,
        );
        assert!(v.releases.is_empty());
        assert_eq!(v.hidden_releases.len(), 1);
        assert_eq!(v.hidden_releases[0].tier, 3);
        assert_eq!(v.hidden_releases[0].format_label, "MP3 128");
    }

    #[test]
    fn hidden_releases_say_why_in_plain_english() {
        let profile = QualityProfile::lossless_first();
        let mp3_192: Vec<FileInfo> = (1..=3)
            .map(|i| mp3(&format!(r"Low\{i}.mp3"), 100 + i, 192, false))
            .collect();
        let queued = Source {
            queue_len: Some(120),
            ..src("busy")
        };
        let art = vec![other(r"Scans\front.jpg"), other(r"Scans\info.txt")];
        let v = build_view(
            "s1",
            "q",
            &[
                result(src("low"), mp3_192),
                result(queued, homework("Queued", 3)),
                result(src("scans"), art),
                result(src("good"), homework("Good", 3)),
            ],
            &profile,
            true,
        );
        assert_eq!(v.releases.len(), 1);
        assert_eq!(v.releases[0].hidden_reason, None);
        let mut reasons: Vec<String> = v
            .hidden_releases
            .iter()
            .filter_map(|r| r.hidden_reason.clone())
            .collect();
        reasons.sort();
        assert_eq!(
            reasons,
            vec![
                "MP3 192 is below your lowest tier (MP3 320 kbps)",
                "Only artwork and text files",
                "Queue of 120, your limit is 50",
            ]
        );
        assert_eq!(v.hidden_releases.len(), 3);
        assert_eq!(v.hidden.not_audio, 2);
        assert_eq!(v.hidden.queue_too_long, 3);
        assert_eq!(v.hidden.below_profile, 3);
    }

    #[test]
    fn mp3_labels() {
        let v0: Vec<FileInfo> = [245, 260, 230]
            .iter()
            .enumerate()
            .map(|(i, k)| mp3(&format!("V0\\{i}.mp3"), 1, *k, true))
            .collect();
        assert_eq!(format_label(&v0), "MP3 V0");
        let v2: Vec<FileInfo> = [190, 180]
            .iter()
            .enumerate()
            .map(|(i, k)| mp3(&format!("V2\\{i}.mp3"), 1, *k, true))
            .collect();
        assert_eq!(format_label(&v2), "MP3 V2");
        let cbr = vec![
            mp3("a\\1.mp3", 1, 320, false),
            mp3("a\\2.mp3", 1, 320, false),
            mp3("a\\3.mp3", 1, 256, false),
        ];
        assert_eq!(format_label(&cbr), "MP3 320");
        assert_eq!(
            format_label(&[FileInfo::from_attributes("a\\1.flac".into(), 1, &[])]),
            "FLAC"
        );
    }

    #[test]
    fn duplicate_hits_are_not_counted_twice() {
        let files = homework("Homework", 3);
        let v = view(&[
            result(src("deepcrates"), files.clone()),
            result(src("deepcrates"), files),
        ]);
        assert_eq!(v.total_files, 3);
        assert_eq!(v.releases[0].track_count, 3);
        assert_eq!(v.total_peers, 1);
    }

    #[test]
    fn empty_input() {
        let v = view(&[]);
        assert!(v.releases.is_empty());
        assert_eq!((v.total_files, v.total_peers), (0, 0));
        assert_eq!(v.search_id, "s1");
    }

    #[test]
    fn fifty_thousand_files_group_quickly() {
        // 200 peers with 25 folders of 10 files each; every album exists at two peers.
        let results: Vec<RawResult> = (0..200)
            .map(|u| {
                let files = (0..25)
                    .flat_map(|k| {
                        let album = (u * 25 + k) % 2_500;
                        (0..10).map(move |t| {
                            flac(
                                &format!(r"Music\Artist {album}\Album {album} [FLAC]\{t:02}.flac"),
                                1000 * album + t,
                            )
                        })
                    })
                    .collect();
                result(src(&format!("peer{u}")), files)
            })
            .collect();
        let start = std::time::Instant::now();
        let v = view(&results);
        let took = start.elapsed();
        assert_eq!(v.total_files, 50_000);
        assert_eq!(v.releases.len(), 2_500);
        assert!(v.releases.iter().all(|r| r.alternates.len() == 1));
        assert!(took < std::time::Duration::from_secs(3), "took {took:?}");
    }
}
