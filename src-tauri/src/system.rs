//! Contrôle de la machine (son, verrouillage, veille, capture, musique),
//! météo Open-Meteo et notes rapides.
//! macOS : osascript / outils système. Windows : PowerShell + SendKeys — aucun
//! crate natif supplémentaire.

use serde_json::{json, Value};
use std::path::PathBuf;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::process::Command;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "macos")]
fn osascript(script: &str) -> Result<String, String> {
    let out = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(target_os = "windows")]
fn sendkeys(char_code: u16, times: u32) -> Result<(), String> {
    let keys = format!("[char]{char_code}").repeat(times as usize);
    let script = format!("(New-Object -ComObject WScript.Shell).SendKeys(({keys}))");
    // SendKeys accepte une chaîne : on concatène les caractères
    let script = if times > 1 {
        format!(
            "$s=New-Object -ComObject WScript.Shell; 1..{times} | ForEach-Object {{ $s.SendKeys([char]{char_code}) }}"
        )
    } else {
        script
    };
    Command::new("powershell")
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// action : "up" | "down" | "mute" | "unmute" | "set:<0-100>" (set : macOS seulement)
#[tauri::command]
pub fn system_volume(action: String) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        crate::android::adjust_volume(&action)?;
        return Ok(match action.as_str() {
            "up" => "plus fort",
            "down" => "moins fort",
            "mute" => "muet",
            _ => "son rétabli",
        }
        .into());
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "android")))]
    {
        let _ = action;
        return Err("indisponible sur mobile".into());
    }

    #[cfg(target_os = "macos")]
    {
        match action.as_str() {
            "up" | "down" => {
                let cur: i32 = osascript("output volume of (get volume settings)")?
                    .parse()
                    .map_err(|_| "volume illisible".to_string())?;
                let next = if action == "up" {
                    (cur + 10).min(100)
                } else {
                    (cur - 10).max(0)
                };
                osascript(&format!("set volume output volume {next}"))?;
                Ok(next.to_string())
            }
            "mute" => {
                osascript("set volume with output muted")?;
                Ok("muet".into())
            }
            "unmute" => {
                osascript("set volume without output muted")?;
                Ok("son rétabli".into())
            }
            a if a.starts_with("set:") => {
                let v: i32 = a[4..].parse().map_err(|_| "valeur invalide".to_string())?;
                let v = v.clamp(0, 100);
                osascript(&format!("set volume output volume {v}"))?;
                Ok(v.to_string())
            }
            _ => Err("action inconnue".into()),
        }
    }
    #[cfg(target_os = "windows")]
    {
        match action.as_str() {
            "up" => sendkeys(175, 5).map(|_| "plus fort".into()),
            "down" => sendkeys(174, 5).map(|_| "moins fort".into()),
            "mute" => sendkeys(173, 1).map(|_| "muet".into()),
            "unmute" => sendkeys(173, 1).map(|_| "son rétabli".into()),
            a if a.starts_with("set:") => Err("réglage précis non géré sur Windows".into()),
            _ => Err("action inconnue".into()),
        }
    }
}

/// action : "playpause" | "next" | "previous"
#[tauri::command]
pub fn system_media(action: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        return crate::android::media_key(&action);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "android")))]
    {
        let _ = action;
        return Err("indisponible sur mobile".into());
    }

    #[cfg(target_os = "macos")]
    {
        let verb = match action.as_str() {
            "playpause" => "playpause",
            "next" => "next track",
            "previous" => "previous track",
            _ => return Err("action inconnue".into()),
        };
        let script = format!(
            "if application \"Spotify\" is running then\n tell application \"Spotify\" to {verb}\n\
             else if application \"Music\" is running then\n tell application \"Music\" to {verb}\n\
             else\n error \"aucun lecteur en cours\"\nend if"
        );
        osascript(&script).map(|_| ())
    }
    #[cfg(target_os = "windows")]
    {
        let code = match action.as_str() {
            "playpause" => 179,
            "next" => 176,
            "previous" => 177,
            _ => return Err("action inconnue".into()),
        };
        sendkeys(code, 1)
    }
}

