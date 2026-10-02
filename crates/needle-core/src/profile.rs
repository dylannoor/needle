//! Quality profiles: which files count as good enough, best tier first.

use crate::model::{FileInfo, QualityProfile, Tier};

impl Tier {
    /// Whether one file satisfies this tier.
    #[must_use]
    pub fn matches(&self, _file: &FileInfo) -> bool {
        todo!("engine agent")
    }
}

impl QualityProfile {
    /// The best tier every audio file in `files` satisfies, if any.
    #[must_use]
    pub fn tier_of(&self, _files: &[FileInfo]) -> Option<usize> {
        todo!("engine agent")
    }

    /// The built-in "Lossless first" profile.
    #[must_use]
    pub fn lossless_first() -> Self {
        todo!("engine agent")
    }
}
