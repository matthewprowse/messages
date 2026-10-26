import Darwin
import Foundation
import RelayCore

// Konva Relay's commands:
//   setup            pair with Konva: the relay address and token from Settings, Connected Accounts, iCloud Reminders
//   run              sync until stopped (what the login agent runs)
//   install-agent    start it now and at every login, from ~/Library/LaunchAgents
//   uninstall-agent  stop it starting
//   status           the last sync, without any reminder text
//   forget           remove the pairing from this Mac

@main
struct KonvaRelay {
  static func main() async {
    let command = CommandLine.arguments.dropFirst().first ?? "help"
    do {
      switch command {
      case "setup": try await setup()
      case "run": try await Relay().run()
      case "install-agent": try Agent.install()
      case "uninstall-agent": Agent.uninstall()
      case "status": status()
      case "forget":
        Agent.uninstall()
        Config.forget()
        print("Konva Relay is no longer paired on this Mac.")
      default:
        print("Usage: konva-relay setup | run | install-agent | uninstall-agent | status | forget")
      }
    } catch {
      FileHandle.standardError.write(Data("\(error)\n".utf8))
      exit(1)
    }
  }

  static func ask(_ prompt: String) -> String {
    print(prompt, terminator: "")
    return readLine()?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  }

  /// Reads the token without echoing it, so it is not left on screen or in the scrollback.
  static func askSecret(_ prompt: String) -> String {
    var buffer = [CChar](repeating: 0, count: 512)
    guard readpassphrase(prompt, &buffer, buffer.count, 0) != nil else { return "" }
    defer { buffer.withUnsafeMutableBufferPointer { _ = memset($0.baseAddress, 0, $0.count) } }
    return String(cString: buffer).trimmingCharacters(in: .whitespacesAndNewlines)
  }

  static func setup() async throws {
    let address = ask("Relay address [http://localhost:8790]: ")
    let relayUrl = address.isEmpty ? "http://localhost:8790" : address
    guard relayBaseURL(relayUrl) != nil else { throw RelayFailure.badAddress }
    let token = askSecret("Relay token: ")
    guard looksLikeToken(token) else {
      print("That does not look like a relay token. Copy it again from Settings, Connected Accounts, iCloud Reminders.")
      exit(1)
    }
    let config = Config(relayUrl: relayUrl, token: token)
    // One request with no wait, to check the token before saving it.
    _ = try await RelayClient(config: config).updates(waitSeconds: 0)
    try config.save()
    print("Paired. Now run: konva-relay install-agent")
  }

  static func status() {
    guard let config = try? Config.load() else {
      print("Not paired yet. Run konva-relay setup first.")
      return
    }
    print("Relay address: \(config.relayUrl)")
    print("Starts at login: \(FileManager.default.fileExists(atPath: Paths.agent.path) ? "Yes" : "No")")
    if let last = Status.load() {
      print("Last sync: \(last.lastSyncAt ?? "Never")\(last.reminders.map { ", \($0) reminders" } ?? "")")
      if let error = last.lastError { print("Last problem: \(error)") }
    }
  }
}

/// Waits for a change in Reminders or a timeout, whichever is first. A change while nobody waits is kept for the next wait.
actor Signal {
  private var pending = false
  private var waiter: CheckedContinuation<Void, Never>?

  func fire() {
    if let waiter {
      self.waiter = nil
      waiter.resume()
    } else {
      pending = true
    }
  }

  func wait(seconds: Double) async {
    if pending {
      pending = false
      return
    }
    await withCheckedContinuation { continuation in
      waiter = continuation
      Task {
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        self.fire()
      }
    }
    pending = false
  }
}

/// The running relay: one loop syncs, another applies the changes made in Konva.
final class Relay {
  private static let syncEverySeconds = 5.0 * 60 // even with no change, so a missed notification does no lasting harm
  private static let settleSeconds = 3.0 // changes in quick succession become one sync
  private static let longPollSeconds = 25

  private let reminders = RemindersStore()
  private let changed = Signal()

