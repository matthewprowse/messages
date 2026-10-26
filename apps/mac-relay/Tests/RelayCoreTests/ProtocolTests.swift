import Foundation
import XCTest
@testable import RelayCore

final class ProtocolTests: XCTestCase {
  private func json(_ value: some Encodable) throws -> [String: Any] {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    return try JSONSerialization.jsonObject(with: encoder.encode(value)) as! [String: Any]
  }

  func testDueWithNoHourIsAWholeDay() {
    let due = Due(components: DateComponents(year: 2026, month: 10, day: 24))
    XCTAssertEqual(due, Due(date: "2026-10-24"))
  }

  func testDueWithATimeKeepsItsZone() {
    var components = DateComponents(year: 2026, month: 1, day: 5, hour: 9, minute: 30)
    components.timeZone = TimeZone(identifier: "Africa/Johannesburg")
    XCTAssertEqual(Due(components: components), Due(date: "2026-01-05", time: "09:30:00", timeZone: "Africa/Johannesburg"))
  }

  func testFloatingTimeHasNoZone() {
    XCTAssertEqual(Due(components: DateComponents(year: 2026, month: 1, day: 5, hour: 9)), Due(date: "2026-01-05", time: "09:00:00"))
  }

  func testNoDayIsNoDueDate() {
    XCTAssertNil(Due(components: nil))
    XCTAssertNil(Due(components: DateComponents(hour: 9)))
  }

  func testSyncEncodesAsTheWorkerReadsIt() throws {
    let payload = SyncPayload(
      access: "full",
      timeZone: "Africa/Johannesburg",
      lists: [.init(id: "L1", name: "Clients")],
      reminders: [.init(id: "R1", listId: "L1", title: "Call Sam", notes: nil, due: Due(date: "2026-10-24"), completed: false, completedAt: nil, priority: 5)]
    )
    let body = try json(payload)
    XCTAssertEqual(body["version"] as? Int, 1)
    XCTAssertEqual(body["access"] as? String, "full")
    let reminder = (body["reminders"] as! [[String: Any]])[0]
    XCTAssertEqual(reminder["listId"] as? String, "L1")
    XCTAssertEqual(reminder["priority"] as? Int, 5)
    XCTAssertEqual((reminder["due"] as? [String: Any])?["date"] as? String, "2026-10-24")
    XCTAssertNil(reminder["notes"]) // left out, which the worker reads as none
  }

  func testDeniedSendsNoReminders() throws {
    let body = try json(SyncPayload.denied(timeZone: "UTC"))
    XCTAssertEqual(body["access"] as? String, "denied")
    XCTAssertEqual((body["reminders"] as? [Any])?.count, 0)
  }

  func testRemindersAreKnownByICloudsId() {
    XCTAssertEqual(reminderId(external: "EXT-1", local: "LOCAL-1"), "EXT-1")
    XCTAssertEqual(reminderId(external: "", local: "LOCAL-1"), "LOCAL-1")
    XCTAssertEqual(reminderId(external: nil, local: "LOCAL-1"), "LOCAL-1")
  }

  func testUpdatesDecode() throws {
    let data = Data(#"{"updates":[{"id":"u1","reminderId":"R1","action":"complete"},{"id":"u2","reminderId":"R1","action":"reopen"},{"id":"u3","reminderId":"R1","action":"delete"}]}"#.utf8)
    let updates = try JSONDecoder().decode(UpdatesResponse.self, from: data).updates
    XCTAssertEqual(updates.map(\.completes), [true, false, nil])
  }

  func testReportsUseTheWorkersCodes() throws {
    XCTAssertEqual(try json(Report.done)["ok"] as? Bool, true)
    let failed = try json(Report.failed(.readOnly))
    XCTAssertEqual(failed["ok"] as? Bool, false)
    XCTAssertEqual(failed["error"] as? String, "read_only")
    XCTAssertEqual([ApplyError.notFound, .readOnly, .denied, .saveFailed].map(\.rawValue), ["not_found", "read_only", "denied", "save_failed"])
  }

  func testTheTokenOnlyTravelsEncryptedOrOnThisMac() {
    XCTAssertEqual(relayBaseURL("https://relay.konva.app/")?.absoluteString, "https://relay.konva.app")
    XCTAssertNotNil(relayBaseURL("http://localhost:8790"))
    XCTAssertNotNil(relayBaseURL(" http://127.0.0.1:8790 "))
    XCTAssertNil(relayBaseURL("http://relay.konva.app"))
    XCTAssertNil(relayBaseURL("http://192.168.1.10:8790"))
    XCTAssertNil(relayBaseURL("ftp://localhost"))
    XCTAssertNil(relayBaseURL("not a url"))
  }

  func testTokenShape() {
    XCTAssertTrue(looksLikeToken("konva_rr_" + String(repeating: "a", count: 43)))
    XCTAssertFalse(looksLikeToken("konva_rr_short"))
    XCTAssertFalse(looksLikeToken("my apple id password"))
  }

  func testBackoffGrowsAndIsCapped() {
    XCTAssertEqual([0, 1, 2, 3, 10].map { backoffSeconds(failures: $0) }, [0, 5, 10, 20, 300])
  }

  func testTimesAreUTC() {
    XCTAssertEqual(isoTime(Date(timeIntervalSince1970: 1_792_828_800)), "2026-10-24T08:00:00Z")
    XCTAssertNil(isoTime(nil))
  }
}
