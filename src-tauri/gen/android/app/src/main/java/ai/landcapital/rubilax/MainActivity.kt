package ai.landcapital.rubilax

import android.content.Intent
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
    private const val REQ_VOICE = 1664
  }

  // fournit la JavaVM et le Context au pont natif Rust (ndk-context)
  private external fun initNdk()

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    initNdk()
    super.onCreate(savedInstanceState)
    QuipReceiver.schedule(this) // les humeurs de Rubilax reprennent
    maybeStartVoice(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    maybeStartVoice(intent)
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
