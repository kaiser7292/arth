package expo.modules.pdfextractor

import android.content.Context
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.text.TextPosition
import org.json.JSONArray
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.TreeMap

/**
 * PdfExtractorModule - Native module for extracting text from PDF files
 *
 * Uses Apache PDFBox (Android port) for PDF reading and decryption.
 *
 * Error codes surfaced to JS via CodedException:
 *  - PASSWORD_REQUIRED   : PDF is encrypted and no password was supplied
 *  - INCORRECT_PASSWORD  : Supplied password does not unlock the PDF
 *  - PDF_LOAD_ERROR      : PDF could not be opened (missing / corrupt / I/O)
 *  - PDF_EXTRACTION_ERROR: Other failure during text extraction
 */
class PdfExtractorModule : Module() {

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is null" }

  override fun definition() = ModuleDefinition {
    Name("PdfExtractor")

    OnCreate {
      try {
        PDFBoxResourceLoader.init(context)
        android.util.Log.d("PdfExtractor", "PDFBox initialized successfully")
      } catch (e: Exception) {
        android.util.Log.e("PdfExtractor", "Failed to initialize PDFBox: ${e.message}")
      }
    }

    AsyncFunction("extractText") { filePath: String, password: String?, promise: Promise ->
      try {
        val text = extractTextFromPdf(filePath, password)
        promise.resolve(text)
      } catch (e: InvalidPasswordException) {
        promise.reject(passwordCodedException(password, e))
      } catch (e: Exception) {
        android.util.Log.e("PdfExtractor", "Error extracting text: ${e.message}", e)
        promise.reject("PDF_EXTRACTION_ERROR", "Failed to extract text: ${e.message}", e)
      }
    }

    Function("isAvailable") {
      return@Function true
    }

    AsyncFunction("getPageCount") { filePath: String, password: String?, promise: Promise ->
      try {
        val pageCount = getPageCountFromPdf(filePath, password)
        promise.resolve(pageCount)
      } catch (e: InvalidPasswordException) {
        promise.reject(passwordCodedException(password, e))
      } catch (e: Exception) {
        promise.reject("PDF_ERROR", "Failed to get page count: ${e.message}", e)
      }
    }

    AsyncFunction("extractTextFromPage") { filePath: String, pageNumber: Int, password: String?, promise: Promise ->
      try {
        val text = extractTextFromPdfPage(filePath, pageNumber, password)
        promise.resolve(text)
      } catch (e: InvalidPasswordException) {
        promise.reject(passwordCodedException(password, e))
      } catch (e: Exception) {
        promise.reject("PDF_EXTRACTION_ERROR", "Failed to extract page: ${e.message}", e)
      }
    }

    AsyncFunction("isPasswordProtected") { filePath: String, promise: Promise ->
      try {
        getInputStream(filePath).use { stream ->
          PDDocument.load(stream, "").close()
        }
        promise.resolve(false)
      } catch (e: InvalidPasswordException) {
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("PDF_LOAD_ERROR", "Failed to inspect PDF: ${e.message}", e)
      }
    }

    /**
     * Coordinate-based structured text extraction.
     *
     * Groups each character's TextPosition by its Y-coordinate (±4pt tolerance)
     * to reconstruct rows, then sorts within each row by X and splits into
     * columns wherever the horizontal gap exceeds 15pt.
     *
     * Returns a JSON string: [[col1, col2, ...], [col1, col2, ...], ...]
     * where each inner array is one visual row from the PDF.
     */
    AsyncFunction("extractRows") { filePath: String, password: String?, promise: Promise ->
      try {
        val rows = extractStructuredRows(filePath, password)
        val json = JSONArray()
        for (row in rows) {
          val rowArr = JSONArray()
          for (col in row) rowArr.put(col)
          json.put(rowArr)
        }
        promise.resolve(json.toString())
      } catch (e: InvalidPasswordException) {
        promise.reject(passwordCodedException(password, e))
      } catch (e: Exception) {
        android.util.Log.e("PdfExtractor", "Error extracting rows: ${e.message}", e)
        promise.reject("PDF_EXTRACTION_ERROR", "Failed to extract rows: ${e.message}", e)
      }
    }
  }

