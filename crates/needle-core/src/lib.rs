//! Needle's engine: everything that decides, as opposed to everything that
//! talks to the network or the UI. No Tauri, no sockets, so it tests fast.

pub mod api;
pub mod files;
pub mod jobs;
pub mod model;
pub mod profile;
pub mod releases;
pub mod verify;
