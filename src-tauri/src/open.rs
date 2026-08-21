//! Ouverture d'applications (par nom, avec matching flou) et d'URLs.
//! macOS : scan de /Applications & co. Windows : raccourcis du menu Démarrer.

use std::path::PathBuf;
use std::process::Command;

use crate::stt::levenshtein;

/// Noms français courants → nom réel du bundle/raccourci.
const FR_ALIASES: &[(&str, &str)] = &[
    ("calculatrice", "Calculator"),
    ("calculette", "Calculator"),
    ("musique", "Music"),
    ("calendrier", "Calendar"),
    ("rappels", "Reminders"),
    ("reglages", "System Settings"),
    ("preferences systeme", "System Settings"),
    ("navigateur", "Safari"),
    ("courrier", "Mail"),
    ("plans", "Maps"),
    ("photos", "Photos"),
    ("l appareil photo", "Photo Booth"),
];

fn normalize(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' => 'i',
            'ô' | 'ö' => 'o',
            'û' | 'ù' | 'ü' => 'u',
            'ç' => 'c',
            c if c.is_alphanumeric() => c,
            _ => ' ',
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(target_os = "macos")]
fn list_apps() -> Vec<(String, PathBuf)> {
    let mut dirs = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join("Applications"));
    }

    let mut apps = Vec::new();
    for dir in dirs {
        collect_apps(&dir, &mut apps, 0);
    }
    apps
}

#[cfg(target_os = "macos")]
fn collect_apps(dir: &std::path::Path, out: &mut Vec<(String, PathBuf)>, depth: u8) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "app") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                out.push((stem.to_string(), path));
            }
        } else if depth < 1 && path.is_dir() {
            collect_apps(&path, out, depth + 1);
        }
    }
}

#[cfg(target_os = "macos")]
fn launch(path: &std::path::Path) -> Result<(), String> {
    Command::new("open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn list_apps() -> Vec<(String, PathBuf)> {
    let mut roots = Vec::new();
    if let Some(pd) = std::env::var_os("ProgramData") {
        roots.push(PathBuf::from(pd).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    if let Some(ad) = std::env::var_os("APPDATA") {
        roots.push(PathBuf::from(ad).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    let mut apps = Vec::new();
    for root in roots {
        collect_lnk(&root, &mut apps, 0);
    }
    apps
}

#[cfg(target_os = "windows")]
fn collect_lnk(dir: &std::path::Path, out: &mut Vec<(String, PathBuf)>, depth: u8) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "lnk") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                out.push((stem.to_string(), path));
            }
        } else if depth < 3 && path.is_dir() {
            collect_lnk(&path, out, depth + 1);
        }
    }
}

#[cfg(target_os = "windows")]
fn launch(path: &std::path::Path) -> Result<(), String> {
    Command::new("cmd")
        .args(["/C", "start", ""])
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Trouve l'application la plus proche du nom demandé et la lance.
/// Renvoie le nom réel de l'application ouverte.
#[tauri::command]
pub fn open_app(name: String) -> Result<String, String> {
    let (display, path) = find_app(&name)?;
    launch(&path)?;
    Ok(display)
}

/// Matching flou du nom demandé contre les applications installées.
fn find_app(name: &str) -> Result<(String, PathBuf), String> {
    let mut query = normalize(name);
    for (alias, real) in FR_ALIASES {
        if query == *alias {
            query = normalize(real);
            break;
        }
    }
    if query.is_empty() {
        return Err("nom vide".into());
    }

    let apps = list_apps();
    let mut best: Option<(i32, String, PathBuf)> = None;

    for (display, path) in apps {
        let norm = normalize(&display);
        let score = if norm == query {
            100
        } else if norm.split(' ').any(|w| w == query) {
            80
        } else if norm.starts_with(&query) {
            70
        } else if norm.contains(&query) || query.contains(&norm) {
            60
        } else if levenshtein(&norm, &query) <= 2 {
            40
        } else {
            continue;
        };

        let better = match &best {
            None => true,
            Some((s, n, _)) => score > *s || (score == *s && norm.len() < normalize(n).len()),
        };
        if better {
            best = Some((score, display, path));
        }
    }

    best.map(|(_, display, path)| (display, path))
        .ok_or_else(|| format!("aucune application ne ressemble à « {name} »"))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::find_app;

    #[test]
    fn trouve_safari() {
        assert!(find_app("safari").unwrap().0.contains("Safari"));
    }

    #[test]
    fn alias_francais_calculatrice() {
        assert!(find_app("calculatrice").unwrap().0.contains("Calculator"));
    }

    #[test]
    fn matching_flou() {
        // faute de frappe / transcription approximative
        assert!(find_app("safar").unwrap().0.contains("Safari"));
    }

    #[test]
    fn inconnu_est_une_erreur() {
        assert!(find_app("zorglubx").is_err());
    }
}

/// Ouvre une URL dans le navigateur par défaut.
#[tauri::command]
pub fn open_web(url: String) -> Result<(), String> {
    tauri_plugin_opener::open_url(url, None::<String>).map_err(|e| e.to_string())
}

/// Une application correspondant à ce nom est-elle installée ?
#[tauri::command]
pub fn app_installed(name: String) -> bool {
    find_app(&name).is_ok()
}