/// action : "lock" | "sleep"
#[tauri::command]
pub fn system_power(action: String) -> Result<(), String> {
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = action;
        return Err("indisponible sur mobile".into());
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
    let mut cmd = match action.as_str() {
        #[cfg(target_os = "macos")]
        "lock" => {
            let mut c = Command::new(
                "/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession",
            );
            c.arg("-suspend");
            c
        }
        #[cfg(target_os = "macos")]
        "sleep" => {
            let mut c = Command::new("pmset");
            c.arg("sleepnow");
            c
        }
        #[cfg(target_os = "windows")]
        "lock" => {
            let mut c = Command::new("rundll32.exe");
            c.args(["user32.dll,LockWorkStation"]);
            c
        }
        #[cfg(target_os = "windows")]
        "sleep" => {
            let mut c = Command::new("rundll32.exe");
            c.args(["powrprof.dll,SetSuspendState", "0,1,0"]);
            c
        }
        _ => return Err("action inconnue".into()),
    };
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

/// Capture l'écran entier sur le Bureau ; renvoie le chemin du fichier.
#[tauri::command]
pub fn system_screenshot() -> Result<String, String> {
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        return Err("indisponible sur mobile".into());
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let stamp: u64 = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        let path = format!("{home}/Desktop/Rubilax_{stamp}.png");
        let out = Command::new("screencapture")
            .args(["-x", &path])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(path)
    }
    #[cfg(target_os = "windows")]
    {
        let profile = std::env::var("USERPROFILE").map_err(|e| e.to_string())?;
        let path = format!("{profile}\\Desktop\\Rubilax_{stamp}.png");
        let script = format!(
            "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; \
             $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; \
             $bmp=New-Object Drawing.Bitmap $b.Width,$b.Height; \
             $g=[Drawing.Graphics]::FromImage($bmp); \
             $g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size); \
             $bmp.Save('{path}')"
        );
        let out = Command::new("powershell")
            .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(path)
    }
}

/// Un processus dont le nom contient `name` tourne-t-il ? (insensible à la casse)
#[tauri::command]
pub fn process_running(name: String) -> bool {
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = name;
        false
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("pgrep")
            .args(["-if", &name])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("tasklist")
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains(&name.to_lowercase()))
            .unwrap_or(false)
    }
}

// ---------------------------------------------------------------------------
// Météo — Open-Meteo, gratuit et sans clé
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn weather(city: String) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let geo: Value = client
        .get("https://geocoding-api.open-meteo.com/v1/search")
        .query(&[("name", city.as_str()), ("count", "1"), ("language", "fr")])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let place = geo["results"]
        .get(0)
        .ok_or_else(|| format!("ville inconnue : {city}"))?;
    let lat = place["latitude"].as_f64().ok_or("latitude manquante")?;
    let lon = place["longitude"].as_f64().ok_or("longitude manquante")?;
    let name = place["name"].as_str().unwrap_or(&city).to_string();

    let forecast: Value = client
        .get("https://api.open-meteo.com/v1/forecast")
        .query(&[
            ("latitude", lat.to_string().as_str()),
            ("longitude", lon.to_string().as_str()),
            ("current", "temperature_2m,weather_code,wind_speed_10m"),
            ("daily", "weather_code,temperature_2m_max,temperature_2m_min"),
            ("forecast_days", "2"),
            ("timezone", "auto"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    Ok(json!({
        "city": name,
        "current": forecast["current"],
        "daily": forecast["daily"],
    }))
}

// ---------------------------------------------------------------------------
// Notes rapides — un fichier markdown dans les données de l'app
// ---------------------------------------------------------------------------

fn notes_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("notes.md"))
}

#[tauri::command]
pub fn note_add(app: AppHandle, text: String, date: String) -> Result<(), String> {
    use std::io::Write;
    let path = notes_path(&app)?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "- [{date}] {text}").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn note_list(app: AppHandle) -> Result<Vec<String>, String> {
    let path = notes_path(&app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(String::from)
        .collect())
}

