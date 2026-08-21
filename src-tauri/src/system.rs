//! Contrôle de la machine (son, verrouillage, veille, capture, musique),
//! météo Open-Meteo et notes rapides.
//! macOS : osascript / outils système. Windows : PowerShell + SendKeys — aucun
//! crate natif supplémentaire.

use serde_json::{json, Value};
use std::path::PathBuf;
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

/// Capture l'écran entier sur le Bureau ; renvoie le chemin du fichier.
#[tauri::command]
pub fn system_screenshot() -> Result<String, String> {
    let stamp = std::time::SystemTime::now()
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

#[tauri::command]
pub fn note_clear(app: AppHandle) -> Result<(), String> {
    let path = notes_path(&app)?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
