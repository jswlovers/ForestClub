import XCTest
@testable import forest

private final class SessionProtocol: URLProtocol {
    static var paths: [String] = []
    static var cookies: [String] = []
    static var expire = false
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "native-session.example" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path
        Self.paths.append(path)
        Self.cookies.append(request.value(forHTTPHeaderField: "Cookie") ?? "")
        var headers = ["Content-Type": "application/json"]
        var status = 200
        let json: String
        switch path {
        case "/api/auth/login":
            headers["Set-Cookie"] = "fc_session=shared-native-test; Path=/; Secure; HttpOnly; Max-Age=3600"
            json = "{\"id\":1,\"name\":\"회원\",\"email\":\"member@example.com\"}"
        case "/api/auth/logout":
            headers["Set-Cookie"] = "fc_session=; Path=/; Secure; Max-Age=0"; status = 204; json = ""
        default:
            if Self.expire || request.value(forHTTPHeaderField: "Cookie")?.contains("fc_session=shared-native-test") != true {
                status = 401; json = "{\"error\":\"로그인이 필요합니다\"}"
            } else { json = "{\"coins\":5000,\"id\":1,\"name\":\"회원\"}" }
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(json.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor
final class NativeSessionTests: XCTestCase {
    private func call(_ service: Service, _ path: [String], body: Record? = nil) async -> String? {
        await withCheckedContinuation { continuation in
            service.request(path, body: body) { _, error in continuation.resume(returning: error) }
        }
    }
    func testOneLoginAcrossNativeServicesAndLogout() async {
        SessionProtocol.paths = []; SessionProtocol.cookies = []; SessionProtocol.expire = false
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [SessionProtocol.self]
        let service = Service(configuration: config, address: "https://native-session.example", keychainEnabled: false)
        let loginError = await call(service, ["api", "auth", "login"], body: ["email": "member@example.com", "password": "test-password"])
        XCTAssertNil(loginError); XCTAssertEqual(service.userId, 1)
        for path in [["api", "messages", "conversations"], ["api", "coins", "balance"], ["api", "auth", "profile"], ["api", "applications", "me"], ["api", "companions", "incoming"], ["api", "tickets", "me"]] {
            let error = await call(service, path)
            XCTAssertNil(error, path.joined(separator: "/"))
        }
        XCTAssertEqual(SessionProtocol.paths.filter { $0 == "/api/auth/login" }.count, 1)
        XCTAssertTrue(SessionProtocol.cookies.dropFirst().allSatisfy { $0.contains("fc_session=shared-native-test") })
        let logoutError = await call(service, ["api", "auth", "logout"], body: [:])
        XCTAssertNil(logoutError); XCTAssertNil(service.userId)
        let afterLogout = await call(service, ["api", "coins", "balance"])
        XCTAssertNotNil(afterLogout)
        XCTAssertFalse(SessionProtocol.cookies.last?.contains("fc_session=shared-native-test") ?? true)
    }
    func testExpiredSessionClearsIdentity() async {
        SessionProtocol.paths = []; SessionProtocol.cookies = []; SessionProtocol.expire = false
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [SessionProtocol.self]
        let service = Service(configuration: config, address: "https://native-session.example", keychainEnabled: false)
        let loginError = await call(service, ["api", "auth", "login"], body: ["email": "member@example.com", "password": "test-password"])
        XCTAssertNil(loginError)
        SessionProtocol.expire = true
        let expired = await call(service, ["api", "messages", "conversations"])
        XCTAssertNotNil(expired); XCTAssertNil(service.userId); XCTAssertNil(service.user)
    }
}
