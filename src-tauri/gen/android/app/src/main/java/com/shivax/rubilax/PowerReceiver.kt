package com.shivax.rubilax

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Automatisations téléphone → Home Assistant : chargeur branché/débranché,
 * batterie faible/remontée. Lit la configuration écrite par l'app
 * (automations.json) et appelle HA directement.
 *
 * ATTENTION : depuis Android 8, ces broadcasts ne sont PAS livrés aux
 * receivers du manifest — ce receiver doit être enregistré dynamiquement
 * depuis un processus vivant (FendoirOverlayService et MainActivity le font).
 * L'entrée manifest ne sert qu'aux vieux Android.
 */
class PowerReceiver : BroadcastReceiver() {

    companion object {
        val FILTER = IntentFilter().apply {
            addAction(Intent.ACTION_POWER_CONNECTED)
            addAction(Intent.ACTION_POWER_DISCONNECTED)
            addAction(Intent.ACTION_BATTERY_LOW)
            addAction(Intent.ACTION_BATTERY_OKAY)
        }

        // le receiver est enregistré à deux endroits (œil + app ouverte) :
        // on dédoublonne pour ne pas appeler HA deux fois (toggle fragile)
        private val lastFired = HashMap<String, Long>()

        private fun debounced(key: String): Boolean {
            synchronized(lastFired) {
                val now = System.currentTimeMillis()
                if (now - (lastFired[key] ?: 0L) < 3000) return true
                lastFired[key] = now
                return false
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val key = when (intent.action) {
            Intent.ACTION_POWER_CONNECTED -> "power_connected"
            Intent.ACTION_POWER_DISCONNECTED -> "power_disconnected"
            Intent.ACTION_BATTERY_LOW -> "battery_low"
            Intent.ACTION_BATTERY_OKAY -> "battery_okay"
            else -> return
        }
        if (debounced(key)) return
        val config = findConfig(context) ?: return
        val rule = config.optJSONObject(key) ?: return
        val url = rule.optString("url")
        val token = rule.optString("token")
        val domain = rule.optString("domain")
        val service = rule.optString("service")
        val entityId = rule.optString("entity_id")
        if (url.isEmpty() || token.isEmpty() || entityId.isEmpty()) return

        val pending = goAsync()
        Thread {
            try {
                val endpoint = URL(url.trimEnd('/') + "/api/services/" + domain + "/" + service)
                val conn = endpoint.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.connectTimeout = 6000
                conn.readTimeout = 6000
                conn.doOutput = true
                conn.setRequestProperty("Authorization", "Bearer $token")
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write("{\"entity_id\":\"$entityId\"}".toByteArray()) }
                conn.responseCode // force l'exécution
                conn.disconnect()
            } catch (_: Exception) {
                // réseau indisponible : tant pis, pas de retry en v1
            } finally {
                pending.finish()
            }
        }.start()
    }

    private fun findConfig(context: Context): JSONObject? {
        val candidates = mutableListOf(File(context.filesDir, "automations.json"))
        context.dataDir.walkTopDown().maxDepth(4)
            .filter { it.name == "automations.json" }
            .forEach { candidates.add(it) }
        val file = candidates.firstOrNull { it.exists() } ?: return null
        return try {
            JSONObject(file.readText())
        } catch (_: Exception) {
            null
        }
    }
}
