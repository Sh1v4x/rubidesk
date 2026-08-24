#[cfg(target_os = "android")]
mod android;
#[cfg(desktop)]
mod open;
#[cfg(desktop)]
mod stt;
mod system;

/// Sur mobile : mêmes commandes, réponses gracieuses — la voix embarquée et
/// le lanceur d'applications viendront dans un second temps.
#[cfg(mobile)]
mod stt {
    use tauri::AppHandle;

    #[tauri::command]
    pub fn stt_model_ready(_app: AppHandle) -> Result<bool, String> {
        Ok(false)
    }
    #[tauri::command]
    pub async fn stt_download_model(_app: AppHandle) -> Result<(), String> {
        Err("la voix embarquée n'est pas encore disponible sur mobile".into())
    }
    #[tauri::command]
    pub async fn stt_listen(_app: AppHandle) -> Result<String, String> {
        Err("la voix embarquée n'est pas encore disponible sur mobile".into())
    }
    #[tauri::command]
    pub fn stt_stop() {}
    #[tauri::command]
    pub fn wake_model_ready(_app: AppHandle) -> Result<bool, String> {
        Ok(false)
    }
    #[tauri::command]
    pub async fn wake_download_model(_app: AppHandle) -> Result<(), String> {
        Err("le mot d'éveil n'est pas encore disponible sur mobile".into())
    }
    #[tauri::command]
    pub fn wake_start(_app: AppHandle) -> Result<(), String> {
        Err("le mot d'éveil n'est pas encore disponible sur mobile".into())
    }
    #[tauri::command]
    pub fn wake_stop() {}
    #[tauri::command]
    pub fn wake_pause(_paused: bool) {}
    #[tauri::command]
    pub fn audio_inputs() -> Vec<String> {
        Vec::new()
    }
    #[tauri::command]
    pub fn set_input_device(_name: Option<String>) {}

    pub fn warm_up(_app: &AppHandle) {}
    pub fn shutdown() {}
}

#[cfg(mobile)]
mod open {
    fn norm(s: &str) -> String {
        s.to_lowercase()
            .chars()
            .map(|c| match c {
                'à' | 'â' | 'ä' => 'a',
                'é' | 'è' | 'ê' | 'ë' => 'e',
                'î' | 'ï' => 'i',
                'ô' | 'ö' => 'o',
                'û' | 'ù' | 'ü' => 'u',
                'ç' => 'c',
                c => c,
            })
            .collect()
    }

    #[cfg(target_os = "android")]
    fn find_package(name: &str) -> Option<(String, String)> {
        let query = norm(name);
        let apps = crate::android::list_apps().ok()?;
        let mut best: Option<(i32, (String, String))> = None;
        for (label, package) in apps {
            let n = norm(&label);
            let score = if n == query {
                100
            } else if n.split(' ').any(|w| w == query) {
                80
            } else if n.starts_with(&query) {
                70
            } else if n.contains(&query) || query.contains(&n) {
                60
            } else {
                continue;
            };
            let better = match &best {
                None => true,
                Some((s, (l, _))) => score > *s || (score == *s && n.len() < norm(l).len()),
            };
            if better {
                best = Some((score, (label, package)));
            }
        }
        best.map(|(_, app)| app)
    }

    /// Android : recherche floue dans les applications lançables, puis lancement.
    #[tauri::command]
    pub fn open_app(name: String) -> Result<String, String> {
        #[cfg(target_os = "android")]
        {
            let (label, package) =
                find_package(&name).ok_or_else(|| format!("aucune application ne ressemble à « {name} »"))?;
            crate::android::launch_package(&package)?;
            return Ok(label);
        }
        #[cfg(not(target_os = "android"))]
        {
            Err(format!("l'ouverture d'applications n'est pas disponible ici ({name})"))
        }
    }

    #[tauri::command]
    pub fn open_web(url: String) -> Result<(), String> {
        tauri_plugin_opener::open_url(url, None::<String>).map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn app_installed(name: String) -> bool {
        #[cfg(target_os = "android")]
        {
            return find_package(&name).is_some();
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = name;
            false
        }
    }

    #[tauri::command]
    pub fn open_path(_path: String) -> Result<(), String> {
        Err("indisponible sur mobile".into())
    }
}

use serde_json::{json, Value};
use std::time::Duration;

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|e| e.to_string())
}

