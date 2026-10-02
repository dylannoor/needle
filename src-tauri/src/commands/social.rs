//! Users, buddies, chat, interests and the wishlist.

use needle_core::api::{
    BrowseResult, Buddy, ChatMessage, Conversation, Interests, Recommendation, RoomSummary,
    RoomView, UserProfile, WishItem,
};
use serde::Serialize;
use tauri::State;

use super::blocking;
use crate::social;
use crate::state::{Shared, err, lock};
use crate::store::Block;

// users and buddies --------------------------------------------------------------

#[tauri::command]
pub async fn user_profile(
    state: State<'_, Shared>,
    username: String,
) -> Result<UserProfile, String> {
    blocking(&state, move |s| social::user_profile(s, &username)).await
}

#[tauri::command]
pub fn buddies_list(state: State<'_, Shared>) -> Vec<Buddy> {
    social::buddies(&state)
}

#[tauri::command]
pub fn buddy_add(state: State<'_, Shared>, username: String) -> Result<Vec<Buddy>, String> {
    social::buddy_add(&state, &username)
}

#[tauri::command]
pub fn buddy_remove(state: State<'_, Shared>, username: String) -> Result<Vec<Buddy>, String> {
    social::buddy_remove(&state, &username)
}

#[tauri::command]
pub fn buddy_note(
    state: State<'_, Shared>,
    username: String,
    note: String,
) -> Result<Vec<Buddy>, String> {
    social::buddy_note(&state, &username, &note)
}

#[tauri::command]
pub fn user_ban(state: State<'_, Shared>, username: String) -> Result<(), String> {
    social::set_blocked(&state, &username, Block::Banned, true)
}

#[tauri::command]
pub fn user_unban(state: State<'_, Shared>, username: String) -> Result<(), String> {
    social::set_blocked(&state, &username, Block::Banned, false)
}

#[tauri::command]
pub fn user_ignore(state: State<'_, Shared>, username: String) -> Result<(), String> {
    social::set_blocked(&state, &username, Block::Ignored, true)
}

#[tauri::command]
pub fn user_unignore(state: State<'_, Shared>, username: String) -> Result<(), String> {
    social::set_blocked(&state, &username, Block::Ignored, false)
}

#[derive(Serialize)]
pub struct Blocked {
    banned: Vec<String>,
    ignored: Vec<String>,
}

#[tauri::command]
pub fn blocked_list(state: State<'_, Shared>) -> Result<Blocked, String> {
    let store = lock(&state.store);
    Ok(Blocked {
        banned: store.blocked(Block::Banned).map_err(err)?,
        ignored: store.blocked(Block::Ignored).map_err(err)?,
    })
}

#[tauri::command]
pub async fn browse_user(
    state: State<'_, Shared>,
    username: String,
) -> Result<BrowseResult, String> {
    blocking(&state, move |s| social::browse(s, &username)).await
}

// chat ---------------------------------------------------------------------------

#[tauri::command]
pub fn rooms_list(state: State<'_, Shared>) -> Result<Vec<RoomSummary>, String> {
    social::rooms_list(&state)
}

#[tauri::command]
pub async fn room_join(state: State<'_, Shared>, room: String) -> Result<RoomView, String> {
    blocking(&state, move |s| social::room_join(s, &room)).await
}

#[tauri::command]
pub fn room_leave(state: State<'_, Shared>, room: String) -> Result<(), String> {
    social::room_leave(&state, &room)
}

#[tauri::command]
pub fn room_view(state: State<'_, Shared>, room: String) -> Result<RoomView, String> {
    social::room_view(&state, &room)
}

#[tauri::command]
pub fn room_say(state: State<'_, Shared>, room: String, text: String) -> Result<(), String> {
    state.client()?.say_in_room(&room, &text).map_err(err)
}

#[tauri::command]
pub fn room_set_ticker(state: State<'_, Shared>, room: String, text: String) -> Result<(), String> {
    state.client()?.set_room_ticker(&room, &text).map_err(err)
}

#[tauri::command]
pub fn conversations_list(state: State<'_, Shared>) -> Vec<Conversation> {
    social::conversations(&state)
}

#[tauri::command]
pub fn conversation(
    state: State<'_, Shared>,
    username: String,
) -> Result<Vec<ChatMessage>, String> {
    lock(&state.store).messages(&username, 500).map_err(err)
}

#[tauri::command]
pub fn pm_send(
    state: State<'_, Shared>,
    username: String,
    text: String,
) -> Result<ChatMessage, String> {
    if text.trim().is_empty() {
        return Err("Type a message first".into());
    }
    social::pm_send(&state, &username, &text)
}

#[tauri::command]
pub fn pm_mark_read(state: State<'_, Shared>, username: String) -> Result<(), String> {
    lock(&state.store).mark_read(&username).map_err(err)
}

// interests and wishlist ---------------------------------------------------------

#[tauri::command]
pub fn interests_get(state: State<'_, Shared>) -> Interests {
    social::interests(&state)
}

#[tauri::command]
pub fn interest_add(
    state: State<'_, Shared>,
    item: String,
    like: bool,
) -> Result<Interests, String> {
    social::interest_change(&state, &item, like, true)
}

#[tauri::command]
pub fn interest_remove(
    state: State<'_, Shared>,
    item: String,
    like: bool,
) -> Result<Interests, String> {
    social::interest_change(&state, &item, like, false)
}

#[tauri::command]
pub async fn recommendations(
    state: State<'_, Shared>,
    global: bool,
) -> Result<Vec<Recommendation>, String> {
    blocking(&state, move |s| social::recommendations(s, global)).await
}

#[tauri::command]
pub async fn similar_users(state: State<'_, Shared>) -> Result<Vec<String>, String> {
    blocking(&state, social::similar_users).await
}

#[tauri::command]
pub fn wishlist_list(state: State<'_, Shared>) -> Result<Vec<WishItem>, String> {
    crate::wishlist::list(&state)
}

#[tauri::command]
pub fn wishlist_add(state: State<'_, Shared>, query: String) -> Result<Vec<WishItem>, String> {
    crate::wishlist::add(&state, &query)
}

#[tauri::command]
pub fn wishlist_remove(state: State<'_, Shared>, query: String) -> Result<Vec<WishItem>, String> {
    crate::wishlist::remove(&state, &query)
}
