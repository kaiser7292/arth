import AppIntents
import Foundation
import UserNotifications

/**
 * Shortcuts actions for bank messages. iPhone gives apps no access to messages, so a Shortcuts
 * automation (Message received, containing a phrase from the bank's SMS) hands each one to Arth.
 *
 * Both actions append the message to an inbox file in Arth's Documents folder, one JSON object per
 * line: {"body", "sender", "receivedAt" (ms)}. Arth reads, parses and clears it when it opens
 * (services/message-inbox.ts), through the same SMS reader as Android.
 *
 *   "Add bank message to Arth"     - for the automation: runs in the background and posts a
 *                                    notification ("₹185 debited · ••8689"), unless switched off
 *                                    in Arth. Tapping it opens "Just arrived".
 *   "Review bank message in Arth"  - for running by hand (a copied message): opens Arth straight
 *                                    on "Just arrived".
 *
 * Compiled into the app target by plugins/withBankMessageIntent.js: Shortcuts only lists App
 * Intents that are part of the app itself.
 */
@available(iOS 16.0, *)
struct AddBankMessageIntent: AppIntent {
  static var title: LocalizedStringResource = "Add bank message to Arth"
  static var description = IntentDescription(
    "Hands a bank, card or UPI message to Arth in the background, and lets you know it arrived. Arth reads it on this iPhone."
  )
  static var openAppWhenRun: Bool = false

  @Parameter(title: "Message")
  var message: String

  @Parameter(title: "Sender", default: "")
  var sender: String

  func perform() async throws -> some IntentResult {
    // The setup uses ONE automation that passes every message on (no "Message Contains"), so
    // anything that isn't a transaction - chats, OTPs, offers - is dropped here, unsaved.
    guard BankMessageInbox.looksLikeTransaction(message) else { return .result() }
    guard try BankMessageInbox.append(body: message, sender: sender) else { return .result() }
    if BankMessageInbox.notifyEnabled() {
      await BankMessageInbox.notify(about: message)
    }
    return .result()
  }
}

@available(iOS 16.0, *)
struct ReviewBankMessageIntent: AppIntent {
  static var title: LocalizedStringResource = "Review bank message in Arth"
  static var description = IntentDescription(
    "Opens Arth with a bank, card or UPI message, to see what Arth read from it and approve it."
  )
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Message")
  var message: String

  func perform() async throws -> some IntentResult {
    if try BankMessageInbox.append(body: message, sender: "") {
      BankMessageInbox.requestOpen()
    }
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
    AppShortcut(
      intent: ReviewBankMessageIntent(),
      phrases: ["Review bank message in \(.applicationName)"],
      shortTitle: "Review bank message",
      systemImageName: "text.magnifyingglass"
    )
  }
}

enum BankMessageInbox {
  static let fileName = "bank-messages.jsonl"
  /** {"notify": bool}, written by Arth (services/message-inbox.ts). Missing = notify. */
  static let settingsFileName = "bank-messages-settings.json"
  /** Left by "Review bank message in Arth"; Arth opens "Just arrived" and deletes it. */
  static let openRequestFileName = "bank-messages-open"

  static var docs: URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
  }

  /** Appends the message; false when it was empty. */
  @discardableResult
  static func append(body: String, sender: String) throws -> Bool {
    let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return false }
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
    return true
  }

  static func requestOpen() {
    try? Data().write(to: docs.appendingPathComponent(openRequestFileName), options: .atomic)
  }

  static func notifyEnabled() -> Bool {
    let url = docs.appendingPathComponent(settingsFileName)
    guard
      let data = try? Data(contentsOf: url),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let on = json["notify"] as? Bool
    else { return true }
    return on
  }

  /** A local notification with a quick read of the message; Arth does the full reading. */
  static func notify(about message: String) async {
    let content = UNMutableNotificationContent()
    content.title = headline(of: message)
    content.body = "Tap to review in Arth"
    content.sound = .default
    content.threadIdentifier = "bank-messages"
    // Read by the root layout's notification-tap handler (expo-notifications passes a local
    // notification's userInfo through as its data); the screen must be in ALLOWED_DEEP_LINK_SCREENS.
    content.userInfo = ["screen": "expense/just-arrived"]
    let request = UNNotificationRequest(identifier: "bank-message-\(UUID().uuidString)", content: content, trigger: nil)
    try? await UNUserNotificationCenter.current().add(request)
  }

  /** "₹185 debited · ••8689", "₹82,000 credited", or "Bank message received". */
  static func headline(of message: String) -> String {
    let text = message.replacingOccurrences(of: "\n", with: " ")
    var parts: [String] = []
    if let amount = firstMatch(#"(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)"#, in: text) {
      let tidy = amount.hasSuffix(".00") ? String(amount.dropLast(3)) : amount
      let credit = firstMatch(#"\b(credited|received|deposited|refund)"#, in: text) != nil
      let debit = firstMatch(#"\b(debited|spent|paid|sent|withdrawn|purchase)"#, in: text) != nil
      parts.append("₹\(tidy)" + (debit ? " debited" : credit ? " credited" : ""))
    }
    if let last4 = firstMatch(#"(?:x{2,}|\*{2,}|ending\s*(?:with\s*)?|a/c\s*(?:no\.?)?\s*[x*]*)\s*([0-9]{4})\b"#, in: text) {
      parts.append("••\(last4)")
    }
    return parts.isEmpty ? "Bank message received" : parts.joined(separator: " · ")
  }

  /**
   * An amount and a word that moves money: "Rs.500 debited from A/c XX1234", "INR 82,000 credited",
   * "₹185 paid to Zepto via UPI". Chats, OTPs ("OTP for Rs 500 is...") and offers ("get Rs 100
   * cashback") don't pass. Deliberately loose otherwise: Arth decides properly when it reads it.
   */
  static func looksLikeTransaction(_ message: String) -> Bool {
    let text = message.replacingOccurrences(of: "\n", with: " ")
    guard firstMatch(#"(?:₹|rs\.?|inr)\s*([0-9][0-9,]*)"#, in: text) != nil else { return false }
    if firstMatch(#"\b(otp|one[\s-]?time\s+password|verification\s+code)\b"#, in: text) != nil { return false }
    return firstMatch(
      #"\b(debited|credited|spent|paid|sent|received|withdrawn|deposited|transferred|purchase|refund(?:ed)?|txn|transaction)\b"#,
      in: text
    ) != nil
  }

  /** The first capture group of the first case-insensitive match. */
  static func firstMatch(_ pattern: String, in text: String) -> String? {
    guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
    let range = NSRange(text.startIndex..., in: text)
    guard let m = re.firstMatch(in: text, range: range), m.numberOfRanges > 1,
          let r = Range(m.range(at: 1), in: text) else { return nil }
    return String(text[r])
  }
}
