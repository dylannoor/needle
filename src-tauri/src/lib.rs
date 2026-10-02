mod commands;
mod extensions;
mod portmap;
mod search;
mod session;
mod shares;
mod social;
mod state;
mod store;
mod throttle;
mod transfers;
mod uploads;
mod wishlist;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let store = store::Store::open(&dir.join("needle.db"))?;
            let state = state::State::new(app.handle().clone(), store);
            app.manage(state.clone());
            transfers::load(&state);
            transfers::run_ticker(state.clone());
            shares::rescan(&state);
            session::auto_login(&state);
            extensions::init(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::session_status,
            commands::login,
            commands::logout,
            commands::set_away,
            commands::search_start,
            commands::search_view,
            commands::search_cancel,
            commands::search_history,
            commands::search_user,
            commands::search_room,
            commands::download_release,
            commands::download_files,
            commands::jobs_list,
            commands::job_pause,
            commands::job_resume,
            commands::job_cancel,
            commands::job_retry,
            commands::job_remove,
            commands::jobs_clear_finished,
            commands::job_keep_file,
            commands::job_reveal,
            commands::uploads_view,
            commands::upload_cancel,
            commands::shares_view,
            commands::share_add,
            commands::share_remove,
            commands::share_set_visibility,
            commands::shares_rescan,
            commands::pick_folder,
            commands::owned_check,
            commands::settings_get,
            commands::settings_set,
            commands::profiles_list,
            commands::profile_save,
            commands::profile_delete,
            commands::profile_preview,
            commands::user_profile,
            commands::buddies_list,
            commands::buddy_add,
            commands::buddy_remove,
            commands::buddy_note,
            commands::user_ban,
            commands::user_unban,
            commands::user_ignore,
            commands::user_unignore,
            commands::blocked_list,
            commands::browse_user,
            commands::rooms_list,
            commands::room_join,
            commands::room_leave,
            commands::room_view,
            commands::room_say,
            commands::room_set_ticker,
            commands::conversations_list,
            commands::conversation,
            commands::pm_send,
            commands::pm_mark_read,
            commands::interests_get,
            commands::interest_add,
            commands::interest_remove,
            commands::recommendations,
            commands::similar_users,
            commands::wishlist_list,
            commands::wishlist_add,
            commands::wishlist_remove,
            // extensions (owned by src/extensions)
            extensions::extensions_list,
            extensions::extension_set_enabled,
            extensions::extension_install,
            extensions::extension_uninstall,
            extensions::extension_source,
            extensions::extension_call,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
