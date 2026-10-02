//! The download job: one release, its fallback sources, and the state machine
//! that switches source when a transfer stalls or a file fails verification.
//! Pure: the backend feeds events in and performs the actions that come out.

use crate::model::{JobAction, JobEvent, JobView, QualityProfile, Release};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Job {
    // engine agent: fields
}

impl Job {
    /// `files`: names (without folder) to fetch; `None` means the whole release.
    #[must_use]
    pub fn new(
        _id: String,
        _release: &Release,
        _files: Option<Vec<String>>,
        _profile: &QualityProfile,
        _output_dir: String,
        _now_ms: u64,
    ) -> Self {
        todo!("engine agent")
    }

    pub fn handle(&mut self, _event: JobEvent, _now_ms: u64) -> Vec<JobAction> {
        todo!("engine agent")
    }

    #[must_use]
    pub fn view(&self, _now_ms: u64) -> JobView {
        todo!("engine agent")
    }
}
