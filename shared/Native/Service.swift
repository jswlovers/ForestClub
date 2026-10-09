import Foundation
import Security
import UIKit

extension Notification.Name {
    static let clubLoginChanged = Notification.Name("clubLoginChanged")
}

final class Service {
    static let shared = Service()
    static let productionAddress = "https://forest.sean2022.one:8888"
    var address: String { serverOverride ?? Self.startupAddress() }
    private static func startupAddress() -> String {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if let index = arguments.firstIndex(of: "-forest.server"), arguments.indices.contains(index + 1), validURL(arguments[index + 1]) != nil { return arguments[index + 1] }
        #endif
        if let saved = UserDefaults.standard.string(forKey: "forest.server"), saved.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == productionAddress { return saved }
        return productionAddress
    }
    private var serverOverride: String?
    private let keychainEnabled: Bool
    var events = Event.examples
    var live = false
    var user: String?
    var userId: Int?
    private var session = Service.makeSession()
    private var revision = 0
    init(configuration: URLSessionConfiguration? = nil, address: String? = nil, keychainEnabled: Bool = true) {
        self.serverOverride = address; self.keychainEnabled = keychainEnabled
        if let configuration = configuration { session = URLSession(configuration: configuration) }
        if keychainEnabled { restoreCookie() }
    }
    private static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.httpShouldSetCookies = true
        config.httpCookieAcceptPolicy = .always
        return URLSession(configuration: config, delegate: SameOriginRedirects(), delegateQueue: nil)
    }
    static func validURL(_ address: String) -> URL? {
        guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = url.host, !host.isEmpty, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil, url.path.isEmpty || url.path == "/",
              url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host)) else { return nil }
        return url
    }
    func connect(_ address: String, completion: @escaping (String?) -> Void) {
        guard let url = Self.validURL(address) else { completion("HTTPS 서버 루트 주소를 입력해주세요."); return }
        revision += 1
        user = nil; userId = nil
        session.invalidateAndCancel()
        session = Self.makeSession()
        live = false; events = Event.examples
        if serverOverride != nil { serverOverride = url.absoluteString } else { UserDefaults.standard.set(url.absoluteString, forKey: "forest.server") }
        restoreCookie()
        refresh { error in
            if error != nil { completion(error) }
            else { self.restoreUser { _ in completion(nil) } }
        }
    }
    func request(_ path: [String], body: [String: Any]? = nil, method: String? = nil, completion: @escaping (Data?, String?) -> Void) {
        guard var url = Self.validURL(address) else { completion(nil, "마이페이지에서 서버를 연결해주세요."); return }
        for component in path { url.appendPathComponent(component) }
        var request = URLRequest(url: url)
        request.httpMethod = method ?? (body == nil ? "GET" : "POST")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body = body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            do { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
            catch { completion(nil, "입력 내용을 처리하지 못했습니다."); return }
        }
        execute(request, completion: completion)
    }
    private func execute(_ request: URLRequest, completion: @escaping (Data?, String?) -> Void) {
        let version = revision
        var authenticatedRequest = request
        if let url = request.url {
            let cookies = (session.configuration.httpCookieStorage?.cookies(for: url) ?? []).filter {
                ($0.expiresDate.map { $0 > Date() } ?? true) && (!$0.isSecure || url.scheme == "https")
            }
            for (name, value) in HTTPCookie.requestHeaderFields(with: cookies) { authenticatedRequest.setValue(value, forHTTPHeaderField: name) }
        }
        session.dataTask(with: authenticatedRequest) { data, response, error in
            DispatchQueue.main.async {
                guard version == self.revision else { completion(nil, "서버 연결이 변경되었습니다."); return }
                if let error = error { completion(nil, error.localizedDescription); return }
                guard let http = response as? HTTPURLResponse else { completion(nil, "서버 응답을 확인하지 못했습니다."); return }
                if let url = request.url {
                    var headers: [String: String] = [:]
                    for (key, value) in http.allHeaderFields { headers[String(describing: key)] = String(describing: value) }
                    for cookie in HTTPCookie.cookies(withResponseHeaderFields: headers, for: url) { self.session.configuration.httpCookieStorage?.setCookie(cookie) }
                }
                if http.statusCode == 401, !["/api/auth/login", "/api/auth/signup", "/api/auth/password"].contains(request.url?.path ?? "") {
                    self.clearLogin()
                }
                guard (200..<300).contains(http.statusCode) else {
                    let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                    completion(nil, json?["error"] as? String ?? "서버 요청 실패 (\(http.statusCode))")
                    return
                }
                if ["/api/auth/login", "/api/auth/signup"].contains(request.url?.path ?? ""), let data = data,
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    self.user = (json["nickname"] as? String) ?? (json["name"] as? String)
                    self.userId = json["id"] as? Int
                    self.rememberLogin()
                }
                if request.url?.path == "/api/auth/logout" { self.clearLogin() }
                completion(data ?? Data(), nil)
            }
        }.resume()
    }
    func json(_ path: [String], body: [String: Any]? = nil, method: String? = nil, completion: @escaping (Any?, String?) -> Void) {
        request(path, body: body, method: method) { data, error in
            guard error == nil, let data = data else { completion(nil, error); return }
            if data.isEmpty { completion([String: Any](), nil); return }
            do { completion(try JSONSerialization.jsonObject(with: data), nil) }
            catch { completion(nil, "서버 응답을 읽을 수 없습니다.") }
        }
    }
    func refresh(_ completion: @escaping (String?) -> Void) {
        request(["api", "events"]) { data, error in
            if let data = data, let events = try? JSONDecoder().decode([Event].self, from: data) {
                self.events = events; self.live = true; completion(nil)
            } else {
                self.events = Event.examples; self.live = false; completion(error ?? "모임 응답을 읽을 수 없습니다.")
            }
        }
    }
    func restoreUser(_ completion: @escaping (String?) -> Void) {
        guard let url = Self.validURL(address), (session.configuration.httpCookieStorage?.cookies(for: url) ?? []).contains(where: { $0.name == "fc_session" && ($0.expiresDate.map { $0 > Date() } ?? true) }) else {
            completion("로그인이 필요합니다."); return
        }
        json(["api", "auth", "me"]) { json, error in
            if let profile = json as? [String: Any] {
                self.user = (profile["nickname"] as? String) ?? (profile["name"] as? String); self.userId = profile["id"] as? Int
                NotificationCenter.default.post(name: .clubLoginChanged, object: nil)
            }
            completion(error)
        }
    }
    private var keyQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: (Bundle.main.bundleIdentifier ?? "forest") + ".session", kSecAttrAccount as String: address]
    }
    struct StoredCookie: Codable {
        let value: String
        let domain: String
        let path: String
        let secure: Bool
        let expires: Date?
    }
    func rememberLogin() {
        persistenceError = nil
        guard keychainEnabled else { NotificationCenter.default.post(name: .clubLoginChanged, object: nil); return }
        guard let cookie = session.configuration.httpCookieStorage?.cookies?.first(where: { $0.name == "fc_session" }) else { return }
        let saved = StoredCookie(value: cookie.value, domain: cookie.domain, path: cookie.path, secure: cookie.isSecure, expires: cookie.expiresDate)
        guard let data = try? JSONEncoder().encode(saved) else { return }
        SecItemDelete(keyQuery as CFDictionary)
        var query = keyQuery
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(query as CFDictionary, nil)
        if status != errSecSuccess { persistenceError = "로그인은 완료했지만 기기에 세션을 저장하지 못했습니다. 앱을 다시 열면 로그인이 필요할 수 있습니다." }
        NotificationCenter.default.post(name: .clubLoginChanged, object: nil)
    }
    private(set) var persistenceError: String?
    private func restoreCookie() {
        guard keychainEnabled else { return }
        var query = keyQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data,
              let saved = try? JSONDecoder().decode(StoredCookie.self, from: data),
              saved.expires.map({ $0 > Date() }) ?? true else { return }
        var properties: [HTTPCookiePropertyKey: Any] = [.name: "fc_session", .value: saved.value, .domain: saved.domain, .path: saved.path]
        if saved.secure { properties[.secure] = "TRUE" }
        if let expires = saved.expires { properties[.expires] = expires }
        if let cookie = HTTPCookie(properties: properties) { session.configuration.httpCookieStorage?.setCookie(cookie) }
    }
    func clearLogin() {
        revision += 1
        user = nil; userId = nil; persistenceError = nil
        for cookie in session.configuration.httpCookieStorage?.cookies ?? [] { session.configuration.httpCookieStorage?.deleteCookie(cookie) }
        if keychainEnabled { SecItemDelete(keyQuery as CFDictionary) }
        NotificationCenter.default.post(name: .clubLoginChanged, object: nil)
    }
    func attachment(_ relativePath: String, completion: @escaping (Data?, String?) -> Void) {
        guard relativePath.hasPrefix("/api/messages/attachments/"), !relativePath.contains(".."),
              let base = Self.validURL(address), let url = URL(string: relativePath, relativeTo: base)?.absoluteURL, url.host == base.host else {
            completion(nil, "첨부파일 주소가 올바르지 않습니다."); return
        }
        execute(URLRequest(url: url), completion: completion)
    }
}

