//! The app's shared state, kept in Tauri managed state as `Arc<State>` so the
//! worker threads can hold it too.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use needle_core::api::{SessionState, SessionStatus, Settings};
use needle_core::model::QualityProfile;
use serde::Serialize;
use soulseek_rs::Client;
use tauri::{AppHandle, Emitter, Manager};

use crate::store::Store;

pub type Shared = Arc<State>;

pub const NOT_CONNECTED: &str = "Not connected to Soulseek";

pub struct State {
    pub app: AppHandle,
    pub store: Mutex<Store>,
    client: RwLock<Option<Arc<Client>>>,
    pub session: Mutex<SessionStatus>,
    /// Bumped on every login and logout; loops tied to a session stop when it moves.
    pub generation: AtomicU64,
    pub settings: RwLock<Settings>,
    pub searches: Mutex<crate::search::Searches>,
    pub jobs: Mutex<HashMap<String, crate::transfers::JobEntry>>,
    pub shares: Mutex<crate::shares::ShareState>,
    pub social: Mutex<crate::social::Social>,
    pub port_mapper: Mutex<Option<crate::portmap::PortMapper>>,
}

pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

pub fn default_settings(download_dir: &Path, profile_id: String) -> Settings {
    Settings {
        download_dir: download_dir.display().to_string(),
        incomplete_dir: download_dir.join(".incomplete").display().to_string(),
        rejected_dir: download_dir.join("Rejected").display().to_string(),
        listen_port: 2234,
        port_mapping: true,
        upload_slots: 3,
        upload_limit_kbps: 0,
        download_limit_kbps: 0,
        buddies_first: false,
        active_profile_id: profile_id,
        search_exclusions: vec![],
        auto_join_rooms: vec![],
        notify_private_messages: true,
        notify_wishlist_hits: true,
    }
}

impl State {
    pub fn new(app: AppHandle, store: Store) -> Shared {
        let download_dir = app
            .path()
            .download_dir()
            .or_else(|_| app.path().home_dir().map(|h| h.join("Downloads")))
            .unwrap_or_else(|_| PathBuf::from("Downloads"))
            .join("Needle");
        let settings = store.get::<Settings>("settings").unwrap_or_else(|| {
            default_settings(&download_dir, QualityProfile::lossless_first().id)
        });
        let social = crate::social::Social::load(&store);
        let remembered = crate::session::remembered_user().is_some();
        Arc::new(Self {
            app,
            store: Mutex::new(store),
            client: RwLock::new(None),
            session: Mutex::new(SessionStatus {
                state: SessionState::Offline,
                username: None,
                error: None,
                listen_port: settings.listen_port,
                port_open: None,
                away: false,
                remembered,
            }),
            generation: AtomicU64::new(0),
            settings: RwLock::new(settings),
            searches: Mutex::new(crate::search::Searches::default()),
            jobs: Mutex::new(HashMap::new()),
            shares: Mutex::new(crate::shares::ShareState::default()),
            social: Mutex::new(social),
            port_mapper: Mutex::new(None),
        })
    }

    pub fn client(&self) -> Result<Arc<Client>, String> {
        self.client
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
            .ok_or_else(|| NOT_CONNECTED.to_string())
    }

    pub fn set_client(&self, client: Option<Arc<Client>>) -> Option<Arc<Client>> {
        let mut slot = self
            .client
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        std::mem::replace(&mut *slot, client)
    }

    pub fn settings(&self) -> Settings {
        self.settings
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    pub fn emit<T: Serialize + Clone>(&self, event: &str, payload: T) {
        let _ = self.app.emit(event, payload);
    }

    pub fn profiles(&self) -> Vec<QualityProfile> {
        let stored = lock(&self.store).profiles().unwrap_or_default();
        let mut out: Vec<_> = QualityProfile::builtins()
            .into_iter()
            .filter(|b| !stored.iter().any(|p| p.id == b.id))
            .collect();
        out.extend(stored);
        out
    }

    /// `id`, else the active profile, else the built-in one.
    pub fn profile(&self, id: Option<&str>) -> QualityProfile {
        let active = self.settings().active_profile_id;
        let want = id.unwrap_or(&active);
        let all = self.profiles();
        all.iter()
            .find(|p| p.id == want)
            .or_else(|| all.iter().find(|p| p.id == active))
            .cloned()
            .unwrap_or_else(QualityProfile::lossless_first)
    }

    pub fn own_username(&self) -> Option<String> {
        lock(&self.session).username.clone()
    }

    pub fn is_buddy(&self, username: &str) -> bool {
        lock(&self.social).buddies.contains_key(username)
    }

    pub fn is_banned(&self, username: &str) -> bool {
        lock(&self.social).banned.contains(username)
    }

    pub fn is_ignored(&self, username: &str) -> bool {
        lock(&self.social).ignored.contains(username)
    }

    pub fn window_focused(&self) -> bool {
        self.app
            .get_webview_window("main")
            .and_then(|w| w.is_focused().ok())
            .unwrap_or(false)
    }

    pub fn notify(&self, title: &str, body: &str) {
        use tauri_plugin_notification::NotificationExt;
        let _ = self
            .app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show();
    }
}
