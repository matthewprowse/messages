import Foundation
import RelayCore

// The relay's side of the protocol: three requests, each with the token, none of them redirected (a redirect
// could carry the token somewhere else).

final class NoRedirects: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest) async -> URLRequest? {
    nil
  }
}

final class RelayClient {
  private let base: URL
  private let token: String
  private let session: URLSession
  private let delegate = NoRedirects()

  init(config: Config) throws {
    guard let base = config.baseURL else { throw RelayFailure.badAddress }
    self.base = base
    token = config.token
    let settings = URLSessionConfiguration.ephemeral // no cookies or cache on disk
    settings.timeoutIntervalForRequest = 60 // above the worker's 25 second long poll
    session = URLSession(configuration: settings, delegate: delegate, delegateQueue: nil)
  }

  private func send(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil) async throws -> Data {
    var components = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
    if !query.isEmpty { components.queryItems = query }
    var request = URLRequest(url: components.url!)
    request.httpMethod = method
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = body
    }
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      throw RelayFailure.unreachable
    }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    switch status {
    case 200: return data
    case 401: throw RelayFailure.unknownToken
    case 429:
      let wait = Double((response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Retry-After") ?? "") ?? 60
      throw RelayFailure.rateLimited(seconds: wait)
    default: throw RelayFailure.server(status: status)
    }
  }

  func sync(_ payload: SyncPayload) async throws {
    _ = try await send("POST", "v1/reminders/sync", body: try JSONEncoder().encode(payload))
  }

  func updates(waitSeconds: Int) async throws -> [Update] {
    let data = try await send("GET", "v1/reminders/updates", query: [URLQueryItem(name: "wait", value: String(waitSeconds))])
    return try JSONDecoder().decode(UpdatesResponse.self, from: data).updates
  }

  func report(_ id: String, _ report: Report) async throws {
    do {
      _ = try await send("POST", "v1/reminders/updates/\(id)", body: try JSONEncoder().encode(report))
    } catch RelayFailure.server(status: 404) {
      // Already settled, or cancelled in the app: nothing more to say about it.
    }
  }
}
