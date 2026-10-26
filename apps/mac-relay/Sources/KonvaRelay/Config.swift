import Foundation
import RelayCore

// Where the relay keeps its pairing and its last result: ~/Library/Application Support/Konva Relay. The folder and
// files are readable by this macOS user only (0700 and 0600), like an SSH key, since the token is a credential.

enum Paths {
  static let folder = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Konva Relay")
  static let config = folder.appendingPathComponent("config.json")
  static let status = folder.appendingPathComponent("status.json")
  static let logs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Konva Relay.log")
  static let agent = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/app.konva.relay.plist")

  static func ensureFolder() throws {
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  }
}

struct Config: Codable {
  var relayUrl: String
  var token: String

  var baseURL: URL? { relayBaseURL(relayUrl) }

  static func load() throws -> Config {
    guard let data = try? Data(contentsOf: Paths.config) else { throw RelayFailure.notPaired }
    return try JSONDecoder().decode(Config.self, from: data)
  }

  func save() throws {
    try Paths.ensureFolder()
    let data = try JSONEncoder().encode(self)
    FileManager.default.createFile(atPath: Paths.config.path, contents: nil, attributes: [.posixPermissions: 0o600])
    try data.write(to: Paths.config, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: Paths.config.path)
  }

  static func forget() {
    try? FileManager.default.removeItem(at: Paths.config)
    try? FileManager.default.removeItem(at: Paths.status)
  }
}

/// The last sync, for `konva-relay status`. Counts and codes only.
struct Status: Codable {
  var lastSyncAt: String?
  var reminders: Int?
  var lastError: String?

  static func load() -> Status? {
    guard let data = try? Data(contentsOf: Paths.status) else { return nil }
    return try? JSONDecoder().decode(Status.self, from: data)
  }

  func save() {
    guard (try? Paths.ensureFolder()) != nil, let data = try? JSONEncoder().encode(self) else { return }
    try? data.write(to: Paths.status, options: .atomic)
  }
}

enum RelayFailure: Error, CustomStringConvertible {
  case notPaired
  case badAddress
  case unknownToken
  case rateLimited(seconds: Double)
  case server(status: Int)
  case unreachable

  var description: String {
    switch self {
    case .notPaired: return "Not paired yet. Run konva-relay setup first."
    case .badAddress: return "The relay address must start with https://, or http://localhost on this Mac."
    case .unknownToken: return "Konva did not recognise this token. It may have been replaced, or sync is paused. Make a new one in Settings, then run konva-relay setup."
    case .rateLimited: return "Konva asked the relay to slow down."
    case let .server(status): return "Konva answered with an error (HTTP \(status))."
    case .unreachable: return "Konva could not be reached."
    }
  }

  /// A short code for status.json.
  var code: String {
    switch self {
    case .notPaired: return "not_paired"
    case .badAddress: return "bad_address"
    case .unknownToken: return "unknown_token"
    case .rateLimited: return "rate_limited"
    case let .server(status): return "http_\(status)"
    case .unreachable: return "unreachable"
    }
  }
}
