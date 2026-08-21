//! Reconnaissance vocale locale : capture micro (cpal) + whisper.cpp (whisper-rs).
//! Le modèle est téléchargé une seule fois dans le dossier de données de l'app.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin";
const MODEL_FILE: &str = "ggml-large-v3-turbo-q5_0.bin";

/// Mot d'éveil : détection continue avec un modèle base — deux fois plus
/// précis que tiny sur les noms propres, toujours léger (~60 Mo).
const WAKE_MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin";
const WAKE_MODEL_FILE: &str = "ggml-base-q5_1.bin";
const WAKE_WORD: &str = "rubilax";

/// Vocabulaire d'amorçage : oriente whisper vers le lexique domotique attendu.
const INITIAL_PROMPT: &str = "Commande en français : allume, éteins, bascule \
la lumière, la lampe, le ventilateur, la prise, le volet, la télé \
du salon, de la chambre, de la cuisine, du bureau, de la salle de bain. \
Ouvre Spotify, lance Discord, va sur YouTube, recherche la météo. \
Minuteur de dix minutes, rappelle-moi dans une heure. \
Où je trouve la gelée royale ? Où se trouve le boss ? Recette du pain d'Incarnam.";

static STOP_FLAG: AtomicBool = AtomicBool::new(false);
static WHISPER_CTX: Mutex<Option<Arc<WhisperContext>>> = Mutex::new(None);

static WAKE_ACTIVE: AtomicBool = AtomicBool::new(false);
static WAKE_PAUSED: AtomicBool = AtomicBool::new(false);
static WAKE_RUNNING: AtomicBool = AtomicBool::new(false);

/// Charge le modèle une seule fois et le garde en mémoire.
fn get_ctx(model: &Path) -> Result<Arc<WhisperContext>, String> {
    let mut guard = WHISPER_CTX.lock().unwrap();
    if let Some(ctx) = guard.as_ref() {
        return Ok(ctx.clone());
    }
    let ctx = Arc::new(
        WhisperContext::new_with_params(
            model.to_str().ok_or("chemin de modèle invalide")?,
            WhisperContextParameters::default(),
        )
        .map_err(|e| e.to_string())?,
    );
    *guard = Some(ctx.clone());
    Ok(ctx)
}

/// Libère les modèles avant la fin du process — sinon le backend Metal de ggml
/// se fait démonter avant les contextes whisper et abort() à la fermeture.
pub fn shutdown() {
    WAKE_ACTIVE.store(false, Ordering::SeqCst);
    for _ in 0..20 {
        if !WAKE_RUNNING.load(Ordering::SeqCst) {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    WHISPER_CTX.lock().unwrap().take();
}

/// Précharge le modèle au démarrage (et purge l'ancien modèle small).
pub fn warm_up(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Ok(path) = model_path(&app) {
            if let Some(dir) = path.parent() {
                let _ = std::fs::remove_file(dir.join("ggml-small-q5_1.bin"));
                let _ = std::fs::remove_file(dir.join("ggml-tiny-q5_1.bin"));
            }
            if path.exists() {
                if let Err(e) = get_ctx(&path) {
                    eprintln!("[stt] préchargement du modèle échoué : {e}");
                }
            }
        }
    });
}

fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    Ok(dir.join(MODEL_FILE))
}

#[tauri::command]
pub fn stt_model_ready(app: AppHandle) -> Result<bool, String> {
    Ok(model_path(&app)?.exists())
}

/// Télécharge le modèle whisper principal (une seule fois).
#[tauri::command]
pub async fn stt_download_model(app: AppHandle) -> Result<(), String> {
    let path = model_path(&app)?;
    download(&app, MODEL_URL, &path).await
}