  private fun passwordCodedException(password: String?, cause: Throwable): CodedException =
    if (password.isNullOrEmpty()) {
      CodedException("PASSWORD_REQUIRED", "PDF requires a password", cause)
    } else {
      CodedException("INCORRECT_PASSWORD", "Provided password is incorrect", cause)
    }

  private fun extractTextFromPdf(filePath: String, password: String?): String {
    return getInputStream(filePath).use { stream ->
      PDDocument.load(stream, password ?: "").use { document ->
        PDFTextStripper().apply {
          sortByPosition = true
          addMoreFormatting = false
        }.getText(document)
      }
    }
  }

  private fun getPageCountFromPdf(filePath: String, password: String?): Int {
    return getInputStream(filePath).use { stream ->
      PDDocument.load(stream, password ?: "").use { document ->
        document.numberOfPages
      }
    }
  }

  private fun extractTextFromPdfPage(filePath: String, pageNumber: Int, password: String?): String {
    return getInputStream(filePath).use { stream ->
      PDDocument.load(stream, password ?: "").use { document ->
        if (pageNumber < 1 || pageNumber > document.numberOfPages) {
          throw IllegalArgumentException("Page $pageNumber out of range (1-${document.numberOfPages})")
        }
        PDFTextStripper().apply {
          sortByPosition = true
          startPage = pageNumber
          endPage = pageNumber
        }.getText(document)
      }
    }
  }

  private fun extractStructuredRows(filePath: String, password: String?): List<List<String>> {
    return getInputStream(filePath).use { stream ->
      PDDocument.load(stream, password ?: "").use { document ->
        val stripper = StructuredTextStripper()
        stripper.sortByPosition = true
        stripper.getText(document) // triggers writeString, populating rowData
        stripper.buildColumns()
      }
    }
  }

  private fun getInputStream(filePath: String): InputStream {
    return when {
      filePath.startsWith("content://") -> {
        val uri = Uri.parse(filePath)
        context.contentResolver.openInputStream(uri)
          ?: throw IllegalArgumentException("Cannot open content URI: $filePath")
      }
      filePath.startsWith("file://") -> {
        File(filePath.removePrefix("file://")).inputStream()
      }
      else -> File(filePath).inputStream()
    }
  }
}

/**
 * PDFTextStripper subclass that captures every character's (x, y) coordinates
 * and reconstructs table structure by grouping into rows (Y-tolerance 4pt) and
 * splitting columns where the horizontal gap between adjacent characters > 15pt.
 */
private class StructuredTextStripper : PDFTextStripper() {

  // Keyed by Y-position bucket; each bucket is a list of characters on that row
  val rowData = TreeMap<Float, MutableList<TextPosition>>()

  private val ROW_TOLERANCE = 4.0f

  @Throws(IOException::class)
  override fun writeString(text: String, textPositions: List<TextPosition>) {
    for (pos in textPositions) {
      val y = pos.yDirAdj
      // Find an existing row bucket within tolerance, or create a new one
      val rowKey = rowData.keys.find { kotlin.math.abs(it - y) < ROW_TOLERANCE } ?: y
      rowData.getOrPut(rowKey) { mutableListOf() }.add(pos)
    }
  }

  /**
   * After getText() has been called, build the column-split row list.
   * Columns are split wherever the X-gap between consecutive characters exceeds
   * COL_GAP_THRESHOLD points.
   */
  fun buildColumns(colGapThreshold: Float = 15.0f): List<List<String>> {
    return rowData.values.mapNotNull { positions ->
      val sorted = positions.sortedBy { it.xDirAdj }
      val columns = mutableListOf<String>()
      val current = StringBuilder()
      var lastX = -1f

      for (pos in sorted) {
        val x = pos.xDirAdj
        if (lastX >= 0 && (x - lastX) > colGapThreshold) {
          val s = current.toString().trim()
          if (s.isNotEmpty()) columns.add(s)
          current.clear()
        }
        current.append(pos.unicode)
        lastX = x + pos.widthDirAdj
      }
      val s = current.toString().trim()
      if (s.isNotEmpty()) columns.add(s)

      if (columns.isEmpty()) null else columns
    }
  }
}
