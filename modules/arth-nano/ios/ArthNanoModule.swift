import ExpoModulesCore
#if canImport(FoundationModels)
import FoundationModels
#endif

/// On-device AI on iPhone: Apple's Foundation Models (Apple Intelligence, iOS 26 and later), behind
/// the same interface as the Android module (Gemini Nano through ML Kit), so services/ai/nano.ts
/// asks either the same way. Nothing leaves the phone.
///
/// Status, in the Android words the app already uses:
///   available    — Apple Intelligence is on and the model is ready
///   downloadable — Apple Intelligence is off: the person turns it on in the iPhone's Settings
///                  (Arth can't do that for them, so download() does nothing)
///   downloading  — it's on, and the iPhone is still getting the model ready
///   unavailable  — this iPhone or iOS can't run it
public class ArthNanoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArthNano")

    // Same events as Android; never sent here, since the iPhone fetches the model itself.
    Events("onDownloadProgress")

    AsyncFunction("checkStatus") { () -> String in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        switch SystemLanguageModel.default.availability {
        case .available:
          return "available"
        case .unavailable(let reason):
          switch reason {
          case .appleIntelligenceNotEnabled:
            return "downloadable"
          case .modelNotReady:
            return "downloading"
          default:
            return "unavailable"
          }
        }
      }
      #endif
      return "unavailable"
    }

    AsyncFunction("download") { () -> Bool in
      // Apple Intelligence is switched on in Settings → Apple Intelligence & Siri, not by apps.
      return false
    }

    AsyncFunction("warmup") { () -> Bool in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        // Each question uses its own session, so there's nothing to keep warm: just say whether
        // the model is ready.
        guard case .available = SystemLanguageModel.default.availability else { return false }
        return true
      }
      #endif
      return false
    }

    AsyncFunction("generate") { (prompt: String, temperature: Double, maxOutputTokens: Int) async throws -> [String: Any] in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        guard case .available = SystemLanguageModel.default.availability else {
          throw ModelUnavailableException()
        }
        let started = Date()
        // A fresh session per question: every prompt Arth sends stands alone.
        let session = LanguageModelSession()
        let options = GenerationOptions(temperature: temperature, maximumResponseTokens: max(1, maxOutputTokens))
        let response = try await session.respond(to: prompt, options: options)
        return ["text": response.content, "ms": Int(Date().timeIntervalSince(started) * 1000)]
      }
      #endif
      throw ModelUnavailableException()
    }
  }
}

final class ModelUnavailableException: Exception {
  override var reason: String {
    "Apple Intelligence isn't ready on this iPhone."
  }
}