/// Télécharge un modèle en émettant la progression sur `stt-download` (pourcentage).
async fn download(app: &AppHandle, url: &str, path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("part");

    let mut res = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("téléchargement échoué : HTTP {}", res.status()));
    }
    let total = res.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut last_pct: u64 = 0;
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let pct = downloaded * 100 / total;
            if pct != last_pct {
                last_pct = pct;
                let _ = app.emit("stt-download", pct);
            }
        }
    }
    drop(file);
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Écoute le micro jusqu'à ~1,2 s de silence après la parole (ou stt_stop),
/// puis transcrit en français. Renvoie "" si rien n'a été dit.
#[tauri::command]
pub async fn stt_listen(app: AppHandle) -> Result<String, String> {
    let path = model_path(&app)?;
    if !path.exists() {
        return Err("le modèle n'est pas encore téléchargé".into());
    }
    STOP_FLAG.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || listen_blocking(&app, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn stt_stop() {
    STOP_FLAG.store(true, Ordering::SeqCst);
}

/// Ouvre le micro par défaut et pousse les échantillons (mono f32) dans `samples`.
fn open_input_stream(samples: Arc<Mutex<Vec<f32>>>) -> Result<(cpal::Stream, usize), String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("aucun micro détecté")?;
    let supported = device.default_input_config().map_err(|e| e.to_string())?;
    let sample_rate = supported.sample_rate() as usize;
    let channels = supported.channels() as usize;
    let stream_config: cpal::StreamConfig = supported.config();
    let err_fn = |e| eprintln!("[stt] erreur de flux micro : {e}");

    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => {
            let buf = samples;
            device.build_input_stream(
                stream_config,
                move |data: &[f32], _| push_mono(&buf, data, channels),
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let buf = samples;
            device.build_input_stream(
                stream_config,
                move |data: &[i16], _| {
                    let as_f32: Vec<f32> =
                        data.iter().map(|s| *s as f32 / i16::MAX as f32).collect();
                    push_mono(&buf, &as_f32, channels);
                },
                err_fn,
                None,
            )
        }
        f => return Err(format!("format micro non géré : {f:?}")),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok((stream, sample_rate))
}

/// Suspend la détection du mot d'éveil tant qu'il est en vie (RAII).
struct WakePauseGuard;
impl WakePauseGuard {
    fn new() -> Self {
        WAKE_PAUSED.store(true, Ordering::SeqCst);
        WakePauseGuard
    }
}
impl Drop for WakePauseGuard {
    fn drop(&mut self) {
        WAKE_PAUSED.store(false, Ordering::SeqCst);
    }
}

fn listen_blocking(app: &AppHandle, model: &Path) -> Result<String, String> {
    // pas de mot d'éveil pendant l'écoute d'une commande
    let _pause = WakePauseGuard::new();

    let samples: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let (stream, sample_rate) = open_input_stream(samples.clone())?;

    // Détection d'activité vocale rudimentaire : RMS par tranche de 100 ms,
    // seuil calibré sur le bruit ambiant des 300 premières ms.
    let start = Instant::now();
    let mut speech_started = false;
    let mut last_voice = Instant::now();
    let mut noise_floor: f32 = 0.004;
    let mut processed = 0usize;

    loop {
        std::thread::sleep(Duration::from_millis(100));
        if STOP_FLAG.load(Ordering::SeqCst) {
            break;
        }
        let rms = {
            let buf = samples.lock().unwrap();
            let new = &buf[processed.min(buf.len())..];
            let rms = if new.is_empty() {
                0.0
            } else {
                (new.iter().map(|s| s * s).sum::<f32>() / new.len() as f32).sqrt()
            };
            processed = buf.len();
            rms
        };

        let elapsed = start.elapsed();
        if elapsed < Duration::from_millis(300) {
            noise_floor = noise_floor.max(rms);
            continue;
        }
        let threshold = (noise_floor * 2.5).max(0.010);
        if rms > threshold {
            speech_started = true;
            last_voice = Instant::now();
        }
        if speech_started && last_voice.elapsed() > Duration::from_millis(1400) {
            break;
        }
        if !speech_started && elapsed > Duration::from_secs(6) {
            break;
        }
        if elapsed > Duration::from_secs(15) {
            break;
        }
    }
    drop(stream);

    if !speech_started {
        return Ok(String::new());
    }
    let _ = app.emit("stt-status", "transcribing");
    let audio = samples.lock().unwrap().clone();
    let mut audio16k = resample(&audio, sample_rate, 16_000);
    // whisper refuse les extraits < 1 s : on complète avec du silence.
    let min_len = 16_000 + 1_600;
    if audio16k.len() < min_len {
        audio16k.resize(min_len, 0.0);
    }
    transcribe(model, &audio16k)
}

fn push_mono(buf: &Arc<Mutex<Vec<f32>>>, data: &[f32], channels: usize) {
    let mut buf = buf.lock().unwrap();
    if channels <= 1 {
        buf.extend_from_slice(data);
    } else {
        for frame in data.chunks(channels) {
            buf.push(frame.iter().sum::<f32>() / channels as f32);
        }
    }
}

/// Rééchantillonnage linéaire — suffisant pour de la parole vers 16 kHz.
fn resample(input: &[f32], from: usize, to: usize) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from as f32 / to as f32;
    let out_len = (input.len() as f32 / ratio) as usize;
    (0..out_len)
        .map(|i| {
            let pos = i as f32 * ratio;
            let idx = pos as usize;
            let frac = pos - idx as f32;
            let a = input[idx.min(input.len() - 1)];
            let b = input[(idx + 1).min(input.len() - 1)];
            a + (b - a) * frac
        })
        .collect()
}

fn transcribe(model: &Path, audio: &[f32]) -> Result<String, String> {
    let ctx = get_ctx(model)?;
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;

    let mut params = FullParams::new(SamplingStrategy::BeamSearch {
        beam_size: 5,
        patience: -1.0,
    });
    params.set_language(Some("fr"));
    params.set_initial_prompt(INITIAL_PROMPT);
    params.set_translate(false);
    params.set_print_progress(false);
    params.set_print_special(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);
    params.set_no_context(true);
    params.set_n_threads((std::thread::available_parallelism().map_or(4, |n| n.get()) as i32).min(8));

    state.full(params, audio).map_err(|e| e.to_string())?;

    let mut text = String::new();
    for segment in state.as_iter() {
        text.push_str(&segment.to_str_lossy().map_err(|e| e.to_string())?);
    }
    Ok(text.trim().to_string())
}

// ---------------------------------------------------------------------------
// Mot d'éveil « Rubilax »
// ---------------------------------------------------------------------------

fn wake_model_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(model_path(app)?.with_file_name(WAKE_MODEL_FILE))
}

