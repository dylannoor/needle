//! Rooms, private messages, users, buddies, ban/ignore, browse and interests.

use std::collections::{HashMap, HashSet, VecDeque};
use std::thread;
use std::time::{Duration, Instant};

use needle_core::api::{
    BrowseResult, Buddy, ChatMessage, Conversation, ExtensionEvent, Interests, Presence,
    Recommendation, RoomEventPayload, RoomMember, RoomSummary, RoomView, SharedDir, UserProfile,
};
use needle_core::model::FileInfo;
use soulseek_rs::types::RoomUserStats;
use soulseek_rs::{Client, RoomEvent, UserStatus};

use crate::state::{Shared, err, lock, now_ms};
use crate::store::{Block, Store};

const ROOM_HISTORY: usize = 300;

pub struct Live {
    presence: Presence,
    files: Option<u32>,
}

pub struct Social {
    pub buddies: HashMap<String, Live>,
    pub banned: HashSet<String>,
    pub ignored: HashSet<String>,
    /// Joined rooms and their recent messages.
    rooms: HashMap<String, VecDeque<ChatMessage>>,
}

impl Social {
    pub fn load(store: &Store) -> Self {
        Self {
            buddies: store
                .buddies()
                .unwrap_or_default()
                .into_iter()
                .map(|b| {
                    (
                        b.username,
                        Live {
                            presence: Presence::Unknown,
                            files: None,
                        },
                    )
                })
                .collect(),
            banned: store
                .blocked(Block::Banned)
                .unwrap_or_default()
                .into_iter()
                .collect(),
            ignored: store
                .blocked(Block::Ignored)
                .unwrap_or_default()
                .into_iter()
                .collect(),
            rooms: HashMap::new(),
        }
    }
}

pub const fn presence(status: UserStatus) -> Presence {
    match status {
        UserStatus::Online => Presence::Online,
        UserStatus::Away => Presence::Away,
        UserStatus::Offline => Presence::Offline,
    }
}

