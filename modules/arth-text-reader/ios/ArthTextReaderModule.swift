import ExpoModulesCore
import Vision
import UIKit

/**
 * Reads the text in an image on the device with Apple Vision, line by line, with each line's box
 * - and each word's - as a fraction of the upright image (0..1, top-left origin; Vision's is
 * bottom-left, flipped here). Accurate mode; language correction off, as it "corrects" reference
 * numbers and amounts into words. Nothing leaves the phone.
 */
public class ArthTextReaderModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArthTextReader")

    AsyncFunction("readText") { (uriString: String, promise: Promise) in
      let url = URL(string: uriString).flatMap { $0.scheme == nil ? nil : $0 } ?? URL(fileURLWithPath: uriString)
      guard let data = try? Data(contentsOf: url),
            let image = UIImage(data: data),
            let cgImage = image.cgImage else {
        promise.reject("READ_FAILED", "Couldn't open the image")
        return
      }
      // The upright size: Vision's boxes are relative to the image as shown, after its orientation.
      let uprightWidth = Double(image.size.width * image.scale)
      let uprightHeight = Double(image.size.height * image.scale)
      let request = VNRecognizeTextRequest { request, error in
        if let error = error {
          promise.reject("READ_FAILED", error.localizedDescription)
          return
        }
        let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
        let lines: [[String: Any]] = observations.compactMap { obs in
          guard let candidate = obs.topCandidates(1).first else { return nil }
          var line = Self.box(candidate.string, obs.boundingBox)
          line["words"] = Self.words(of: candidate)
          return line
        }
        promise.resolve(["lines": lines, "imageWidth": uprightWidth, "imageHeight": uprightHeight])
      }
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = false
      let handler = VNImageRequestHandler(cgImage: cgImage, orientation: Self.orientation(image.imageOrientation), options: [:])
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try handler.perform([request])
        } catch {
          promise.reject("READ_FAILED", error.localizedDescription)
        }
      }
    }
  }

  private static func box(_ text: String, _ b: CGRect) -> [String: Any] {
    return ["text": text, "x": Double(b.minX), "y": Double(1 - b.maxY), "width": Double(b.width), "height": Double(b.height)]
  }

  /** Each space-separated word with its own box, where Vision can give one. */
  private static func words(of candidate: VNRecognizedText) -> [[String: Any]] {
    var out: [[String: Any]] = []
    let s = candidate.string
    var index = s.startIndex
    while index < s.endIndex {
      while index < s.endIndex && s[index].isWhitespace { index = s.index(after: index) }
      guard index < s.endIndex else { break }
      var end = index
      while end < s.endIndex && !s[end].isWhitespace { end = s.index(after: end) }
      let range = index..<end
      if let rect = try? candidate.boundingBox(for: range)?.boundingBox {
        out.append(box(String(s[range]), rect))
      }
      index = end
    }
    return out
  }

  private static func orientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
    switch o {
    case .up: return .up
    case .down: return .down
    case .left: return .left
    case .right: return .right
    case .upMirrored: return .upMirrored
    case .downMirrored: return .downMirrored
    case .leftMirrored: return .leftMirrored
    case .rightMirrored: return .rightMirrored
    @unknown default: return .up
    }
  }
}