fn read_note_lines(app: &AppHandle) -> Result<(PathBuf, Vec<String>), String> {
    let path = notes_path(app)?;
    let lines = if path.exists() {
        std::fs::read_to_string(&path)
            .map_err(|e| e.to_string())?
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(String::from)
            .collect()
    } else {
        Vec::new()
    };
    Ok((path, lines))
}

fn write_note_lines(path: &PathBuf, lines: &[String]) -> Result<(), String> {
    if lines.is_empty() {
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    std::fs::write(path, lines.join("\n") + "\n").map_err(|e| e.to_string())
}

/// Remplace le texte d'une note (l'horodatage « - [date] » est conservé).
#[tauri::command]
pub fn note_update(app: AppHandle, index: usize, text: String) -> Result<(), String> {
    let (path, mut lines) = read_note_lines(&app)?;
    let line = lines.get_mut(index).ok_or("note introuvable")?;
    if line.starts_with("- [") {
        if let Some(pos) = line.find("] ") {
            *line = format!("{}] {}", &line[..pos], text.trim());
            return write_note_lines(&path, &lines);
        }
    }
    *line = format!("- {}", text.trim());
    write_note_lines(&path, &lines)
}

/// Supprime une note par son index.
#[tauri::command]
pub fn note_delete(app: AppHandle, index: usize) -> Result<(), String> {
    let (path, mut lines) = read_note_lines(&app)?;
    if index >= lines.len() {
        return Err("note introuvable".into());
    }
    lines.remove(index);
    write_note_lines(&path, &lines)
}

#[tauri::command]
pub fn note_clear(app: AppHandle) -> Result<(), String> {
    let path = notes_path(&app)?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Batterie : niveau + secteur branché (nourrit la forme Shushu)
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct BatteryStatus {
    /// 0-100, ou -1 si la machine n'a pas de batterie
    pub level: i32,
    /// branché sur le secteur
    pub charging: bool,
}

#[tauri::command]
pub fn battery_status() -> BatteryStatus {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("pmset")
            .args(["-g", "batt"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .unwrap_or_default();
        let charging = out.contains("AC Power");
        // le niveau est le nombre juste avant le « % » (ex. « … 85%; charging; … »)
        let level = out
            .find('%')
            .map(|i| {
                let head = &out[..i];
                let start = head
                    .rfind(|c: char| !c.is_ascii_digit())
                    .map(|p| p + 1)
                    .unwrap_or(0);
                head[start..].parse::<i32>().unwrap_or(-1)
            })
            .unwrap_or(-1);
        return BatteryStatus { level, charging };
    }
    #[cfg(target_os = "windows")]
    {
        let out = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "$b=Get-CimInstance Win32_Battery|Select-Object -First 1; if($b){\"$($b.EstimatedChargeRemaining);$($b.BatteryStatus)\"}else{'-1;0'}",
            ])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        let mut parts = out.split(';');
        let level = parts.next().and_then(|s| s.trim().parse::<i32>().ok()).unwrap_or(-1);
        let status = parts.next().and_then(|s| s.trim().parse::<i32>().ok()).unwrap_or(0);
        // 2 = sur secteur, 6-9 = variantes en charge, 3 = pleine sur secteur
        let charging = matches!(status, 2 | 3 | 6 | 7 | 8 | 9);
        return BatteryStatus { level, charging };
    }
    #[cfg(target_os = "android")]
    {
        let (level, charging) = crate::android::battery_status().unwrap_or((-1, false));
        return BatteryStatus { level, charging };
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "android")))]
    {
        BatteryStatus { level: -1, charging: false }
    }
}

// ---------------------------------------------------------------------------
// Spécifique mobile : torche, œil flottant, automatisations
// ---------------------------------------------------------------------------

/// Lampe torche (Android uniquement).
#[tauri::command]
pub fn system_torch(on: bool) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        return crate::android::set_torch(on);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = on;
        Err("la torche, c'est sur le téléphone, mortel".into())
    }
}

