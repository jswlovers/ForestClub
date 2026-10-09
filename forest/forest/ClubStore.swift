import Foundation
import Combine

struct ClubEvent: Codable, Identifiable {
    let id: String
    let type: String
    let name: String
    let capacity: Int
    let remaining: Int?
    static let examples: [ClubEvent] = [
        .init(id: "golf-jeju", type: "golf", name: "제주 프리미엄 투어 라운딩", capacity: 8, remaining: nil),
        .init(id: "golf-south", type: "golf", name: "남부권 정기 라운딩", capacity: 12, remaining: nil),
        .init(id: "golf-welcome", type: "golf", name: "웰컴 라운딩", capacity: 6, remaining: nil),
        .init(id: "travel-scotland", type: "travel", name: "스코틀랜드 골프 오리진 투어", capacity: 10, remaining: nil),
        .init(id: "travel-bali", type: "travel", name: "발리 웰니스 & 골프 리트릿", capacity: 12, remaining: nil),
        .init(id: "travel-napa", type: "travel", name: "나파밸리 와인 & 골프 투어", capacity: 10, remaining: nil)
    ]
}

struct ClubUser: Decodable {
    let id: Int
    let name: String
    let email: String
}

struct ClubError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@MainActor
final class ClubStore: ObservableObject {
    @Published private(set) var events = ClubEvent.examples
    @Published private(set) var user: ClubUser?
    @Published private(set) var isLive = false
    @Published private(set) var connectionMessage: String?
    @Published private(set) var serverAddress = UserDefaults.standard.string(forKey: "forest.server") ?? ""
    private var session = ClubStore.makeSession()
    private var generation = 0

    private static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieAcceptPolicy = .always
        configuration.httpShouldSetCookies = true
        configuration.timeoutIntervalForRequest = 15
        return URLSession(configuration: configuration)
    }

    static func validatedURL(_ address: String) throws -> URL {
        guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = url.host, !host.isEmpty,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/",
              url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host)) else {
            throw ClubError(message: "HTTPS 서버 주소를 입력해주세요. 로컬 개발은 http://localhost:3000을 사용할 수 있습니다.")
        }
        return url
    }

    func connect(to address: String) async throws {
        let url = try Self.validatedURL(address)
        generation += 1
        session.invalidateAndCancel()
        session = Self.makeSession()
        serverAddress = url.absoluteString
        UserDefaults.standard.set(serverAddress, forKey: "forest.server")
        user = nil
        isLive = false
        events = ClubEvent.examples
        await refresh()
        if !isLive { throw ClubError(message: connectionMessage ?? "서버에 연결하지 못했습니다.") }
    }

    func refresh() async {
        guard !serverAddress.isEmpty else { return }
        let version = generation
        do {
            let data = try await request("api/events")
            let loaded = try JSONDecoder().decode([ClubEvent].self, from: data)
            guard version == generation else { return }
            events = loaded
            isLive = true
            connectionMessage = nil
        } catch {
            guard version == generation else { return }
            isLive = false
            events = ClubEvent.examples
            connectionMessage = "서버 연결 실패: \(error.localizedDescription)"
            return
        }
        do {
            let data = try await request("api/auth/me")
            let current = try JSONDecoder().decode(ClubUser.self, from: data)
            if version == generation { user = current }
        } catch {
            if version == generation { user = nil }
        }
    }

    func authenticate(signup: Bool, name: String, email: String, password: String) async throws {
        let version = generation
        let data = try await request("api/auth/\(signup ? "signup" : "login")", method: "POST", body: [
            "name": name, "email": email.trimmingCharacters(in: .whitespacesAndNewlines), "password": password
        ])
        let authenticated = try JSONDecoder().decode(ClubUser.self, from: data)
        if version == generation { user = authenticated }
    }

    func logout() async throws {
        let version = generation
        _ = try await request("api/auth/logout", method: "POST")
        if version == generation { user = nil }
    }

    func submitInterest(_ event: ClubEvent) async throws {
        guard isLive else { throw ClubError(message: "서버를 먼저 연결해주세요.") }
        _ = try await request("api/events", components: [event.name, "interest"], method: "POST")
        await refresh()
    }

    private func request(_ path: String, components: [String] = [], method: String = "GET", body: [String: String]? = nil) async throws -> Data {
        var url = try Self.validatedURL(serverAddress).appendingPathComponent(path)
        for component in components { url.appendPathComponent(component) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw ClubError(message: "서버 응답을 확인할 수 없습니다.") }
        guard (200..<300).contains(response.statusCode) else {
            let error = try? JSONDecoder().decode(ServerError.self, from: data)
            throw ClubError(message: error?.error ?? "요청에 실패했습니다 (\(response.statusCode)).")
        }
        return data
    }

    private struct ServerError: Decodable { let error: String }
}