#[tauri::command]
pub fn wake_model_ready(app: AppHandle) -> Result<bool, String> {
    Ok(wake_model_path(&app)?.exists())
}

#[tauri::command]
pub async fn wake_download_model(app: AppHandle) -> Result<(), String> {
    let path = wake_model_path(&app)?;
    download(&app, WAKE_MODEL_URL, &path).await
}

/// Démarre l'écoute passive du mot d'éveil dans un thread dédié.
#[tauri::command]
pub fn wake_start(app: AppHandle) -> Result<(), String> {
    let model = wake_model_path(&app)?;
    if !model.exists() {
        return Err("le modèle d'éveil n'est pas téléchargé".into());
    }
    if WAKE_ACTIVE.swap(true, Ordering::SeqCst) {
        return Ok(()); // déjà actif
    }
    WAKE_PAUSED.store(false, Ordering::SeqCst);
    std::thread::spawn(move || {
        WAKE_RUNNING.store(true, Ordering::SeqCst);
        if let Err(e) = wake_loop(&app, &model) {
            eprintln!("[wake] boucle interrompue : {e}");
        }
        WAKE_RUNNING.store(false, Ordering::SeqCst);
        WAKE_ACTIVE.store(false, Ordering::SeqCst);
    });
    Ok(())
}

#[tauri::command]
pub fn wake_stop() {
    WAKE_ACTIVE.store(false, Ordering::SeqCst);
}

/// Suspend/reprend la détection (utilisé pendant que Rubilax parle, pour
/// éviter qu'il ne se réveille en entendant son propre nom).
#[tauri::command]
pub fn wake_pause(paused: bool) {
    WAKE_PAUSED.store(paused, Ordering::SeqCst);
}

fn wake_loop(app: &AppHandle, model: &Path) -> Result<(), String> {
    let ctx = WhisperContext::new_with_params(
        model.to_str().ok_or("chemin de modèle invalide")?,
        WhisperContextParameters::default(),
    )
    .map_err(|e| e.to_string())?;

    let samples: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let (stream, sample_rate) = open_input_stream(samples.clone())?;

    let started = Instant::now();
    let mut speech_started = false;
    let mut speech_start_at = Instant::now();
    let mut last_voice = Instant::now();
    let mut noise_floor: f32 = 0.004;
    let mut processed = 0usize;

    while WAKE_ACTIVE.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(150));

        if WAKE_PAUSED.load(Ordering::SeqCst) {
            samples.lock().unwrap().clear();
            processed = 0;
            speech_started = false;
            continue;
        }

        let rms = {
            let mut buf = samples.lock().unwrap();
            let new = &buf[processed.min(buf.len())..];
            let rms = if new.is_empty() {
                0.0
            } else {
                (new.iter().map(|s| s * s).sum::<f32>() / new.len() as f32).sqrt()
            };
            // hors parole, garder une seconde de pré-roll : l'attaque du
            // « Ru- » précède souvent le franchissement du seuil
            if !speech_started && buf.len() > sample_rate * 2 {
                let excess = buf.len() - sample_rate;
                buf.drain(0..excess);
            }
            processed = buf.len();
            rms
        };

        if started.elapsed() < Duration::from_millis(500) {
            noise_floor = noise_floor.max(rms);
            continue;
        }
        let threshold = (noise_floor * 2.5).max(0.010);
        if rms > threshold {
            if !speech_started {
                speech_start_at = Instant::now();
            }
            speech_started = true;
            last_voice = Instant::now();
        }

        let phrase_ended = speech_started && last_voice.elapsed() > Duration::from_millis(500);
        let phrase_too_long =
            speech_started && speech_start_at.elapsed() > Duration::from_secs(3);
        if !(phrase_ended || phrase_too_long) {
            continue;
        }

        let audio = {
            let mut buf = samples.lock().unwrap();
            let audio = buf.clone();
            buf.clear();
            audio
        };
        processed = 0;
        speech_started = false;

        let mut audio16k = resample(&audio, sample_rate, 16_000);
        let min_len = 16_000 + 1_600;
        if audio16k.len() < min_len {
            audio16k.resize(min_len, 0.0);
        }
        match wake_transcribe(&ctx, &audio16k) {
            Ok(text) if matches_wake_word(&text) => {
                eprintln!("[wake] détecté : {text:?}");
                let _ = app.emit("wake-detected", text);
                // laisser le front prendre le relais avant de ré-écouter
                std::thread::sleep(Duration::from_millis(500));
                samples.lock().unwrap().clear();
                processed = 0;
            }
            Ok(text) => {
                if !text.trim().is_empty() {
                    eprintln!("[wake] entendu (pas de match) : {text:?}");
                }
            }
            Err(e) => eprintln!("[wake] transcription échouée : {e}"),
        }
    }
    drop(stream);
    Ok(())
}

