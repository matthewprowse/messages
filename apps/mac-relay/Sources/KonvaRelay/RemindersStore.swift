import EventKit
import Foundation
import RelayCore

// Reminders on this Mac through EventKit, Apple's own access to them: every list iCloud syncs here, upgraded
// lists and shared ones included. It reads open reminders and those completed in the last 30 days, and changes
// only one thing: whether a reminder is completed, when Konva asks.

final class RemindersStore {
  private let store = EKEventStore()
  private static let completedDays = 30

  /// Asks macOS for full access to Reminders. The first time, macOS shows its own prompt.
  func requestAccess() async -> Bool {
    if EKEventStore.authorizationStatus(for: .reminder) == .fullAccess { return true }
    return (try? await store.requestFullAccessToReminders()) ?? false
  }

  var hasAccess: Bool { EKEventStore.authorizationStatus(for: .reminder) == .fullAccess }

  /// Called whenever anything in Reminders changes, on this Mac or arriving from iCloud.
  func onChange(_ handler: @escaping () -> Void) {
    NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: nil) { _ in handler() }
  }

  private func fetch(_ predicate: NSPredicate) async -> [EKReminder] {
    await withCheckedContinuation { continuation in
      store.fetchReminders(matching: predicate) { continuation.resume(returning: $0 ?? []) }
    }
  }

  /// Everything Konva keeps, as one sync.
  func snapshot() async -> SyncPayload {
    let zone = TimeZone.current.identifier
    guard hasAccess else { return .denied(timeZone: zone) }
    store.refreshSourcesIfNecessary()
    let calendars = store.calendars(for: .reminder)
    let now = Date()
    let since = Calendar.current.date(byAdding: .day, value: -Self.completedDays, to: now) ?? now
    let open = await fetch(store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars))
    let done = await fetch(store.predicateForCompletedReminders(withCompletionDateStarting: since, ending: now, calendars: calendars))
    let reminders = (open + done).map { r in
      SyncPayload.Reminder(
        id: reminderId(external: r.calendarItemExternalIdentifier, local: r.calendarItemIdentifier),
        listId: r.calendar.calendarIdentifier,
        title: r.title ?? "",
        notes: r.notes,
        due: Due(components: r.dueDateComponents),
        completed: r.isCompleted,
        completedAt: isoTime(r.completionDate),
        priority: r.priority
      )
    }
    return SyncPayload(access: "full", timeZone: zone, lists: calendars.map { .init(id: $0.calendarIdentifier, name: $0.title) }, reminders: reminders)
  }

  /// The reminder Konva knows by this id: iCloud's id first, then this Mac's own.
  private func reminder(_ id: String) -> EKReminder? {
    if let found = store.calendarItems(withExternalIdentifier: id).compactMap({ $0 as? EKReminder }).first { return found }
    return store.calendarItem(withIdentifier: id) as? EKReminder
  }

  /// Ticks a reminder off, or back on. Already in that state counts as done.
  func apply(_ update: Update) -> Report? {
    guard let completes = update.completes else { return nil } // an action this relay does not know: left for a newer one
    guard hasAccess else { return .failed(.denied) }
    guard let reminder = reminder(update.reminderId) else { return .failed(.notFound) }
    guard reminder.calendar.allowsContentModifications else { return .failed(.readOnly) }
    if reminder.isCompleted == completes { return .done }
    reminder.isCompleted = completes // EventKit sets or clears the completion date with it
    do {
      try store.save(reminder, commit: true)
      return .done
    } catch {
      store.reset() // drop the unsaved change, so the next read is what Reminders has
      return .failed(.saveFailed)
    }
  }
}
