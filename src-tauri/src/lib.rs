mod extensions;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            extensions::init(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
