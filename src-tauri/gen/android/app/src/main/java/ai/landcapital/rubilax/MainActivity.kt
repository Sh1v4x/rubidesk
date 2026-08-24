package ai.landcapital.rubilax

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  companion object {
    init {
      System.loadLibrary("rubilax_lib")
    }
  }

  // fournit la JavaVM et le Context au pont natif Rust (ndk-context)
  private external fun initNdk()

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    initNdk()
    super.onCreate(savedInstanceState)
  }
}
