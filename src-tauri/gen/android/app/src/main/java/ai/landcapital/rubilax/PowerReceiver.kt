package ai.landcapital.rubilax

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Automatisations « chargeur branché / débranché » : lit la configuration
 * écrite par l'app (automations.json) et appelle Home Assistant directement —
 * fonctionne même si l'app est fermée (broadcast exempté depuis Android 8).
 */
class PowerReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val key = when (intent.action) {
            Intent.ACTION_POWER_CONNECTED -> "power_connected"
            Intent.ACTION_POWER_DISCONNECTED -> "power_disconnected"
            else -> return
        }
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