fn wake_transcribe(ctx: &WhisperContext, audio: &[f32]) -> Result<String, String> {
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;
    // faisceau court : nettement meilleur que greedy sur un nom propre isolé
    let mut params = FullParams::new(SamplingStrategy::BeamSearch {
        beam_size: 3,
        patience: -1.0,
    });
    params.set_language(Some("fr"));
    params.set_translate(false);
    params.set_print_progress(false);
    params.set_print_special(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);
    // pas de [Musique], (rires) et autres jetons non-parole hallucinés
    params.set_suppress_nst(true);
    params.set_temperature(0.0);
    // amorce : oriente le petit modèle vers le nom qu'on attend
    params.set_initial_prompt("Rubilax ! Hé Rubilax !");
    params.set_no_context(true);
    params.set_n_threads(4);
    state.full(params, audio).map_err(|e| e.to_string())?;
    let mut text = String::new();
    for segment in state.as_iter() {
        text.push_str(&segment.to_str_lossy().map_err(|e| e.to_string())?);
    }
    Ok(text)
}

/// « Rubilax » avec tolérance aux transcriptions approximatives : accents,
/// espaces et ponctuation ignorés, distance d'édition sur fenêtre glissante,
/// et repli sur la fin distinctive « -bilax » quand l'attaque est coupée.
fn matches_wake_word(text: &str) -> bool {
    let clean: String = text
        .to_lowercase()
        .chars()
        .filter_map(|c| match c {
            'a'..='z' => Some(c),
            'à' | 'â' | 'ä' => Some('a'),
            'é' | 'è' | 'ê' | 'ë' => Some('e'),
            'î' | 'ï' => Some('i'),
            'ô' | 'ö' => Some('o'),
            'û' | 'ù' | 'ü' => Some('u'),
            'ç' => Some('c'),
            'y' => Some('i'), // « ruby lax » → « rubilax »
            'k' => Some('x'), // « rubilaks »
            _ => None,
        })
        .collect();
    if clean.contains(WAKE_WORD) || clean.contains("roubilax") {
        return true;
    }
    // le début « Ru- » est souvent avalé : la fin « -bilax » suffit
    if clean.contains("bilax") || clean.contains("bilas") {
        return true;
    }
    let n = WAKE_WORD.len();
    for w in (n - 2)..=(n + 2) {
        if clean.len() < w {
            continue;
        }
        for i in 0..=clean.len() - w {
            let win = &clean[i..i + w];
            let d = levenshtein(win, WAKE_WORD);
            if d <= 2 {
                return true;
            }
            // un peu plus laxiste quand l'attaque « Rub- » colle exactement
            // (pas sur la fin seule : « relaxe » est un mot courant)
            if d == 3 && (win.starts_with("rub") || win.starts_with("roub")) {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod wake_tests {
    use super::matches_wake_word;

    #[test]
    fn variantes_acceptees() {
        for heard in [
            "Rubilax !",
            "Hé Rubilax",
            "roubilax",
            "Ruby lax",
            "Ruby Lax.",
            "rubilaks",
            "Rubilaxe",
            "rubila",
            "et bilax ?",
            "Hubilax",
            "rue Bilas",
            "Roubila",
        ] {
            assert!(matches_wake_word(heard), "aurait dû matcher : {heard:?}");
        }
    }

    #[test]
    fn phrases_normales_refusees() {
        for heard in [
            "allume la lumière du salon",
            "quel temps fait-il demain",
            "c'est une publication",
            "il relaxe tranquillement",
            "la rubrique du jour",
            "minuteur de dix minutes",
        ] {
            assert!(!matches_wake_word(heard), "n'aurait pas dû matcher : {heard:?}");
        }
    }
}

pub(crate) fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0usize; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        cur[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cost = if ca == cb { 0 } else { 1 };
            cur[j + 1] = (prev[j + 1] + 1).min(cur[j] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}
