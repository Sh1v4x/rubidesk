//! Jumelage PC → téléphone sur le réseau local : le PC sert la config
//! Home Assistant pendant 2 minutes sur un mini-serveur HTTP, protégée par
//! un code à 4 chiffres ; le téléphone balaie le sous-réseau et la récupère.

use std::io::{Read, Write};
use std::net::{TcpListener, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

const PAIR_PORT: u16 = 17663;
const WINDOW_SECS: u64 = 120;

static SERVING: AtomicBool = AtomicBool::new(false);

/// IP locale de la machine sur le LAN (astuce socket UDP, rien n'est envoyé).
fn local_ip() -> Result<String, String> {
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.connect("8.8.8.8:80").map_err(|e| e.to_string())?;
    Ok(socket
        .local_addr()
        .map_err(|e| e.to_string())?
        .ip()
        .to_string())
}

/// Côté PC : sert `payload` (JSON) pendant 2 minutes à qui présente le bon
/// code, puis s'éteint (une seule livraison). Renvoie l'IP locale du PC.
#[tauri::command]
pub fn pair_serve(payload: String, code: String) -> Result<String, String> {
    let ip = local_ip()?;
    // un HA en localhost sur le PC doit être joint par l'IP LAN du PC
    let payload = payload.replace("localhost", &ip).replace("127.0.0.1", &ip);
    if SERVING.swap(true, Ordering::SeqCst) {
        // une fenêtre est déjà ouverte : elle servira le payload précédent
        return Ok(ip);
    }
    let listener = TcpListener::bind(("0.0.0.0", PAIR_PORT)).map_err(|e| {
        SERVING.store(false, Ordering::SeqCst);
        e.to_string()
    })?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(WINDOW_SECS);
        while Instant::now() < deadline {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
                    let mut buf = [0u8; 1024];
                    let n = stream.read(&mut buf).unwrap_or(0);
                    let request = String::from_utf8_lossy(&buf[..n]);
                    let first_line = request.lines().next().unwrap_or("");
                    let is_pair = first_line.starts_with("GET /rubidesk-pair");
                    let code_ok = first_line.contains(&format!("code={code}"));
                    let response = if is_pair && code_ok {
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            payload.len(),
                            payload
                        )
                    } else if is_pair {
                        // ping d'identification (scan) ou mauvais code
                        "HTTP/1.1 403 Forbidden\r\nContent-Length: 8\r\nConnection: close\r\n\r\nrubidesk"
                            .to_string()
                    } else {
                        "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                            .to_string()
                    };
                    let _ = stream.write_all(response.as_bytes());
                    if is_pair && code_ok {
                        break; // livrée : on ferme la fenêtre
                    }
                }
                Err(_) => std::thread::sleep(Duration::from_millis(150)),
            }
        }
        SERVING.store(false, Ordering::SeqCst);
    });
    Ok(ip)
}

/// Côté téléphone : balaie le sous-réseau local à la recherche du PC qui
/// partage, et renvoie la config (JSON) si le code est le bon.
#[tauri::command]
pub async fn pair_fetch(code: String) -> Result<String, String> {
    let ip = local_ip()?;
    let prefix = ip
        .rsplit_once('.')
        .ok_or("réseau local introuvable")?
        .0
        .to_string();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1200))
        .build()
        .map_err(|e| e.to_string())?;

    let mut wrong_code = false;
    let hosts: Vec<u32> = (1..=254).collect();
    for chunk in hosts.chunks(32) {
        let requests = chunk.iter().map(|host| {
            let url = format!("http://{prefix}.{host}:{PAIR_PORT}/rubidesk-pair?code={code}");
            let client = client.clone();
            async move {
                let res = client.get(&url).send().await.ok()?;
                let status = res.status();
                let body = res.text().await.ok()?;
                Some((status, body))
            }
        });
        for result in futures_util::future::join_all(requests).await.into_iter().flatten() {
            match result {
                (status, body) if status.is_success() && body.starts_with('{') => {
                    return Ok(body)
                }
                (status, _) if status.as_u16() == 403 => wrong_code = true,
                _ => {}
            }
        }
    }
    if wrong_code {
        Err("PC trouvé, mais le code ne correspond pas. Vérifie les 4 chiffres.".into())
    } else {
        Err("aucun PC ne partage. Lance « Envoyer au téléphone » côté PC (même réseau Wi-Fi).".into())
    }
}
