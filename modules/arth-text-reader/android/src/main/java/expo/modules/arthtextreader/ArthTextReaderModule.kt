package expo.modules.arthtextreader

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.Rect
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Reads the text in an image on the device with ML Kit, line by line, with each line's box - and
 * each word's - as a fraction of the image (0..1, top-left origin). Positions let the reader drop
 * the status bar, find the amount (usually the largest text) and let the user pick words of a line.
 * Nothing leaves the phone.
 *
 * ML Kit's Latin model has no rupee sign: it reads "₹" as 7 (or %, Z, F). An amount starting with
 * one of those has that one character checked against the picture (RupeeSign) and corrected.
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
            val pixels = lazy { UprightPixels.load(context, uri, image.rotationDegrees, w, h) }
            val lines = mutableListOf<Map<String, Any>>()
            try {
              for (block in result.textBlocks) {
                for (line in block.lines) {
                  val box = line.boundingBox ?: continue
                  val words = mutableListOf<Map<String, Any>>()
                  var changed = false
                  val elements = line.elements
                  for ((i, el) in elements.withIndex()) {
                    val eb = el.boundingBox ?: continue
                    var text = el.text
                    val next = elements.getOrNull(i + 1)?.text
                    if (RupeeSign.isSuspect(text, next)) {
                      val glyph = firstSymbolBox(el, eb)
                      if (pixels.value?.let { RupeeSign.looksLikeRupee(it, glyph) } == true) {
                        text = "₹" + text.substring(1)
                        changed = true
                      }
                    }
                    words.add(box(text, eb, w, h))
                  }
                  val text = if (changed) words.joinToString(" ") { it["text"] as String } else line.text
                  lines.add(box(text, box, w, h) + mapOf("words" to words))
                }
              }
            } finally {
              if (pixels.isInitialized()) pixels.value?.bitmap?.recycle()
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

  private fun box(text: String, r: Rect, w: Double, h: Double): Map<String, Any> = mapOf(
    "text" to text,
    "x" to r.left / w,
    "y" to r.top / h,
    "width" to r.width() / w,
    "height" to r.height() / h,
  )

  /** The first character's box; without per-character boxes, its share of the word's width. */
  private fun firstSymbolBox(el: Text.Element, eb: Rect): Rect {
    el.symbols.firstOrNull()?.boundingBox?.let { return it }
    val n = el.text.length.coerceAtLeast(1)
    return Rect(eb.left, eb.top, eb.left + eb.width() / n, eb.bottom)
  }
}

/** The picture as upright pixels, scaled down to at most 2400 px on its long side. */
class UprightPixels(val bitmap: Bitmap, private val scale: Double) {
  /** A box in recognition coordinates, in this bitmap's pixels. */
  fun map(r: Rect): Rect = Rect(
    (r.left * scale).toInt(), (r.top * scale).toInt(), (r.right * scale).toInt(), (r.bottom * scale).toInt(),
  )

  companion object {
    fun load(context: Context, uri: Uri, rotation: Int, uprightWidth: Double, uprightHeight: Double): UprightPixels? = try {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
      var sample = 1
      while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 2400) sample *= 2
      val raw = context.contentResolver.openInputStream(uri)?.use {
        BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
      }
      raw?.let {
        val upright = if (rotation != 0) {
          Bitmap.createBitmap(it, 0, 0, it.width, it.height, Matrix().apply { postRotate(rotation.toFloat()) }, true)
            .also { r -> if (r !== it) it.recycle() }
        } else it
        UprightPixels(upright, upright.width / uprightWidth)
      }
    } catch (e: Exception) {
      null
    }
  }
}

/**
 * Is this "7" a rupee sign? The rupee sign has two full-width bars across its top part (the top
 * line and the one under the curve); a 7 has one. Tested on 79 fonts, regular and bold, light and
 * dark, 14-60 px: 98% of rupee signs found, and no 7 ever taken for one.
 */
object RupeeSign {
  private val AMOUNT = Regex("^[7%ZzFf](?:\\d{1,3}(?:,\\d{2,3})+|\\d+)(?:\\.\\d{1,2})?$")
  private val NUMBER = Regex("^\\d{1,3}(?:,\\d{2,3})*(?:\\.\\d{1,2})?$|^\\d+(?:\\.\\d{1,2})?$")

  /** "7345", "%1,200.50", or a lone "7" before an amount ("7 15,000"). */
  fun isSuspect(text: String, next: String?): Boolean =
    AMOUNT.matches(text) || (text == "7" && next != null && NUMBER.matches(next))

  fun looksLikeRupee(px: UprightPixels, glyphBox: Rect): Boolean {
    val b = px.bitmap
    val r = px.map(glyphBox)
    val x0 = r.left.coerceIn(0, b.width - 1)
    val y0 = r.top.coerceIn(0, b.height - 1)
    val x1 = r.right.coerceIn(x0 + 1, b.width)
    val y1 = r.bottom.coerceIn(y0 + 1, b.height)
    val w = x1 - x0
    val h = y1 - y0
    if (w < 4 || h < 6) return false
    val argb = IntArray(w * h)
    b.getPixels(argb, 0, w, x0, y0, w, h)
    val gray = IntArray(w * h) { i ->
      val c = argb[i]
      (((c shr 16) and 0xff) * 299 + ((c shr 8) and 0xff) * 587 + (c and 0xff) * 114) / 1000
    }
    // Otsu's threshold, and which side is ink: the background is what the box's edges are.
    val hist = IntArray(256)
    for (v in gray) hist[v]++
    val total = gray.size
    var sumAll = 0L
    for (i in 0 until 256) sumAll += i.toLong() * hist[i]
    var wb = 0
    var sb = 0L
    var best = 0.0
    var t = 128
    for (i in 0 until 256) {
      wb += hist[i]
      if (wb == 0) continue
      val wf = total - wb
      if (wf == 0) break
      sb += i.toLong() * hist[i]
      val mb = sb.toDouble() / wb
      val mf = (sumAll - sb).toDouble() / wf
      val between = wb.toDouble() * wf * (mb - mf) * (mb - mf)
      if (between > best) {
        best = between
        t = i
      }
    }
    val edge = ArrayList<Int>(2 * (w + h))
    for (x in 0 until w) {
      edge.add(gray[x]); edge.add(gray[(h - 1) * w + x])
    }
    for (y in 0 until h) {
      edge.add(gray[y * w]); edge.add(gray[y * w + w - 1])
    }
    edge.sort()
    val inkDark = edge[edge.size / 2] > t
    val ink = BooleanArray(w * h) { i -> if (inkDark) gray[i] <= t else gray[i] > t }
    // The glyph's own extent inside the (often padded) box.
    var top = -1
    var bottom = -1
    var left = w
    var right = -1
    for (y in 0 until h) for (x in 0 until w) if (ink[y * w + x]) {
      if (top < 0) top = y
      bottom = y
      if (x < left) left = x
      if (x > right) right = x
    }
    if (top < 0) return false
    val gh = bottom - top + 1
    val gw = right - left + 1
    if (gh < 6 || gw < 4) return false
    // Count full-width bars in the top 60%.
    var bars = 0
    var inBar = false
    for (y in top until top + (gh * 0.6).toInt()) {
      var n = 0
      for (x in left..right) if (ink[y * w + x]) n++
      if (n.toDouble() / gw >= 0.7) {
        if (!inBar) {
          bars++
          inBar = true
        }
      } else {
        inBar = false
      }
    }
    return bars >= 2
  }
}
