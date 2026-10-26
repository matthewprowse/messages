import Foundation

// The relay protocol, version 1, as apps/worker/src/reminders/protocol.ts has it:
//
//   POST /v1/reminders/sync           SyncPayload
//   GET  /v1/reminders/updates?wait=  UpdatesResponse, held up to 25 seconds
//   POST /v1/reminders/updates/<id>   Report
//
// Every request carries Authorization: Bearer <relay token>. Only counts and codes are ever logged.

public let protocolVersion = 1

public struct SyncPayload: Encodable, Equatable {
  public let version = protocolVersion
  /// "denied" when this Mac has not allowed the relay to read Reminders. Nothing else is sent then.
  public var access: String
  /// The Mac's own zone, for a time with none.
  public var timeZone: String
  public var lists: [List]
  public var reminders: [Reminder]

  public init(access: String, timeZone: String, lists: [List], reminders: [Reminder]) {
    self.access = access
    self.timeZone = timeZone
    self.lists = lists
    self.reminders = reminders
  }

  public static func denied(timeZone: String) -> SyncPayload {
    SyncPayload(access: "denied", timeZone: timeZone, lists: [], reminders: [])
  }

  private enum CodingKeys: String, CodingKey { case version, access, timeZone, lists, reminders }

  public struct List: Encodable, Equatable {
    public var id: String
    public var name: String
    public init(id: String, name: String) {
      self.id = id
      self.name = name
    }
  }

  public struct Reminder: Encodable, Equatable {
    public var id: String
    public var listId: String
    public var title: String
    public var notes: String?
    public var due: Due?
    public var completed: Bool
    public var completedAt: String?
    /// EventKit's own 0 to 9: 0 none, 1 to 4 high, 5 medium, 6 to 9 low. The worker maps it.
    public var priority: Int

    public init(id: String, listId: String, title: String, notes: String?, due: Due?, completed: Bool, completedAt: String?, priority: Int) {
      self.id = id
      self.listId = listId
      self.title = title
      self.notes = notes
      self.due = due
      self.completed = completed
      self.completedAt = completedAt
      self.priority = priority
    }
  }
}

/// A due date as EventKit keeps it: a day, and maybe a time on it, in a zone or floating.
public struct Due: Encodable, Equatable {
  public var date: String
  public var time: String?
  public var timeZone: String?

  public init(date: String, time: String? = nil, timeZone: String? = nil) {
    self.date = date
    self.time = time
    self.timeZone = timeZone
  }

  /// From a reminder's dueDateComponents. No day is no due date; no hour is a whole day.
  public init?(components: DateComponents?) {
    guard let c = components, let year = c.year, let month = c.month, let day = c.day else { return nil }
    date = String(format: "%04d-%02d-%02d", year, month, day)
    guard let hour = c.hour else { return }
    time = String(format: "%02d:%02d:%02d", hour, c.minute ?? 0, c.second ?? 0)
    timeZone = c.timeZone?.identifier
  }
}

/// The id a reminder is known by in Konva: iCloud's own id, the same on every device, else this Mac's.
public func reminderId(external: String?, local: String) -> String {
  if let external, !external.isEmpty { return external }
  return local
}

/// UTC, the way the worker reads it: 2026-10-24T08:00:00Z.
public func isoTime(_ date: Date?) -> String? {
  guard let date else { return nil }
  let format = ISO8601DateFormatter()
  format.formatOptions = [.withInternetDateTime]
  return format.string(from: date)
}

public struct UpdatesResponse: Decodable, Equatable {
  public var updates: [Update]
}

public struct Update: Decodable, Equatable {
  public var id: String
  public var reminderId: String
  /// "complete" or "reopen". Anything else is skipped.
  public var action: String

  public init(id: String, reminderId: String, action: String) {
    self.id = id
    self.reminderId = reminderId
    self.action = action
  }

  /// Whether the change ticks the reminder off, or nil for an action this relay does not know.
  public var completes: Bool? {
    switch action {
    case "complete": return true
    case "reopen": return false
    default: return nil
    }
  }
}

/// Why a change could not be made, as a code the worker turns into words. Never free text.
public enum ApplyError: String, Error, Equatable {
  case notFound = "not_found"
  case readOnly = "read_only"
  case denied = "denied"
  case saveFailed = "save_failed"
}

public struct Report: Encodable, Equatable {
  public var ok: Bool
  public var error: String?

  public static let done = Report(ok: true, error: nil)
  public static func failed(_ error: ApplyError) -> Report { Report(ok: false, error: error.rawValue) }
}

/// The relay address: https anywhere, or plain http only to this Mac, so the token never crosses a network unencrypted.
public func relayBaseURL(_ text: String) -> URL? {
  let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
  guard let url = URL(string: trimmed), let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(), url.query == nil else { return nil }
  if scheme == "https" { return url }
  if scheme == "http", ["localhost", "127.0.0.1", "::1"].contains(host) { return url }
  return nil
}

/// A relay token as Konva makes it.
public func looksLikeToken(_ text: String) -> Bool {
  text.hasPrefix("konva_rr_") && text.count >= 40 && text.allSatisfy { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }
}

/// Seconds to wait after the nth failure in a row: 5, 10, 20 and so on, at most 5 minutes.
public func backoffSeconds(failures: Int) -> Double {
  guard failures > 0 else { return 0 }
  return min(300, 5 * pow(2, Double(min(failures - 1, 10))))
}
