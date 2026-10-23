import ExpoModulesCore
import Vision
import UIKit

/**
 * Reads the text in an image on the device with Apple Vision, line by line, with each line's box
 * as a fraction of the image (0..1, top-left origin - Vision's is bottom-left, flipped here).
 * Accurate mode; language correction off, as it "corrects" reference numbers and amounts into words.
 */
public class ArthTextReaderModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArthTextReader")

    AsyncFunction("readText") { (uriString: String, promise: Promise) in
      let url = URL(string: uriString).flatMap { $0.scheme == nil ? nil : $0 } ?? URL(fileURLWithPath: uriString)
      guard let data = try? Data(contentsOf: url),
            let image = UIImage(data: data),
            let cgImage = image.cgImage else {
        promise.reject(Exception(name: "READ_FAILED", description: "Couldn't open the image"))
        return
      }
      let request = VNRecognizeTextRequest { request, error in
        if let error = error {
          promise.reject(Exception(name: "READ_FAILED", description: error.localizedDescription))
          return
        }
        let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
        let lines: [[String: Any]] = observations.compactMap { obs in
          guard let text = obs.topCandidates(1).first?.string else { return nil }
          let b = obs.boundingBox
          return ["text": text, "x": b.minX, "y": 1 - b.maxY, "width": b.width, "height": b.height]
        }
        promise.resolve(["lines": lines, "imageWidth": cgImage.width, "imageHeight": cgImage.height])
      }
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = false
      let handler = VNImageRequestHandler(cgImage: cgImage, orientation: Self.orientation(image.imageOrientation), options: [:])
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try handler.perform([request])
        } catch {
          promise.reject(Exception(name: "READ_FAILED", description: error.localizedDescription))
        }
      }
    }
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