/// Poll `f` every 100 ms until it yields or `timeout` passes.
pub fn wait_for<T>(timeout: Duration, mut f: impl FnMut() -> Option<T>) -> Option<T> {
    let until = Instant::now() + timeout;
    loop {
        if let Some(v) = f() {
            return Some(v);
        }
        if Instant::now() >= until {
            return None;
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn is_action(text: &str) -> bool {
    text.starts_with("/me ")
}

pub fn on_login(state: &Shared, client: &Client) {
    let buddies: Vec<String> = lock(&state.social).buddies.keys().cloned().collect();
    for b in buddies {
        let _ = client.watch_user(&b);
    }
    let interests = interests(state);
    for item in &interests.likes {
        let _ = client.add_interest(item);
    }
    for item in &interests.dislikes {
        let _ = client.add_dislike(item);
    }
    let mut rooms: HashSet<String> = lock(&state.social).rooms.keys().cloned().collect();
    rooms.extend(state.settings().auto_join_rooms);
    for room in rooms {
        let _ = client.join_room(&room);
        lock(&state.social).rooms.entry(room).or_default();
    }
    let _ = client.request_room_list();
}

/// Called by the session poller: private messages and room events.
pub fn drain(state: &Shared, client: &Client) {
    for m in client.take_private_messages() {
        if state.is_ignored(m.username()) {
            continue;
        }
        let msg = ChatMessage {
            channel: m.username().to_string(),
            username: m.username().to_string(),
            text: m.message().to_string(),
            at_ms: u64::from(m.timestamp()) * 1000,
            own: false,
            action: is_action(m.message()),
        };
        let _ = lock(&state.store).add_message(&msg, true);
        crate::extensions::dispatch(
            &state.app,
            ExtensionEvent {
                name: "pm.received".into(),
                payload: serde_json::to_value(&msg).unwrap_or_default(),
            },
        );
        if state.settings().notify_private_messages && !state.window_focused() {
            state.notify(&msg.username, &msg.text);
        }
        state.emit("pm:message", msg);
    }
    let me = state.own_username().unwrap_or_default();
    for event in client.take_room_events() {
        if let Some(payload) = room_event(state, &me, event) {
            state.emit("room:event", payload);
        }
    }
}

fn room_event(state: &Shared, me: &str, event: RoomEvent) -> Option<RoomEventPayload> {
    Some(match event {
        RoomEvent::Message {
            room,
            username,
            message,
        } => {
            if state.is_ignored(&username) {
                return None;
            }
            let msg = ChatMessage {
                channel: room.clone(),
                own: username == me,
                action: is_action(&message),
                username,
                text: message,
                at_ms: now_ms(),
            };
            let mut social = lock(&state.social);
            let log = social.rooms.entry(room).or_default();
            log.push_back(msg.clone());
            while log.len() > ROOM_HISTORY {
                log.pop_front();
            }
            RoomEventPayload::Message { message: msg }
        }
        RoomEvent::Joined { room, .. } => {
            lock(&state.social).rooms.entry(room).or_default();
            RoomEventPayload::ListChanged
        }
        RoomEvent::Left { room } => {
            lock(&state.social).rooms.remove(&room);
            RoomEventPayload::ListChanged
        }
        RoomEvent::UserJoined { room, username } => RoomEventPayload::Joined {
            room,
            member: RoomMember {
                username,
                presence: Presence::Online,
                files: None,
                avg_speed: None,
                operator: false,
            },
        },
        RoomEvent::UserLeft { room, username } => RoomEventPayload::Left { room, username },
        RoomEvent::TickerAdded {
            room,
            username,
            ticker,
        } => RoomEventPayload::Ticker {
            room,
            username,
            text: ticker,
        },
        RoomEvent::TickerRemoved { room, username } => RoomEventPayload::Ticker {
            room,
            username,
            text: String::new(),
        },
        RoomEvent::List(_)
        | RoomEvent::PrivateMembers { .. }
        | RoomEvent::PrivateOperators { .. }
        | RoomEvent::PrivateRosterChanged { .. }
        | RoomEvent::OwnStandingChanged { .. }
        | RoomEvent::CantCreate { .. } => RoomEventPayload::ListChanged,
        RoomEvent::Tickers { .. } | RoomEvent::GlobalMessage { .. } => return None,
    })
}

/// Called every couple of seconds: buddy presence from the server's watch updates.
pub fn refresh_presence(state: &Shared, client: &Client) {
    let mut changed = false;
    let now = now_ms();
    let mut seen = vec![];
    {
        let mut social = lock(&state.social);
        for (name, live) in &mut social.buddies {
            let Some(info) = client.user_info(name) else {
                continue;
            };
            let p = info
                .presence
                .map_or(Presence::Unknown, |p| presence(p.status));
            let files = info.stats.map(|s| s.shared_files);
            if p != live.presence || files != live.files {
                if matches!(p, Presence::Online | Presence::Away)
                    || matches!(live.presence, Presence::Online | Presence::Away)
                {
                    seen.push(name.clone());
                }
                live.presence = p;
                live.files = files;
                changed = true;
            }
        }
    }
    if !seen.is_empty() {
        let store = lock(&state.store);
        for name in seen {
            let _ = store.set_last_seen(&name, now);
        }
    }
    if changed {
        state.emit("buddies:update", buddies(state));
    }
}

// buddies ---------------------------------------------------------------------

pub fn buddies(state: &Shared) -> Vec<Buddy> {
    let rows = lock(&state.store).buddies().unwrap_or_default();
    let social = lock(&state.social);
    rows.into_iter()
        .map(|b| {
            let live = social.buddies.get(&b.username);
            Buddy {
                presence: live.map_or(Presence::Unknown, |l| l.presence),
                files: live.and_then(|l| l.files),
                username: b.username,
                note: b.note,
                last_seen_ms: b.last_seen_ms,
            }
        })
        .collect()
}

fn buddies_changed(state: &Shared) -> Vec<Buddy> {
    let list = buddies(state);
    state.emit("buddies:update", list.clone());
    list
}

pub fn buddy_add(state: &Shared, username: &str) -> Result<Vec<Buddy>, String> {
    let username = username.trim();
    if username.is_empty() {
        return Err("Enter a username".into());
    }
    lock(&state.store).add_buddy(username).map_err(err)?;
    lock(&state.social)
        .buddies
        .entry(username.to_string())
        .or_insert(Live {
            presence: Presence::Unknown,
            files: None,
        });
    if let Ok(client) = state.client() {
        let _ = client.watch_user(username);
    }
    Ok(buddies_changed(state))
}

pub fn buddy_remove(state: &Shared, username: &str) -> Result<Vec<Buddy>, String> {
    lock(&state.store).remove_buddy(username).map_err(err)?;
    lock(&state.social).buddies.remove(username);
    if let Ok(client) = state.client() {
        let _ = client.unwatch_user(username);
    }
    Ok(buddies_changed(state))
}

pub fn buddy_note(state: &Shared, username: &str, note: &str) -> Result<Vec<Buddy>, String> {
    lock(&state.store)
        .set_buddy_note(username, note)
        .map_err(err)?;
    Ok(buddies_changed(state))
}

pub fn set_blocked(state: &Shared, username: &str, kind: Block, on: bool) -> Result<(), String> {
    lock(&state.store)
        .set_blocked(username, kind, on)
        .map_err(err)?;
    let mut social = lock(&state.social);
    let set = match kind {
        Block::Banned => &mut social.banned,
        Block::Ignored => &mut social.ignored,
    };
    if on {
        set.insert(username.to_string());
    } else {
        set.remove(username);
    }
    drop(social);
    if on
        && kind == Block::Banned
        && let Ok(client) = state.client()
    {
        for u in client.uploads().iter().filter(|u| u.username == username) {
            let _ = client.cancel_upload(&u.username, &u.filename);
        }
    }
    Ok(())
}

// users -----------------------------------------------------------------------

pub fn user_profile(state: &Shared, username: &str) -> Result<UserProfile, String> {
    let client = state.client()?;
    client.request_user_info(username).map_err(err)?;
    client.request_peer_info(username).map_err(err)?;
    client.request_user_interests(username).map_err(err)?;
    wait_for(Duration::from_secs(10), || {
        let info = client.user_info(username);
        let offline = info
            .as_ref()
            .and_then(|i| i.presence)
            .is_some_and(|p| p.status == UserStatus::Offline);
        let complete = info.is_some_and(|i| i.is_complete())
            && client.peer_info(username).is_some()
            && client.user_interests(username).is_some();
        (offline || complete).then_some(())
    });
    let info = client.user_info(username);
    let peer = client.peer_info(username);
    let interests = client.user_interests(username).unwrap_or_default();
    let stats = info.as_ref().and_then(|i| i.stats);
    let social = lock(&state.social);
    Ok(UserProfile {
        username: username.to_string(),
        presence: info
            .as_ref()
            .and_then(|i| i.presence)
            .map_or(Presence::Unknown, |p| presence(p.status)),
        avg_speed: stats.map(|s| s.average_speed),
        files: stats.map(|s| s.shared_files),
        folders: stats.map(|s| s.shared_folders),
        free_slot: peer.as_ref().map(|p| p.slots_free),
        queue_len: peer.as_ref().map(|p| p.queue_size),
        description: peer.map(|p| p.description).filter(|d| !d.is_empty()),
        // The library reads past the picture without keeping it.
        picture: None,
        likes: interests.likes,
        dislikes: interests.hates,
        buddy: social.buddies.contains_key(username),
        banned: social.banned.contains(username),
        ignored: social.ignored.contains(username),
    })
}

pub fn browse(state: &Shared, username: &str) -> Result<BrowseResult, String> {
    let client = state.client()?;
    client.browse_user(username).map_err(err)?;
    let dirs = wait_for(Duration::from_secs(60), || {
        client.take_browse_result(username)
    });
    let error = dirs
        .is_none()
        .then(|| format!("{username} did not answer within 60 seconds"));
    Ok(BrowseResult {
        username: username.to_string(),
        dirs: dirs
            .unwrap_or_default()
            .into_iter()
            .map(|d| SharedDir {
                files: d
                    .files
                    .iter()
                    .map(|f| {
                        FileInfo::from_attributes(
                            format!("{}\\{}", d.name, f.name),
                            f.size,
                            &f.attributes,
                        )
                    })
                    .collect(),
                path: d.name,
            })
            .collect(),
        // The library drops the buddies-only part of a listing.
        locked_dirs: vec![],
        error,
    })
}

// private messages ----------------------------------------------------------

pub fn pm_send(state: &Shared, username: &str, text: &str) -> Result<ChatMessage, String> {
    let client = state.client()?;
    client.send_private_message(username, text).map_err(err)?;
    let msg = ChatMessage {
        channel: username.to_string(),
        username: client.username().to_string(),
        text: text.to_string(),
        at_ms: now_ms(),
        own: true,
        action: is_action(text),
    };
    lock(&state.store).add_message(&msg, false).map_err(err)?;
    Ok(msg)
}

pub fn conversations(state: &Shared) -> Vec<Conversation> {
    let client = state.client().ok();
    let store = lock(&state.store);
    let social = lock(&state.social);
    store
        .conversations()
        .unwrap_or_default()
        .into_iter()
        .map(|(username, unread)| {
            let presence = social
                .buddies
                .get(&username)
                .map(|l| l.presence)
                .or_else(|| {
                    client
                        .as_ref()
                        .and_then(|c| c.user_info(&username))
                        .and_then(|i| i.presence)
                        .map(|p| presence(p.status))
                })
                .unwrap_or(Presence::Unknown);
            Conversation {
                last: store.messages(&username, 1).ok().and_then(|mut m| m.pop()),
                unread,
                presence,
                username,
            }
        })
        .collect()
}

// rooms -----------------------------------------------------------------------

pub fn rooms_list(state: &Shared) -> Result<Vec<RoomSummary>, String> {
    let client = state.client()?;
    let social = lock(&state.social);
    let mut out: Vec<RoomSummary> = client
        .private_rooms()
        .into_iter()
        .map(|name| RoomSummary {
            users: client.private_room_members(&name).len() as u32,
            private: true,
            joined: social.rooms.contains_key(&name),
            name,
        })
        .collect();
    out.extend(client.room_list().into_iter().map(|r| RoomSummary {
        joined: social.rooms.contains_key(&r.name),
        name: r.name,
        users: r.user_count,
        private: false,
    }));
    Ok(out)
}

pub fn room_join(state: &Shared, room: &str) -> Result<RoomView, String> {
    let client = state.client()?;
    if client.private_rooms().iter().any(|r| r == room) {
        client.join_private_room(room).map_err(err)?;
    } else {
        client.join_room(room).map_err(err)?;
    }
    lock(&state.social)
        .rooms
        .entry(room.to_string())
        .or_default();
    wait_for(Duration::from_secs(5), || {
        (!client.room_members(room).is_empty()).then_some(())
    });
    room_view(state, room)
}

pub fn room_leave(state: &Shared, room: &str) -> Result<(), String> {
    state.client()?.leave_room(room).map_err(err)?;
    lock(&state.social).rooms.remove(room);
    Ok(())
}

fn member(username: String, stats: Option<&RoomUserStats>, operator: bool) -> RoomMember {
    RoomMember {
        presence: stats.map_or(Presence::Online, |s| presence(s.status)),
        files: stats.map(|s| s.shared_files),
        avg_speed: stats.map(|s| s.average_speed),
        operator,
        username,
    }
}

pub fn room_view(state: &Shared, room: &str) -> Result<RoomView, String> {
    let client = state.client()?;
    let stats = client.room_member_stats(room);
    let operators = client.private_room_operators(room);
    let members = client
        .room_members(room)
        .into_iter()
        .map(|name| {
            let s = stats.iter().find(|s| s.username == name);
            let op = operators.contains(&name);
            member(name, s, op)
        })
        .collect();
    let messages = lock(&state.social)
        .rooms
        .get(room)
        .map(|m| m.iter().cloned().collect())
        .unwrap_or_default();
    Ok(RoomView {
        name: room.to_string(),
        members,
        messages,
        tickers: client
            .room_tickers(room)
            .into_iter()
            .map(|t| (t.username, t.ticker))
            .collect(),
        private: client.private_rooms().iter().any(|r| r == room),
        owner: None,
    })
}

// interests -------------------------------------------------------------------

pub fn interests(state: &Shared) -> Interests {
    lock(&state.store).get("interests").unwrap_or(Interests {
        likes: vec![],
        dislikes: vec![],
    })
}

pub fn interest_change(
    state: &Shared,
    item: &str,
    like: bool,
    add: bool,
) -> Result<Interests, String> {
    let item = item.trim();
    if item.is_empty() {
        return Err("Enter something you like or dislike".into());
    }
    let mut i = interests(state);
    let list = if like { &mut i.likes } else { &mut i.dislikes };
    list.retain(|x| x != item);
    if add {
        list.push(item.to_string());
    }
    lock(&state.store).set("interests", &i).map_err(err)?;
    if let Ok(c) = state.client() {
        let _ = match (like, add) {
            (true, true) => c.add_interest(item),
            (true, false) => c.remove_interest(item),
            (false, true) => c.add_dislike(item),
            (false, false) => c.remove_dislike(item),
        };
    }
    Ok(i)
}

pub fn recommendations(state: &Shared, global: bool) -> Result<Vec<Recommendation>, String> {
    let client = state.client()?;
    let read = || {
        if global {
            client.global_recommendations()
        } else {
            client.recommendations()
        }
    };
    let before = read();
    if global {
        client.request_global_recommendations()
    } else {
        client.request_recommendations()
    }
    .map_err(err)?;
    let fresh = wait_for(Duration::from_secs(5), || {
        read().filter(|r| Some(r) != before.as_ref())
    });
    let (good, bad) = fresh.or(before).unwrap_or_default();
    Ok(good
        .into_iter()
        .chain(bad)
        .map(|r| Recommendation {
            item: r.item,
            score: r.rating,
        })
        .collect())
}

pub fn similar_users(state: &Shared) -> Result<Vec<String>, String> {
    let client = state.client()?;
    let before = client.similar_users();
    client.request_similar_users().map_err(err)?;
    let mut users = wait_for(Duration::from_secs(5), || {
        let now = client.similar_users();
        (now != before).then_some(now)
    })
    .unwrap_or(before);
    users.sort_by_key(|u| std::cmp::Reverse(u.weight));
    Ok(users.into_iter().map(|u| u.username).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wait_for_returns_early_or_gives_up() {
        let mut n = 0;
        assert_eq!(
            wait_for(Duration::from_secs(5), || {
                n += 1;
                (n == 3).then_some(n)
            }),
            Some(3)
        );
        let start = Instant::now();
        assert_eq!(wait_for(Duration::from_millis(150), || None::<()>), None);
        assert!(start.elapsed() >= Duration::from_millis(150));
    }

    #[test]
    fn me_messages_are_actions() {
        assert!(is_action("/me waves"));
        assert!(!is_action("/men at work"));
        assert!(!is_action("hello"));
    }
}
