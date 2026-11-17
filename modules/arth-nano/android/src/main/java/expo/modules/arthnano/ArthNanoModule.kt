package expo.modules.arthnano

import android.os.Build
import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.TextPart
import com.google.mlkit.genai.prompt.generateContentRequest
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Gemini Nano on the phone, through ML Kit's Prompt API and Android's AICore service. Nothing
 * leaves the device: AICore holds the model and runs it locally.
 *
 * Android only lets the app on screen run it (background calls are refused), so the JS side
 * (services/ai/nano.ts) only calls in while Arth is in the foreground.
 */
class ArthNanoModule : Module() {
  private var model: GenerativeModel? = null

  /** The Prompt API needs Android 8; below it the library is never touched. */
  private val supported get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O

  private fun client(): GenerativeModel = model ?: Generation.getClient().also { model = it }

  override fun definition() = ModuleDefinition {
    Name("ArthNano")
    Events("onDownloadProgress")

    /** "available" | "downloadable" | "downloading" | "unavailable" */
    AsyncFunction("checkStatus") Coroutine { ->
      if (!supported) {
        "unavailable"
      } else {
        try {
          when (client().checkStatus()) {
            FeatureStatus.AVAILABLE -> "available"
            FeatureStatus.DOWNLOADABLE -> "downloadable"
            FeatureStatus.DOWNLOADING -> "downloading"
            else -> "unavailable"
          }
        } catch (e: Exception) {
          "unavailable"
        }
      }
    }

    /** Ask AICore to fetch the model; progress arrives as onDownloadProgress { bytes }. */
    AsyncFunction("download") Coroutine { ->
      if (!supported) throw CodedException("UNSUPPORTED", "Needs Android 8 or later", null)
      var failure: Exception? = null
      client().download().collect { status ->
        when (status) {
          is DownloadStatus.DownloadProgress ->
            sendEvent("onDownloadProgress", mapOf("bytes" to status.totalBytesDownloaded.toDouble()))
          is DownloadStatus.DownloadFailed -> failure = status.e
          else -> Unit
        }
      }
      failure?.let { throw CodedException("DOWNLOAD_FAILED", it.message ?: "Download failed", it) }
      true
    }

    /** Load the model into memory so the first answer comes quicker. */
    AsyncFunction("warmup") Coroutine { ->
      if (!supported) throw CodedException("UNSUPPORTED", "Needs Android 8 or later", null)
      try {
        client().warmup()
      } catch (e: Exception) {
        throw CodedException("WARMUP_FAILED", e.message ?: "Couldn't load the model", e)
      }
      true
    }

    /** One prompt in, one answer out, with the time the model took. */
    AsyncFunction("generate") Coroutine { prompt: String, temp: Double, maxTokens: Int ->
      if (!supported) throw CodedException("UNSUPPORTED", "Needs Android 8 or later", null)
      val started = System.currentTimeMillis()
      val response = try {
        client().generateContent(
          generateContentRequest(TextPart(prompt)) {
            temperature = temp.toFloat()
            candidateCount = 1
            maxOutputTokens = maxTokens
          },
        )
      } catch (e: Exception) {
        throw CodedException("GENERATE_FAILED", e.message ?: "The model couldn't answer", e)
      }
      mapOf(
        "text" to (response.candidates.firstOrNull()?.text ?: ""),
        "ms" to (System.currentTimeMillis() - started).toDouble(),
      )
    }

    OnDestroy {
      model?.close()
      model = null
    }
  }
}
