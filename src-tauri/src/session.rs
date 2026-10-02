//! Login, reconnect and the poller that turns library state into events.

use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::{Duration, Instant};

use needle_core::api::{SessionState, SessionStatus};
use soulseek_rs::{Client, ClientSettings, SessionLoss};

use crate::state::{Shared, lock};

const KEYRING_SERVICE: &str = "app.needle.client";
const LAST_USER: &str = "__last_user__";
const POLL: Duration = Duration::from_millis(150);
const BACKOFF_SECS: &[u64] = &[5, 10, 30, 60];

fn entry(account: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, account).ok()
}

/// Stored credentials, if the user asked to be remembered.
pub fn remembered_user() -> Option<(String, String)> {
    let user = entry(LAST_USER)?.get_password().ok()?;
    let pass = entry(&user)?.get_password().ok()?;
    Some((user, pass))
}

fn remember(username: &str, password: &str, on: bool) {
    if on {
        if let (Some(u), Some(p)) = (entry(LAST_USER), entry(username)) {
            let _ = u.set_password(username);
            let _ = p.set_password(password);
        }
    } else if let Some((user, _)) = remembered_user() {
        let _ = entry(&user).map(|e| e.delete_credential());
        let _ = entry(LAST_USER).map(|e| e.delete_credential());
    }
}

pub fn status(state: &Shared) -> SessionStatus {
    lock(&state.session).clone()
}

fn update(state: &Shared, f: impl FnOnce(&mut SessionStatus)) -> SessionStatus {
    let status = {
        let mut s = lock(&state.session);
        f(&mut s);
        s.clone()
    };
    state.emit("session", status.clone());
    status
}

pub fn alive(state: &Shared, generation: u64) -> bool {
    state.generation.load(Ordering::SeqCst) == generation
}

pub fn login(
    state: &Shared,
    username: String,
    password: String,
    remember_me: bool,
) -> SessionStatus {
    remember(&username, &password, remember_me);
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    drop_session(state);
    let status = update(state, |s| {
        s.state = SessionState::Connecting;
        s.username = Some(username.clone());
        s.error = None;
        s.remembered = remember_me;
        s.away = false;
    });
    let state = state.clone();
    thread::spawn(move || connect_loop(&state, generation, &username, &password));
    status
}

pub fn logout(state: &Shared) -> SessionStatus {
    state.generation.fetch_add(1, Ordering::SeqCst);
    drop_session(state);
    update(state, |s| {
        s.state = SessionState::Offline;
        s.error = None;
        s.port_open = None;
        s.away = false;
    })
}

pub fn set_away(state: &Shared, away: bool) -> Result<SessionStatus, String> {
    state.client()?.set_away(away).map_err(crate::state::err)?;
    Ok(update(state, |s| s.away = away))
}

fn drop_session(state: &Shared) {
    if let Some(client) = state.set_client(None) {
        client.cancel_handle().cancel();
    }
    *lock(&state.port_mapper) = None;
}

fn connect_loop(state: &Shared, generation: u64, username: &str, password: &str) {
    let mut attempt = 0usize;
    loop {
        if !alive(state, generation) {
            return;
        }
        let settings = state.settings();
        let mut client = Client::with_settings(ClientSettings {
            enable_listen: true,
            listen_port: settings.listen_port,
            shared_directories: crate::shares::public_dirs(state),
            ..ClientSettings::new(username, password)
        });
        let result = client.connect().and_then(|()| client.login());
        if !alive(state, generation) {
            return;
        }
        match result {
            Ok(true) => {
                online(state, generation, Arc::new(client), username, password);
                return;
            }
            Ok(false) => {
                update(state, |s| {
                    s.state = SessionState::Error;
                    s.error = Some(
                        "The server refused the login. Check your username and password.".into(),
                    );
                });
                return;
            }
            Err(e) => {
                let wait = BACKOFF_SECS[attempt.min(BACKOFF_SECS.len() - 1)];
                attempt += 1;
                update(state, |s| {
                    s.state = SessionState::Connecting;
                    s.error = Some(format!(
                        "Could not reach the server ({e}), trying again in {wait} s"
                    ));
                });
                let until = Instant::now() + Duration::from_secs(wait);
                while Instant::now() < until {
                    if !alive(state, generation) {
                        return;
                    }
                    thread::sleep(Duration::from_millis(250));
                }
            }
        }
    }
}

fn online(state: &Shared, generation: u64, client: Arc<Client>, username: &str, password: &str) {
    let settings = state.settings();
    state.set_client(Some(client.clone()));
    let port = client.listen_port().unwrap_or(settings.listen_port);
    update(state, |s| {
        s.state = SessionState::Online;
        s.error = None;
        s.listen_port = port;
        s.port_open = None;
    });
    if settings.port_mapping && client.listen_port().is_some() {
        let st = state.clone();
        let mapper = crate::portmap::PortMapper::spawn(port, move |ok| {
            if alive(&st, generation) {
                update(&st, |s| s.port_open = Some(ok));
            }
        });
        *lock(&state.port_mapper) = Some(mapper);
    }
    crate::transfers::apply_settings(&client, &settings);
    crate::social::on_login(state, &client);
    crate::transfers::resume_all(state);

    let st = state.clone();
    let (user, pass) = (username.to_string(), password.to_string());
    thread::spawn(move || poll(&st, generation, &client, &user, &pass));
    let st = state.clone();
    thread::spawn(move || crate::wishlist::run(&st, generation));
}

fn poll(state: &Shared, generation: u64, client: &Arc<Client>, username: &str, password: &str) {
    let mut last_presence = Instant::now();
    while alive(state, generation) {
        if let Some(loss) = client.session_loss() {
            drop_session(state);
            match loss {
                SessionLoss::Displaced => {
                    state.generation.fetch_add(1, Ordering::SeqCst);
                    update(state, |s| {
                        s.state = SessionState::Error;
                        s.error = Some(
                            "You logged in somewhere else, so this session was closed.".into(),
                        );
                        s.port_open = None;
                    });
                }
                SessionLoss::Disconnected => {
                    update(state, |s| {
                        s.state = SessionState::Connecting;
                        s.error = Some("Lost the connection to the server, reconnecting".into());
                        s.port_open = None;
                    });
                    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
                    connect_loop(state, generation, username, password);
                }
            }
            return;
        }
        crate::social::drain(state, client);
        crate::uploads::drain(state, client);
        if last_presence.elapsed() >= Duration::from_secs(2) {
            crate::social::refresh_presence(state, client);
            last_presence = Instant::now();
        }
        thread::sleep(POLL);
    }
}

/// Log in with stored credentials on start, if there are any.
pub fn auto_login(state: &Shared) {
    if let Some((user, pass)) = remembered_user() {
        login(state, user, pass, true);
    }
}
