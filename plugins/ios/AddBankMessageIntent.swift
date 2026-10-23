import AppIntents
import Foundation

/**
 * "Add bank message to Arth" - a Shortcuts action. iPhone gives apps no access to messages, so a
 * Shortcuts automation (Message received, containing a phrase from the bank's SMS) runs this
 * action with the message, in the background, without opening Arth.
 *
 * It only appends the message to an inbox file in Arth's Documents folder, one JSON object per
 * line: {"body", "sender", "receivedAt" (ms)}. Arth reads, parses and clears it the next time it's
 * opened (services/message-inbox.ts), through the same SMS reader as Android.
 *
 * Compiled into the app target by plugins/withBankMessageIntent.js: Shortcuts only lists App
 * Intents that are part of the app itself.
 */
@available(iOS 16.0, *)
struct AddBankMessageIntent: AppIntent {
  static var title: LocalizedStringResource = "Add bank message to Arth"
  static var description = IntentDescription(
    "Hands a bank, card or UPI message to Arth, which reads it on this iPhone. It appears in Arth to review the next time you open it."
  )
  static var openAppWhenRun: Bool = false

  @Parameter(title: "Message")
  var message: String

  @Parameter(title: "Sender", default: "")
  var sender: String

  func perform() async throws -> some IntentResult {
    try BankMessageInbox.append(body: message, sender: sender)
    return .result()
  }
}

@available(iOS 16.0, *)
struct ArthAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: AddBankMessageIntent(),
      phrases: ["Add bank message to \(.applicationName)"],
      shortTitle: "Add bank message",
      systemImageName: "indianrupeesign.circle"
    )
  }
}

enum BankMessageInbox {
  static let fileName = "bank-messages.jsonl"

  static func append(body: String, sender: String) throws {
    let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let url = docs.appendingPathComponent(fileName)
    let record: [String: Any] = [
      "body": text,
      "sender": sender.trimmingCharacters(in: .whitespacesAndNewlines),
      "receivedAt": Int64(Date().timeIntervalSince1970 * 1000),
    ]
    var line = try JSONSerialization.data(withJSONObject: record)
    line.append(0x0A)
    if FileManager.default.fileExists(atPath: url.path) {
      let handle = try FileHandle(forWritingTo: url)
      defer { try? handle.close() }
      try handle.seekToEnd()
      try handle.write(contentsOf: line)
    } else {
      try line.write(to: url, options: .atomic)
    }
  }
}
