package com.shivax.rubilax

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import java.io.File
import java.io.FileOutputStream
import java.net.URL
import java.util.zip.ZipInputStream

/**
 * Mot d'éveil « Hé Rubilax » : écoute continue 100 % locale (Vosk, petit
 * modèle français ~41 Mo téléchargé à la première activation). À la
 * détection, ouvre l'app en écoute vocale — comme l'appui long sur l'œil.
 */
class WakeService : Service() {

    companion object {
        private const val CHANNEL_ID = "rubilax_wake"
        private const val NOTIF_ID = 1668
        private const val MODEL_URL =
            "https://alphacephei.com/vosk/models/vosk-model-small-fr-0.22.zip"
        private const val MODEL_DIR = "vosk-model-small-fr-0.22"

        /**
         * « Rubilax » n'existe pas dans le vocabulaire du modèle : Vosk
         * transcrit les mots réels les plus proches (« rubis lax », « rue
         * bila », « roubaix »…). On matche donc en flou : texte compacté,
         * fenêtres glissantes, distance de Levenshtein — la même recette
         * que le mot d'éveil Whisper du desktop.
         */
        private const val WAKE = "rubilax"

        fun matchesWake(raw: String): Boolean {
            val clean = buildString {
                for (ch in raw.lowercase()) {
                    when (ch) {
                        in 'a'..'z' -> append(if (ch == 'y') 'i' else if (ch == 'k') 'x' else ch)
                        'é', 'è', 'ê', 'ë' -> append('e')
                        'à', 'â' -> append('a')
                        'î', 'ï' -> append('i')
                        else -> {} // espaces et ponctuation : compactés
                    }
                }
            }
            if (clean.contains(WAKE) || clean.contains("roubilax")) return true
            // fin distinctive quand l'attaque est avalée
            if (clean.contains("bilax")) return true
            // fenêtres glissantes tolérantes (lev ≤ 2), ancrées sur une
            // attaque plausible pour limiter les faux positifs
            val anchors = listOf("rub", "roub", "rib", "rueb")
            for (start in clean.indices) {
                if (anchors.none { clean.startsWith(it, start) }) continue
                for (len in 6..9) {
                    if (start + len > clean.length) break
                    if (levenshtein(clean.substring(start, start + len), WAKE) <= 2) return true
                }
            }
            return false
        }

        private fun levenshtein(a: String, b: String): Int {
            val prev = IntArray(b.length + 1) { it }
            val cur = IntArray(b.length + 1)
            for (i in 1..a.length) {
                cur[0] = i
                for (j in 1..b.length) {
                    val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                    cur[j] = minOf(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
                }
                cur.copyInto(prev)
            }
            return prev[b.length]
        }
    }

    private var speechService: SpeechService? = null
    private var model: Model? = null
    private var lastFire = 0L
    @Volatile private var stopped = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            stopSelf()
            return
        }
        startInForeground("La braise couve. Dis « Hé Rubilax ».")
        Thread {
            try {
                val dir = ensureModel()
                if (dir != null && !stopped) startListening(dir)
                else if (dir == null) notifyText("Téléchargement du modèle impossible. Réessaie.")
            } catch (_: Exception) {
                notifyText("L'écoute n'a pas pu démarrer. Désactive puis réactive.")
            }
        }.start()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onTaskRemoved(rootIntent: Intent?) {
        val restart = Intent(applicationContext, WakeService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(restart)
        else startService(restart)
        super.onTaskRemoved(rootIntent)
    }

    private fun startInForeground(text: String) {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Mot d'éveil", NotificationManager.IMPORTANCE_MIN)
            )
        }
        startForeground(NOTIF_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )
        return (
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                Notification.Builder(this, CHANNEL_ID)
            else @Suppress("DEPRECATION") Notification.Builder(this)
            )
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Rubilax écoute")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    private fun notifyText(text: String) {
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIF_ID, buildNotification(text))
    }

    /** Télécharge et décompresse le petit modèle FR au premier lancement. */
    private fun ensureModel(): File? {
        val dir = File(filesDir, MODEL_DIR)
        if (File(dir, "am/final.mdl").exists() || File(dir, "final.mdl").exists() ||
            File(dir, "conf/model.conf").exists()
        ) {
            return dir
        }
        notifyText("Première fois : je télécharge mes oreilles (~41 Mo)…")
        val zip = File(cacheDir, "vosk-fr.zip")
        URL(MODEL_URL).openStream().use { input ->
            FileOutputStream(zip).use { output -> input.copyTo(output) }
        }
        notifyText("Installation des oreilles…")
        ZipInputStream(zip.inputStream().buffered()).use { stream ->
            var entry = stream.nextEntry
            while (entry != null) {
                val out = File(filesDir, entry.name)
                if (!out.canonicalPath.startsWith(filesDir.canonicalPath)) {
                    entry = stream.nextEntry
                    continue // zip-slip : on ignore les chemins louches
                }
                if (entry.isDirectory) out.mkdirs()
                else {
                    out.parentFile?.mkdirs()
                    FileOutputStream(out).use { stream.copyTo(it) }
                }
                stream.closeEntry()
                entry = stream.nextEntry
            }
        }
        zip.delete()
        return if (File(dir, "conf/model.conf").exists()) dir else null
    }

    private fun startListening(dir: File) {
        model = Model(dir.absolutePath)
        val recognizer = Recognizer(model, 16000f)
        speechService = SpeechService(recognizer, 16000f)
        speechService?.startListening(object : RecognitionListener {
            override fun onPartialResult(hypothesis: String?) = check(hypothesis)
            override fun onResult(hypothesis: String?) = check(hypothesis)
            override fun onFinalResult(hypothesis: String?) {}
            override fun onError(exception: Exception?) {}
            override fun onTimeout() {}
        })
        notifyText("La braise couve. Dis « Hé Rubilax ».")
    }

    private fun check(hypothesis: String?) {
        val text = hypothesis ?: return
        if (!matchesWake(text)) return
        val now = System.currentTimeMillis()
        if (now - lastFire < 8000) return
        lastFire = now
        vibrate() // « je t'ai entendu, mortel »
        // l'utterance en cours contient « rubilax » et ne se clôt qu'au
        // prochain silence : sans reset, chaque son suivant produirait un
        // partiel contenant encore le mot d'éveil → re-déclenchement
        speechService?.reset()
        // pause pendant que la reconnaissance système écoute la commande
        speechService?.setPause(true)
        val intent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(MainActivity.EXTRA_VOICE, true)
        startActivity(intent)
        android.os.Handler(mainLooper).postDelayed({
            // repartir d'une utterance vierge au retour d'écoute
            speechService?.reset()
            speechService?.setPause(false)
        }, 9000)
    }

    @Suppress("DEPRECATION")
    private fun vibrate() {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (getSystemService(VIBRATOR_MANAGER_SERVICE) as android.os.VibratorManager).defaultVibrator
            } else {
                getSystemService(VIBRATOR_SERVICE) as android.os.Vibrator
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(
                    android.os.VibrationEffect.createOneShot(
                        160, android.os.VibrationEffect.DEFAULT_AMPLITUDE
                    )
                )
            } else {
                vibrator.vibrate(160)
            }
        } catch (_: Exception) {
        }
    }

    override fun onDestroy() {
        stopped = true
        speechService?.stop()
        speechService?.shutdown()
        speechService = null
        model?.close()
        model = null
        super.onDestroy()
    }
}