/// L'œil flottant est-il disponible (Android) et la permission accordée ?
/// Renvoie "ok", "permission" (à demander) ou "indisponible".
#[tauri::command]
pub fn overlay_available() -> String {
    #[cfg(target_os = "android")]
    {
        return match crate::android::can_draw_overlays() {
            Ok(true) => "ok".into(),
            Ok(false) => "permission".into(),
            Err(_) => "indisponible".into(),
        };
    }
    #[cfg(not(target_os = "android"))]
    {
        "indisponible".into()
    }
}

/// Active/désactive l'œil flottant. Si la permission manque, ouvre l'écran
/// système et renvoie Err("permission").
#[tauri::command]
pub fn overlay_set(active: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        if active {
            match crate::android::can_draw_overlays() {
                Ok(true) => {}
                Ok(false) => {
                    let _ = crate::android::request_overlay_permission();
                    return Err("permission".into());
                }
                Err(e) => return Err(e),
            }
        }
        return crate::android::overlay_service(active);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = active;
        Err("indisponible ici".into())
    }
}

/// Récupère (et consomme) une commande dictée via la reconnaissance vocale
/// native Android (œil flottant en appui long, ou bouton micro).
#[tauri::command]
pub fn voice_take_pending() -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    {
        return crate::android::take_voice_command();
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(None)
    }
}

/// Récupère (et consomme) une config Home Assistant déposée dans le dossier
/// privé de l'app (files/ha_config.json) — import sans recopie manuelle.
#[tauri::command]
pub fn config_take_pending() -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    {
        return crate::android::take_pending_config();
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(None)
    }
}

/// Active/désactive le mot d'éveil natif Android (« Hé Rubilax », Vosk).
/// Renvoie Err("permission") si le micro doit d'abord être accordé.
#[tauri::command]
pub fn wake_native_set(active: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        return crate::android::wake_native(active);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = active;
        Err("le mot d'éveil natif, c'est sur le téléphone".into())
    }
}

/// Déclenche l'écoute vocale native (Android uniquement).
#[tauri::command]
pub fn voice_listen() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        return crate::android::start_voice();
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("l'écoute native, c'est sur le téléphone".into())
    }
}

fn automations_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("automations.json"))
}

/// Sauvegarde la configuration des automatisations (lue aussi par le
/// récepteur natif Android quand l'app est fermée).
#[tauri::command]
pub fn automations_save(app: AppHandle, json: String) -> Result<(), String> {
    std::fs::write(automations_path(&app)?, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn automations_load(app: AppHandle) -> Result<String, String> {
    let path = automations_path(&app)?;
    if !path.exists() {
        return Ok("{}".into());
    }
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Mise à jour Android intégrée : télécharge l'APK dans le cache (progression
/// émise sur `update-download`) puis ouvre l'installateur système dessus.
#[tauri::command]
pub async fn update_install_apk(app: AppHandle, url: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use std::io::Write;
        use tauri::Emitter;
        let path = PathBuf::from(crate::android::cache_dir()?).join("rubidesk-update.apk");
        // un reste de mise à jour précédente ne doit jamais être installé
        let _ = std::fs::remove_file(&path);
        let mut res = reqwest::Client::new()
            .get(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("téléchargement échoué : HTTP {}", res.status()));
        }
        let total = res.content_length().unwrap_or(0);
        let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
        let mut downloaded: u64 = 0;
        let mut last_pct: u64 = 0;
        while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
            file.write_all(&chunk).map_err(|e| e.to_string())?;
            downloaded += chunk.len() as u64;
            if total > 0 {
                let pct = downloaded * 100 / total;
                if pct != last_pct {
                    last_pct = pct;
                    let _ = app.emit("update-download", pct);
                }
            }
        }
        drop(file);
        return crate::android::install_apk(&path.to_string_lossy());
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, url);
        Err("la mise à jour intégrée, c'est sur le téléphone".into())
    }
}
