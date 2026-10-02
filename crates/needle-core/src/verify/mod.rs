//! Checks that a downloaded file is what it claims to be: header first, then
//! the spectrum, so a transcode saved as FLAC gets caught.

use std::path::Path;

use crate::model::{Strictness, Tier, Verdict};

#[derive(Debug, thiserror::Error)]
pub enum VerifyError {
    #[error("could not open {0}: {1}")]
    Open(String, String),
    #[error("could not decode: {0}")]
    Decode(String),
}

/// Inspect `path` against the tier it was downloaded for.
pub fn verify_file(_path: &Path, _tier: &Tier, _strictness: Strictness) -> Result<Verdict, VerifyError> {
    todo!("verify agent")
}
