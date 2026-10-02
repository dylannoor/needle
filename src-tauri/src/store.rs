//! SQLite persistence. One connection behind the state's mutex; every method is
//! a small query. Credentials never land here, they live in the OS keychain.

use std::path::Path;

use needle_core::api::{ChatMessage, Visibility, WishItem};
use needle_core::model::QualityProfile;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Serialize, de::DeserializeOwned};

type Res<T> = rusqlite::Result<T>;

const MIGRATIONS: &[&str] = &[
    r"
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE profiles (id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE jobs (id TEXT PRIMARY KEY, json TEXT NOT NULL, created_ms INTEGER NOT NULL);
CREATE TABLE search_history (query TEXT PRIMARY KEY, at_ms INTEGER NOT NULL);
CREATE TABLE conversations (username TEXT PRIMARY KEY, unread INTEGER NOT NULL DEFAULT 0);
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL, username TEXT NOT NULL, text TEXT NOT NULL,
    at_ms INTEGER NOT NULL, own INTEGER NOT NULL, action INTEGER NOT NULL
);
CREATE INDEX messages_channel ON messages(channel, id);
CREATE TABLE buddies (username TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '', last_seen_ms INTEGER);
CREATE TABLE blocked (username TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (username, kind));
CREATE TABLE wishlist (
    query TEXT PRIMARY KEY, added_ms INTEGER NOT NULL, last_run_ms INTEGER,
    matches INTEGER NOT NULL DEFAULT 0, search_id TEXT, seen TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE shares (path TEXT PRIMARY KEY, visibility TEXT NOT NULL);
",
    r"
CREATE TABLE rejected (
    job_id TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL,
    PRIMARY KEY (job_id, name)
);
",
];

pub struct Store {
    conn: Connection,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Block {
    Banned,
    Ignored,
}

impl Block {
    const fn key(self) -> &'static str {
        match self {
            Self::Banned => "banned",
            Self::Ignored => "ignored",
        }
    }
}

pub struct BuddyRow {
    pub username: String,
    pub note: String,
    pub last_seen_ms: Option<u64>,
}

impl Store {
    pub fn open(path: &Path) -> Res<Self> {
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn in_memory() -> Res<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Res<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        let version: usize = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(version) {
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", i + 1)?;
            tx.commit()?;
        }
        Ok(Self { conn })
    }

    // settings ---------------------------------------------------------------

    pub fn get<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        let json: Option<String> = self
            .conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .optional()
            .ok()
            .flatten();
        json.and_then(|j| serde_json::from_str(&j).ok())
    }

    pub fn set<T: Serialize>(&self, key: &str, value: &T) -> Res<()> {
        let json = serde_json::to_string(value).unwrap_or_default();
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, json],
        )?;
        Ok(())
    }

    // profiles ---------------------------------------------------------------

    pub fn profiles(&self) -> Res<Vec<QualityProfile>> {
        let mut stmt = self
            .conn
            .prepare("SELECT json FROM profiles ORDER BY rowid")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        Ok(rows
            .filter_map(|j| serde_json::from_str(&j.ok()?).ok())
            .collect())
    }

    pub fn save_profile(&self, profile: &QualityProfile) -> Res<()> {
        let json = serde_json::to_string(profile).unwrap_or_default();
        self.conn.execute(
            "INSERT INTO profiles (id, json) VALUES (?1, ?2)
             ON CONFLICT(id) DO UPDATE SET json = excluded.json",
            params![profile.id, json],
        )?;
        Ok(())
    }

    pub fn delete_profile(&self, id: &str) -> Res<()> {
        self.conn
            .execute("DELETE FROM profiles WHERE id = ?1", [id])?;
        Ok(())
    }

    // jobs -------------------------------------------------------------------

    pub fn jobs(&self) -> Res<Vec<(String, String)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, json FROM jobs ORDER BY created_ms")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect()
    }

    pub fn save_job(&self, id: &str, json: &str, created_ms: u64) -> Res<()> {
        self.conn.execute(
            "INSERT INTO jobs (id, json, created_ms) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET json = excluded.json",
            params![id, json, created_ms as i64],
        )?;
        Ok(())
    }

    pub fn delete_job(&self, id: &str) -> Res<()> {
        self.conn.execute("DELETE FROM jobs WHERE id = ?1", [id])?;
        self.conn
            .execute("DELETE FROM rejected WHERE job_id = ?1", [id])?;
        Ok(())
    }

    /// Where a job's rejected file was moved to.
    pub fn set_rejected(&self, job_id: &str, name: &str, path: &str) -> Res<()> {
        self.conn.execute(
            "INSERT INTO rejected (job_id, name, path) VALUES (?1, ?2, ?3)
             ON CONFLICT(job_id, name) DO UPDATE SET path = excluded.path",
            [job_id, name, path],
        )?;
        Ok(())
    }

    pub fn take_rejected(&self, job_id: &str, name: &str) -> Res<Option<String>> {
        let path = self
            .conn
            .query_row(
                "SELECT path FROM rejected WHERE job_id = ?1 AND name = ?2",
                [job_id, name],
                |r| r.get(0),
            )
            .optional()?;
        self.conn.execute(
            "DELETE FROM rejected WHERE job_id = ?1 AND name = ?2",
            [job_id, name],
        )?;
        Ok(path)
    }

    // search history ---------------------------------------------------------

    pub fn push_history(&self, query: &str, at_ms: u64) -> Res<()> {
        self.conn.execute(
            "INSERT INTO search_history (query, at_ms) VALUES (?1, ?2)
             ON CONFLICT(query) DO UPDATE SET at_ms = excluded.at_ms",
            params![query, at_ms as i64],
        )?;
        self.conn.execute(
            "DELETE FROM search_history WHERE query NOT IN
             (SELECT query FROM search_history ORDER BY at_ms DESC LIMIT 50)",
            [],
        )?;
        Ok(())
    }

    pub fn history(&self) -> Res<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT query FROM search_history ORDER BY at_ms DESC, rowid DESC LIMIT 50")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        rows.collect()
    }

    // private messages -------------------------------------------------------

    /// Store a private message; `unread` bumps the conversation's counter.
    pub fn add_message(&self, msg: &ChatMessage, unread: bool) -> Res<()> {
        self.conn.execute(
            "INSERT INTO messages (channel, username, text, at_ms, own, action)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                msg.channel,
                msg.username,
                msg.text,
                msg.at_ms as i64,
                msg.own,
                msg.action
            ],
        )?;
        self.conn.execute(
            "INSERT INTO conversations (username, unread) VALUES (?1, ?2)
             ON CONFLICT(username) DO UPDATE SET unread = unread + excluded.unread",
            params![msg.channel, u32::from(unread)],
        )?;
        Ok(())
    }

    pub fn messages(&self, channel: &str, limit: u32) -> Res<Vec<ChatMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT channel, username, text, at_ms, own, action FROM messages
             WHERE channel = ?1 ORDER BY id DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![channel, limit], |r| {
            Ok(ChatMessage {
                channel: r.get(0)?,
                username: r.get(1)?,
                text: r.get(2)?,
                at_ms: r.get::<_, i64>(3)? as u64,
                own: r.get(4)?,
                action: r.get(5)?,
            })
        })?;
        let mut out: Vec<ChatMessage> = rows.collect::<Res<_>>()?;
        out.reverse();
        Ok(out)
    }

    /// (username, unread) for every conversation, most recent first.
    pub fn conversations(&self) -> Res<Vec<(String, u32)>> {
        let mut stmt = self.conn.prepare(
            "SELECT c.username, c.unread FROM conversations c
             LEFT JOIN (SELECT channel, MAX(id) AS last FROM messages GROUP BY channel) m
             ON m.channel = c.username ORDER BY m.last DESC",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect()
    }

    pub fn mark_read(&self, username: &str) -> Res<()> {
        self.conn.execute(
            "UPDATE conversations SET unread = 0 WHERE username = ?1",
            [username],
        )?;
        Ok(())
    }

    // buddies ----------------------------------------------------------------

    pub fn buddies(&self) -> Res<Vec<BuddyRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT username, note, last_seen_ms FROM buddies ORDER BY username COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(BuddyRow {
                username: r.get(0)?,
                note: r.get(1)?,
                last_seen_ms: r.get::<_, Option<i64>>(2)?.map(|v| v as u64),
            })
        })?;
        rows.collect()
    }

    pub fn add_buddy(&self, username: &str) -> Res<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO buddies (username) VALUES (?1)",
            [username],
        )?;
        Ok(())
    }

    pub fn remove_buddy(&self, username: &str) -> Res<()> {
        self.conn
            .execute("DELETE FROM buddies WHERE username = ?1", [username])?;
        Ok(())
    }

    pub fn set_buddy_note(&self, username: &str, note: &str) -> Res<()> {
        self.conn.execute(
            "UPDATE buddies SET note = ?2 WHERE username = ?1",
            [username, note],
        )?;
        Ok(())
    }

    pub fn set_last_seen(&self, username: &str, at_ms: u64) -> Res<()> {
        self.conn.execute(
            "UPDATE buddies SET last_seen_ms = ?2 WHERE username = ?1",
            params![username, at_ms as i64],
        )?;
        Ok(())
    }

    // ban / ignore -----------------------------------------------------------

    pub fn blocked(&self, kind: Block) -> Res<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT username FROM blocked WHERE kind = ?1 ORDER BY username COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([kind.key()], |r| r.get(0))?;
        rows.collect()
    }

    pub fn set_blocked(&self, username: &str, kind: Block, on: bool) -> Res<()> {
        let sql = if on {
            "INSERT OR IGNORE INTO blocked (username, kind) VALUES (?1, ?2)"
        } else {
            "DELETE FROM blocked WHERE username = ?1 AND kind = ?2"
        };
        self.conn.execute(sql, [username, kind.key()])?;
        Ok(())
    }

    // wishlist ---------------------------------------------------------------

    pub fn wishlist(&self) -> Res<Vec<WishItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT query, added_ms, last_run_ms, matches, search_id FROM wishlist ORDER BY added_ms DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(WishItem {
                query: r.get(0)?,
                added_ms: r.get::<_, i64>(1)? as u64,
                last_run_ms: r.get::<_, Option<i64>>(2)?.map(|v| v as u64),
                matches: r.get(3)?,
                search_id: r.get(4)?,
            })
        })?;
        rows.collect()
    }

    pub fn add_wish(&self, query: &str, added_ms: u64) -> Res<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO wishlist (query, added_ms) VALUES (?1, ?2)",
            params![query, added_ms as i64],
        )?;
        Ok(())
    }

    pub fn remove_wish(&self, query: &str) -> Res<()> {
        self.conn
            .execute("DELETE FROM wishlist WHERE query = ?1", [query])?;
        Ok(())
    }

    /// Release ids a wish matched on its last run.
    pub fn wish_seen(&self, query: &str) -> Vec<String> {
        self.conn
            .query_row("SELECT seen FROM wishlist WHERE query = ?1", [query], |r| {
                r.get::<_, String>(0)
            })
            .ok()
            .and_then(|j| serde_json::from_str(&j).ok())
            .unwrap_or_default()
    }

    pub fn record_wish_run(&self, item: &WishItem, seen: &[String]) -> Res<()> {
        self.conn.execute(
            "UPDATE wishlist SET last_run_ms = ?2, matches = ?3, search_id = ?4, seen = ?5 WHERE query = ?1",
            params![
                item.query,
                item.last_run_ms.map(|v| v as i64),
                item.matches,
                item.search_id,
                serde_json::to_string(seen).unwrap_or_default()
            ],
        )?;
        Ok(())
    }

    // shares -----------------------------------------------------------------

    pub fn shares(&self) -> Res<Vec<(String, Visibility)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT path, visibility FROM shares ORDER BY rowid")?;
        let rows = stmt.query_map([], |r| {
            let vis: String = r.get(1)?;
            Ok((
                r.get(0)?,
                serde_json::from_str(&vis).unwrap_or(Visibility::Nobody),
            ))
        })?;
        rows.collect()
    }

    pub fn set_share(&self, path: &str, visibility: Visibility) -> Res<()> {
        let vis = serde_json::to_string(&visibility).unwrap_or_default();
        self.conn.execute(
            "INSERT INTO shares (path, visibility) VALUES (?1, ?2)
             ON CONFLICT(path) DO UPDATE SET visibility = excluded.visibility",
            [path, &vis],
        )?;
        Ok(())
    }

    pub fn remove_share(&self, path: &str) -> Res<()> {
        self.conn
            .execute("DELETE FROM shares WHERE path = ?1", [path])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(channel: &str, text: &str, own: bool) -> ChatMessage {
        ChatMessage {
            channel: channel.into(),
            username: if own { "me".into() } else { channel.into() },
            text: text.into(),
            at_ms: 1,
            own,
            action: false,
        }
    }

    #[test]
    fn migrations_set_user_version_and_reopen_is_a_no_op() {
        let dir = std::env::temp_dir().join(format!("needle-store-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.db");
        let _ = std::fs::remove_file(&path);
        {
            let s = Store::open(&path).unwrap();
            s.set("k", &42).unwrap();
        }
        let s = Store::open(&path).unwrap();
        let v: usize = s
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, MIGRATIONS.len());
        assert_eq!(s.get::<i32>("k"), Some(42));
        drop(s);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn settings_round_trip_and_missing_key() {
        let s = Store::in_memory().unwrap();
        assert_eq!(s.get::<Vec<String>>("likes"), None);
        s.set("likes", &vec!["techno"]).unwrap();
        s.set("likes", &vec!["house", "dub"]).unwrap();
        assert_eq!(s.get::<Vec<String>>("likes").unwrap(), vec!["house", "dub"]);
    }

    #[test]
    fn history_dedupes_orders_latest_first_and_caps_at_50() {
        let s = Store::in_memory().unwrap();
        for i in 0..55 {
            s.push_history(&format!("q{i}"), i).unwrap();
        }
        s.push_history("q10", 100).unwrap();
        let h = s.history().unwrap();
        assert_eq!(h.len(), 50);
        assert_eq!(h[0], "q10");
        assert_eq!(h[1], "q54");
        assert!(!h.contains(&"q4".to_string()));
    }

    #[test]
    fn messages_count_unread_and_mark_read_clears() {
        let s = Store::in_memory().unwrap();
        s.add_message(&msg("alice", "hi", false), true).unwrap();
        s.add_message(&msg("alice", "you there", false), true)
            .unwrap();
        s.add_message(&msg("alice", "yes", true), false).unwrap();
        s.add_message(&msg("bob", "yo", false), true).unwrap();
        let convs = s.conversations().unwrap();
        assert_eq!(convs, vec![("bob".into(), 1), ("alice".into(), 2)]);
        let texts: Vec<_> = s
            .messages("alice", 2)
            .unwrap()
            .into_iter()
            .map(|m| m.text)
            .collect();
        assert_eq!(texts, vec!["you there", "yes"]);
        s.mark_read("alice").unwrap();
        assert_eq!(s.conversations().unwrap()[1], ("alice".into(), 0));
    }

    #[test]
    fn buddies_notes_and_blocks() {
        let s = Store::in_memory().unwrap();
        s.add_buddy("zed").unwrap();
        s.add_buddy("Amy").unwrap();
        s.add_buddy("zed").unwrap();
        s.set_buddy_note("zed", "good techno").unwrap();
        s.set_last_seen("zed", 5).unwrap();
        let b = s.buddies().unwrap();
        assert_eq!(b.len(), 2);
        assert_eq!(b[0].username, "Amy");
        assert_eq!(
            (b[1].note.as_str(), b[1].last_seen_ms),
            ("good techno", Some(5))
        );
        s.remove_buddy("Amy").unwrap();
        assert_eq!(s.buddies().unwrap().len(), 1);

        s.set_blocked("spam", Block::Ignored, true).unwrap();
        s.set_blocked("leech", Block::Banned, true).unwrap();
        assert_eq!(s.blocked(Block::Ignored).unwrap(), vec!["spam"]);
        s.set_blocked("spam", Block::Ignored, false).unwrap();
        assert!(s.blocked(Block::Ignored).unwrap().is_empty());
        assert_eq!(s.blocked(Block::Banned).unwrap(), vec!["leech"]);
    }

    #[test]
    fn wishlist_runs_and_shares_round_trip() {
        let s = Store::in_memory().unwrap();
        s.add_wish("aphex twin", 1).unwrap();
        assert!(s.wish_seen("aphex twin").is_empty());
        let mut item = s.wishlist().unwrap().remove(0);
        item.last_run_ms = Some(9);
        item.matches = 2;
        item.search_id = Some("w1".into());
        s.record_wish_run(&item, &["r1".into(), "r2".into()])
            .unwrap();
        assert_eq!(s.wishlist().unwrap()[0], item);
        assert_eq!(s.wish_seen("aphex twin"), vec!["r1", "r2"]);
        s.remove_wish("aphex twin").unwrap();
        assert!(s.wishlist().unwrap().is_empty());

        s.set_share("/music", Visibility::Everyone).unwrap();
        s.set_share("/music", Visibility::Buddies).unwrap();
        assert_eq!(
            s.shares().unwrap(),
            vec![("/music".into(), Visibility::Buddies)]
        );
        s.remove_share("/music").unwrap();
        assert!(s.shares().unwrap().is_empty());
    }

    #[test]
    fn jobs_upsert_and_delete() {
        let s = Store::in_memory().unwrap();
        s.save_job("b", "{}", 2).unwrap();
        s.save_job("a", "{}", 1).unwrap();
        s.save_job("a", "{\"x\":1}", 1).unwrap();
        assert_eq!(
            s.jobs().unwrap(),
            vec![("a".into(), "{\"x\":1}".into()), ("b".into(), "{}".into())]
        );
        s.delete_job("a").unwrap();
        assert_eq!(s.jobs().unwrap().len(), 1);
    }
}