extension UIViewController {
    func requireLogin(_ action: @escaping () -> Void) {
        guard !Service.shared.address.isEmpty else {
            let alert = UIAlertController(title: "서버 연결", message: "인터넷 연결을 확인한 후 다시 시도해주세요.", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "취소", style: .cancel))
            alert.addAction(UIAlertAction(title: "설정", style: .default) { _ in self.navigationController?.pushViewController(AccountController(), animated: true) })
            present(alert, animated: true); return
        }
        if Service.shared.userId != nil { action(); return }
        Service.shared.restoreUser { _ in
            if Service.shared.userId != nil { action() }
            else {
                let login = NativeFormController.login(signup: false) { self.dismiss(animated: true, completion: action) }
                let navigation = UINavigationController(rootViewController: login)
                login.navigationItem.leftBarButtonItem = UIBarButtonItem(title: "취소", style: .plain, target: login, action: #selector(NativeFormController.close))
                self.present(navigation, animated: true)
            }
        }
    }
}

extension Service {
    func uploadMessage(partnerId: Int, filename: String, data: Data, completion: @escaping (String?) -> Void) {
        let types = ["jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp", "pdf": "application/pdf", "doc": "application/msword", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "xls": "application/vnd.ms-excel", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "ppt": "application/vnd.ms-powerpoint", "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "txt": "text/plain", "zip": "application/zip"]
        guard let mime = types[(filename as NSString).pathExtension.lowercased()] else { completion("지원하지 않는 파일 형식입니다."); return }
        guard data.count <= 15 * 1024 * 1024, let base = Self.validURL(address) else { completion("파일 크기와 서버 연결을 확인해주세요."); return }
        let boundary = "Forest-" + UUID().uuidString
        var body = Data()
        func append(_ text: String) { body.append(Data(text.utf8)) }
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"recipientUserId\"\r\n\r\n\(partnerId)\r\n")
        let cleanName = filename.replacingOccurrences(of: "\"", with: "_").replacingOccurrences(of: "\r", with: "_").replacingOccurrences(of: "\n", with: "_")
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(cleanName)\"\r\nContent-Type: \(mime)\r\n\r\n")
        body.append(data); append("\r\n--\(boundary)--\r\n")
        var request = URLRequest(url: base.appendingPathComponent("api/messages")); request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type"); request.httpBody = body
        execute(request) { _, error in completion(error) }
    }
}

private final class SameOriginRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let origin = task.originalRequest?.url, let next = request.url,
              origin.scheme == next.scheme, origin.host == next.host, origin.port == next.port else { completionHandler(nil); return }
        completionHandler(request)
    }
}