  func run() async throws {
    let config = try Config.load()
    let client = try RelayClient(config: config)
    if !(await reminders.requestAccess()) {
      log("Reminders access not allowed. Allow Konva Relay in System Settings, Privacy and Security, Reminders.")
    }
    let changed = self.changed
    reminders.onChange { Task { await changed.fire() } }
    log("Konva Relay started")
    async let syncing: Void = syncLoop(client)
    async let applying: Void = updateLoop(client)
    _ = await (syncing, applying)
  }

  private func log(_ line: String) {
    print("\(isoTime(Date()) ?? "") \(line)")
  }

  private func syncLoop(_ client: RelayClient) async {
    var failures = 0
    while true {
      let payload = await reminders.snapshot()
      do {
        try await client.sync(payload)
        failures = 0
        Status(lastSyncAt: isoTime(Date()), reminders: payload.reminders.count, lastError: nil).save()
        log("synced \(payload.lists.count) lists, \(payload.reminders.count) reminders")
      } catch {
        failures += 1
        let failure = error as? RelayFailure ?? .unreachable
        Status(lastSyncAt: Status.load()?.lastSyncAt, reminders: Status.load()?.reminders, lastError: failure.code).save()
        log("sync failed: \(failure.code)")
        await pause(after: failure, failures: failures)
        continue
      }
      await changed.wait(seconds: Self.syncEverySeconds)
      try? await Task.sleep(nanoseconds: UInt64(Self.settleSeconds * 1_000_000_000))
    }
  }

  private func updateLoop(_ client: RelayClient) async {
    var failures = 0
    while true {
      do {
        let updates = try await client.updates(waitSeconds: Self.longPollSeconds)
        failures = 0
        for update in updates {
          guard let report = reminders.apply(update) else { continue }
          try await client.report(update.id, report)
          log("change \(update.action): \(report.ok ? "done" : report.error ?? "failed")")
        }
        if !updates.isEmpty { await changed.fire() } // Konva gets the reminders as they now are
      } catch {
        failures += 1
        await pause(after: error as? RelayFailure ?? .unreachable, failures: failures)
      }
    }
  }

  private func pause(after failure: RelayFailure, failures: Int) async {
    var seconds = backoffSeconds(failures: failures)
    if case let .rateLimited(wait) = failure { seconds = max(seconds, wait) }
    if case .unknownToken = failure { seconds = 300 } // replaced or paused: check now and then, quietly
    try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
  }
}

/// The login agent, so the relay runs whenever this macOS user is logged in, and restarts if it stops.
enum Agent {
  static func install() throws {
    guard (try? Config.load()) != nil else { throw RelayFailure.notPaired }
    let executable = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath().path
    let plist: [String: Any] = [
      "Label": "app.konva.relay",
      "ProgramArguments": [executable, "run"],
      "RunAtLoad": true,
      "KeepAlive": true,
      "ProcessType": "Background",
      "StandardOutPath": Paths.logs.path,
      "StandardErrorPath": Paths.logs.path,
    ]
    try FileManager.default.createDirectory(at: Paths.agent.deletingLastPathComponent(), withIntermediateDirectories: true)
    let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
    try data.write(to: Paths.agent, options: .atomic)
    _ = launchctl(["bootout", "gui/\(getuid())/app.konva.relay"]) // an older copy, if one is running
    guard launchctl(["bootstrap", "gui/\(getuid())", Paths.agent.path]) == 0 else {
      print("macOS did not start the agent. Check \(Paths.logs.path).")
      exit(1)
    }
    print("Konva Relay is running, and starts at every login. Allow it to access Reminders when macOS asks.")
  }

  static func uninstall() {
    _ = launchctl(["bootout", "gui/\(getuid())/app.konva.relay"])
    try? FileManager.default.removeItem(at: Paths.agent)
  }

  private static func launchctl(_ arguments: [String]) -> Int32 {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    process.arguments = arguments
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    guard (try? process.run()) != nil else { return -1 }
    process.waitUntilExit()
    return process.terminationStatus
  }
}
