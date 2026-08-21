mod open;
mod stt;

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
    use tauri::Emitter;
    use tauri_plugin_global_shortcut::ShortcutState;

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
        )
        .setup(|app| {
            stt::warm_up(app.handle());
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
            open::open_app,
            open::open_web
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                stt::shutdown();
            }
        });
}
