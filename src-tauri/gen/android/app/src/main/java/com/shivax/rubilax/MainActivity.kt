package com.shivax.rubilax

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognizerIntent
import androidx.activity.enableEdgeToEdge
import java.io.File

class MainActivity : TauriActivity() {
  companion object {
    init {
      System.loadLibrary("rubilax_lib")
    }

    /** extra posé par l'œil flottant ou le bouton micro : ouvrir en écoute */
    const val EXTRA_VOICE = "rubilax_voice"
    /** extra posé par le pont Rust : demander la permission micro puis
     *  démarrer le service du mot d'éveil */
    const val EXTRA_REQ_MIC = "rubilax_req_mic"
    private const val REQ_VOICE = 1664
    private const val REQ_MIC = 1665
  }

  // fournit la JavaVM et le Context au pont natif Rust (ndk-context)
  private external fun initNdk()

  private val powerReceiver = PowerReceiver()

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    initNdk()
    super.onCreate(savedInstanceState)
    QuipReceiver.schedule(this) // les humeurs de Rubilax reprennent
    maybeRequestMic(intent)
    // automatisations chargeur/batterie aussi quand l'app est ouverte
    // sans l'œil flottant (PowerReceiver dédoublonne si les deux vivent)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(powerReceiver, PowerReceiver.FILTER, RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      registerReceiver(powerReceiver, PowerReceiver.FILTER)
    }
    maybeStartVoice(intent)
  }

  override fun onDestroy() {
    try {
      unregisterReceiver(powerReceiver)
    } catch (_: Exception) {
    }
    super.onDestroy()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    maybeStartVoice(intent)
    maybeRequestMic(intent)
  }

  /** Permission micro pour le mot d'éveil, puis démarrage du service. */
  private fun maybeRequestMic(intent: Intent?) {
    if (intent?.getBooleanExtra(EXTRA_REQ_MIC, false) != true) return
    intent.removeExtra(EXTRA_REQ_MIC)
    if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) ==
      android.content.pm.PackageManager.PERMISSION_GRANTED
    ) {
      startForegroundService(Intent(this, WakeService::class.java))
    } else {
      requestPermissions(arrayOf(android.Manifest.permission.RECORD_AUDIO), REQ_MIC)
    }
  }

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray,
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode == REQ_MIC &&
      grantResults.firstOrNull() == android.content.pm.PackageManager.PERMISSION_GRANTED
    ) {
      startForegroundService(Intent(this, WakeService::class.java))
    }
  }

  /** Ouvre la reconnaissance vocale système (dialogue micro Android, fr-FR). */
  private fun maybeStartVoice(intent: Intent?) {
    if (intent?.getBooleanExtra(EXTRA_VOICE, false) != true) return
    intent.removeExtra(EXTRA_VOICE)
    val rec = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, "fr-FR")
      putExtra(RecognizerIntent.EXTRA_PROMPT, "Parle, mortel.")
    }
    try {
      @Suppress("DEPRECATION")
      startActivityForResult(rec, REQ_VOICE)
    } catch (_: Exception) {
      // aucun service de reconnaissance sur l'appareil : on laisse l'app s'ouvrir
    }
  }

  @Suppress("DEPRECATION")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != REQ_VOICE || resultCode != RESULT_OK) return
    val text = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
    if (!text.isNullOrBlank()) {
      // relevé par la commande Tauri voice_take_pending côté web
      File(filesDir, "voice_command.txt").writeText(text)
    }
  }
}