fn api_url(base_url: &str, path: &str) -> String {
    format!("{}/api/{}", base_url.trim_end_matches('/'), path)
}

async fn parse_response(res: reqwest::Response) -> Result<Value, String> {
    let status = res.status();
    let body = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), body));
    }
    serde_json::from_str(&body).map_err(|e| format!("réponse illisible: {e}"))
}

/// GET /api/ — vérifie que Home Assistant répond et que le token est valide.
#[tauri::command]
async fn ha_check(base_url: String, token: String) -> Result<Value, String> {
    let res = client()?
        .get(api_url(&base_url, ""))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    parse_response(res).await
}

/// GET /api/states — tous les états d'entités.
#[tauri::command]
async fn ha_states(base_url: String, token: String) -> Result<Value, String> {
    let res = client()?
        .get(api_url(&base_url, "states"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    parse_response(res).await
}

/// POST /api/services/{domain}/{service} sur une entité.
#[tauri::command]
async fn ha_call_service(
    base_url: String,
    token: String,
    domain: String,
    service: String,
    entity_id: String,
) -> Result<Value, String> {
    let res = client()?
        .post(api_url(&base_url, &format!("services/{domain}/{service}")))
        .bearer_auth(token)
        .json(&json!({ "entity_id": entity_id }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    parse_response(res).await
}

/// Icône de la barre des menus : afficher/masquer, écouter, démarrage auto, quitter.
#[cfg(desktop)]
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder};
    use tauri::tray::TrayIconBuilder;
    use tauri::{Emitter, Manager};
    use tauri_plugin_autostart::ManagerExt;

    let listen = MenuItemBuilder::with_id("listen", "Écouter une commande").build(app)?;
    let toggle = MenuItemBuilder::with_id("toggle", "Afficher / Masquer").build(app)?;
    let autostart = CheckMenuItemBuilder::with_id("autostart", "Lancer au démarrage")
        .checked(app.autolaunch().is_enabled().unwrap_or(false))
        .build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quitter Rubilax").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&listen, &toggle, &autostart, &quit])
        .build()?;

    let mut tray = TrayIconBuilder::new().menu(&menu).show_menu_on_left_click(true);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(|app, event| match event.id().as_ref() {
        "quit" => app.exit(0),
        "toggle" => {
            if let Some(w) = app.get_webview_window("main") {
                if w.is_visible().unwrap_or(true) {
                    let _ = w.hide();
                } else {
                    let _ = w.show();
                }
            }
        }
        "listen" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
            }
            let _ = app.emit("shortcut-listen", ());
        }
        "autostart" => {
            let manager = app.autolaunch();
            if manager.is_enabled().unwrap_or(false) {
                let _ = manager.disable();
            } else {
                let _ = manager.enable();
            }
        }
        _ => {}
    })
    .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(desktop)]
    {
        use tauri::Emitter;
        use tauri_plugin_global_shortcut::ShortcutState;

        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            // ne restaure que la position : la taille dépend du mode mini, géré côté front
            .plugin(
                tauri_plugin_window_state::Builder::new()
                    .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                    .build(),
            )
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))
            .plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_shortcuts(["CmdOrCtrl+Shift+R"])
                    .expect("raccourci global invalide")
                    .with_handler(|app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            let _ = app.emit("shortcut-listen", ());
                        }
                    })
                    .build(),
            );
    }

    builder
        .setup(|app| {
            stt::warm_up(app.handle());
            #[cfg(desktop)]
            setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ha_check,
            ha_states,
            ha_call_service,
            stt::stt_model_ready,
            stt::stt_download_model,
            stt::stt_listen,
            stt::stt_stop,
            stt::wake_model_ready,
            stt::wake_download_model,
            stt::wake_start,
            stt::wake_stop,
            stt::wake_pause,
            stt::audio_inputs,
            stt::set_input_device,
            open::open_app,
            open::open_web,
            open::app_installed,
            open::open_path,
            system::system_volume,
            system::system_media,
            system::system_power,
            system::system_screenshot,
            system::process_running,
            system::weather,
            system::note_add,
            system::note_list,
            system::note_update,
            system::note_delete,
            system::note_clear,
            system::system_torch,
            system::overlay_set,
            system::overlay_available,
            system::automations_save,
            system::automations_load,
            system::voice_take_pending,
            system::voice_listen
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                stt::shutdown();
            }
        });
}
