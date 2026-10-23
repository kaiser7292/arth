package expo.modules.arthtextreader

import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Reads the text in an image on the device with ML Kit, line by line, with each line's box as a
 * fraction of the image (0..1, top-left origin). Positions let the reader drop the status bar and
 * find the amount (usually the largest text). Nothing leaves the phone.
 */
class ArthTextReaderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ArthTextReader")

    AsyncFunction("readText") { uriString: String, promise: Promise ->
      try {
        val context = appContext.reactContext ?: throw Exception("No context")
        val uri = when {
          uriString.startsWith("content://") || uriString.startsWith("file://") -> Uri.parse(uriString)
          else -> {
            val file = File(uriString)
            if (!file.exists()) throw Exception("File not found: $uriString")
            Uri.fromFile(file)
          }
        }
        val image = InputImage.fromFilePath(context, uri)
        // Boxes come back in the upright image's coordinates.
        val rotated = image.rotationDegrees == 90 || image.rotationDegrees == 270
        val w = (if (rotated) image.height else image.width).toDouble().coerceAtLeast(1.0)
        val h = (if (rotated) image.width else image.height).toDouble().coerceAtLeast(1.0)
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        recognizer.process(image)
          .addOnSuccessListener { result ->
            val lines = mutableListOf<Map<String, Any>>()
            for (block in result.textBlocks) {
              for (line in block.lines) {
                val box = line.boundingBox ?: continue
                lines.add(
                  mapOf(
                    "text" to line.text,
                    "x" to box.left / w,
                    "y" to box.top / h,
                    "width" to box.width() / w,
                    "height" to box.height() / h,
                  )
                )
              }
            }
            recognizer.close()
            promise.resolve(mapOf("lines" to lines, "imageWidth" to w, "imageHeight" to h))
          }
          .addOnFailureListener { error ->
            recognizer.close()
            promise.reject(CodedException("READ_FAILED", error.message ?: "Couldn't read the image", error))
          }
      } catch (error: Exception) {
        promise.reject(CodedException("READ_FAILED", error.message ?: "Couldn't read the image", error))
      }
    }
  }
}
