import AVFoundation
import UIKit
import WebKit

/// 보이스톡(음성)과 페이스톡(영상). 단가와 진입·유지 최소 잔액은 server/call-pricing.js가 기준이며 서버가 다시 검사한다.
enum CallKind: String {
    case voice, video
    init(_ row: Record) { self = string(row, "attachment_name") == "video" ? .video : .voice }
    var title: String { self == .video ? "페이스톡" : "보이스톡" }
    var icon: String { self == .video ? "📹" : "📞" }
    var costPerSecond: Int { self == .video ? 100 : 10 }
}

enum ClubCall {
    static let ringSeconds: TimeInterval = 60
    static let incomingWindow: TimeInterval = 90
    /// WKWebView의 마이크·카메라(getUserMedia)는 iOS 14.3부터 지원된다.
    static var supported: Bool { if #available(iOS 14.3, *) { return true } else { return false } }
    static let unsupportedMessage = "이 iPhone의 iOS 버전에서는 앱 안에서 통화할 수 없어요. iOS 14.3 이상에서 이용해주세요."
    static func roomURL(_ value: String) -> URL? {
        guard let url = URL(string: value), url.scheme == "https", url.user == nil, url.password == nil,
              let host = url.host?.lowercased(), host.hasSuffix(".daily.co") else { return nil }
        return url
    }
    static func isCall(_ row: Record) -> Bool { string(row, "attachment_type") == "call" }
    static func coins(_ value: Int) -> String { NumberFormatter.localizedString(from: NSNumber(value: value), number: .decimal) }
    private static let stamp: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter
    }()
    /// 서버의 created_at은 SQLite datetime('now') 형식의 UTC 시각이다.
    static func isRecent(_ value: String) -> Bool {
        guard let date = stamp.date(from: value) else { return false }
        return abs(date.timeIntervalSinceNow) <= incomingWindow
    }
}

/// 앱이 열려 있는 동안 새 통화 요청을 확인해 받기/거절 창을 띄우고, 통화 시작 절차를 한곳에서 처리한다.
final class CallMonitor {
    static let shared = CallMonitor()
    private var timer: Timer?
    private var answered = Set<String>()
    private var ringing = false
    var inCall = false

    func start() {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.poll() }
    }
    private func poll() {
        guard Service.shared.userId != nil, !inCall, !ringing, UIApplication.shared.applicationState == .active else { return }
        Service.shared.json(["api", "messages", "conversations"]) { json, _ in
            guard let rows = json as? [Record] else { return }
            for row in rows where string(row, "lastPreview") == "[통화 요청]" && row["lastMine"] as? Bool != true && (row["unread"] as? Int ?? 0) > 0 {
                guard let partner = row["userId"] as? Int, ClubCall.isRecent(string(row, "lastAt")), !self.answered.contains("\(partner)|\(string(row, "lastAt"))") else { continue }
                // 보이스톡인지 페이스톡인지는 통화 요청 메시지에만 있으므로 대화를 읽어 확인한다.
                let name = string(row, "name")
                Service.shared.json(["api", "messages", "conversations", String(partner)]) { json, _ in
                    let messages = (json as? Record)?["messages"] as? [Record] ?? []
                    if let call = messages.last, ClubCall.isCall(call), call["sender_id"] as? Int == partner { _ = self.offer(call, partner: partner, name: name) }
                }
                return
            }
        }
    }
    /// 대화창이 이미 읽음 처리한 통화 요청도 놓치지 않도록 ChatController가 새 메시지마다 호출한다.
    func notice(_ row: Record, partner: Int, name: String) {
        guard ClubCall.isCall(row), row["sender_id"] as? Int == partner else { return }
        _ = offer(row, partner: partner, name: name)
    }
    private func offer(_ call: Record, partner: Int, name: String) -> Bool {
        let at = string(call, "created_at"), key = "\(partner)|\(at)", kind = CallKind(call)
        guard !inCall, !ringing, ClubCall.isRecent(at), !answered.contains(key), let presenter = Self.topController() else { return false }
        ringing = true; answered.insert(key)
        let alert = UIAlertController(title: "\(kind.icon) \(kind.title)", message: "\(name.isEmpty ? "회원" : name)님이 \(kind.title)을 걸었어요.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "거절", style: .cancel) { _ in self.ringing = false })
        alert.addAction(UIAlertAction(title: "받기", style: .default) { _ in
            self.ringing = false
            self.join(call, partnerName: name, from: Self.topController())
        })
        presenter.present(alert, animated: true)
        return true
    }
    /// 받은 통화 메시지로 들어간다.
    func join(_ row: Record, partnerName: String, from presenter: UIViewController?) {
        guard let presenter = presenter else { return }
        guard let url = ClubCall.roomURL(string(row, "attachment_url")) else { presenter.notice("통화방 주소가 올바르지 않습니다."); return }
        let kind = CallKind(row)
        prepare(kind, from: presenter) { self.present(url, kind: kind, partnerName: partnerName, from: presenter) }
    }
    /// 상대에게 보이스톡이나 페이스톡을 건다. 통화방은 서버가 만들고 대화에 통화 요청 메시지로 남긴다. completion은 요청 전송 후 대화를 새로 고칠 때 쓴다.
    func place(_ kind: CallKind, partner: Int, partnerName: String, from presenter: UIViewController, completion: @escaping () -> Void) {
        prepare(kind, from: presenter) {
            let confirm = UIAlertController(title: kind.title, message: "\(partnerName)님에게 \(kind.title)을 걸까요?\n통화방에 들어간 순간부터 초당 \(ClubCall.coins(kind.costPerSecond))코인이 사용됩니다.", preferredStyle: .alert)
            confirm.addAction(UIAlertAction(title: "취소", style: .cancel))
            confirm.addAction(UIAlertAction(title: "걸기", style: .default) { _ in
                Service.shared.json(["api", "messages"], body: ["recipientUserId": partner, "kind": "call", "callType": kind.rawValue]) { json, error in
                    completion()
                    guard let link = (json as? Record).map({ string($0, "attachmentUrl") }), let url = ClubCall.roomURL(link) else {
                        presenter.notice(error ?? "통화방을 만들지 못했어요. 잠시 후 다시 시도해주세요."); return
                    }
                    self.present(url, kind: kind, partnerName: partnerName, from: presenter)
                }
            })
            presenter.present(confirm, animated: true)
        }
    }
    /// 통화 가능 iOS 버전, 코인 진입 잔액, 마이크(페이스톡은 카메라도) 권한을 차례로 확인한다.
    private func prepare(_ kind: CallKind, from presenter: UIViewController, _ action: @escaping () -> Void) {
        guard !inCall else { return }
        guard ClubCall.supported else { presenter.notice(ClubCall.unsupportedMessage); return }
        Service.shared.json(["api", "calls", "can-enter"]) { json, error in
            guard let info = json as? Record else { presenter.notice(error ?? "통화 가능 여부를 확인하지 못했습니다."); return }
            guard info["allowed"] as? Bool == true else {
                presenter.notice("코인이 \(ClubCall.coins(info["entryMin"] as? Int ?? 3000))개 이하면 통화를 시작할 수 없어요. 충전 후 다시 시도해주세요."); return
            }
            let camera = { kind == .video ? Self.allow(.video, name: "카메라", kind: kind, from: presenter, action) : action() }
            Self.allow(.audio, name: "마이크", kind: kind, from: presenter, camera)
        }
    }
    private static func allow(_ media: AVMediaType, name: String, kind: CallKind, from presenter: UIViewController, _ action: @escaping () -> Void) {
        switch AVCaptureDevice.authorizationStatus(for: media) {
        case .authorized: action()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: media) { granted in
                DispatchQueue.main.async { if granted { action() } else { presenter.notice("\(name)를 허용해야 \(kind.title)을 이용할 수 있어요.") } }
            }
        default: presenter.notice("\(name) 권한이 꺼져 있어요. 설정 > 포레스트클럽에서 \(name)를 허용해주세요.")
        }
    }
    private func present(_ url: URL, kind: CallKind, partnerName: String, from presenter: UIViewController) {
        guard !inCall else { return }
        let controller = CallController(roomURL: url, kind: kind, partnerName: partnerName)
        controller.modalPresentationStyle = .fullScreen
        (presenter.presentedViewController == nil ? presenter : Self.topController() ?? presenter).present(controller, animated: true)
    }
    static func topController() -> UIViewController? {
        var top = UIApplication.shared.windows.first(where: { $0.isKeyWindow })?.rootViewController
        while let next = top?.presentedViewController, !next.isBeingDismissed { top = next }
        return top
    }
}

/// 보이스톡·페이스톡 통화 화면. 음성·영상 연결과 영상 표시는 뒤쪽 웹뷰의 ForestCall.html(Daily.co)이, 버튼과 과금은 이 화면이 맡는다.
final class CallController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    let roomURL: URL
    let kind: CallKind
    let partnerName: String
    private var web: WKWebView!
    private let nameLabel = UILabel(), statusLabel = UILabel(), costLabel = UILabel()
    private let muteButton = UIButton(type: .system), cameraButton = UIButton(type: .system), flipButton = UIButton(type: .system), endButton = UIButton(type: .system)
    private var billing: Timer?, clock: Timer?, ringTimeout: Timer?
    private var startedAt: Date?
    private var pageLoaded = false, muted = false, cameraOff = false, ended = false, closed = false, hasPartner = false
    private var endMessage: String?

    init(roomURL: URL, kind: CallKind, partnerName: String) { self.roomURL = roomURL; self.kind = kind; self.partnerName = partnerName; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    deinit { billing?.invalidate(); clock?.invalidate(); ringTimeout?.invalidate() }

    override func viewDidLoad() {
        super.viewDidLoad()
        let video = kind == .video
        view.backgroundColor = video ? .black : green
        if #available(iOS 13.0, *) { isModalInPresentation = true }
        // 영상은 화면 전체에 깔리는 웹뷰가 그리고, 이름·상태·버튼은 그 위에 겹쳐 표시한다.
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.add(WeakScriptHandler(self), name: "call")
        web = WKWebView(frame: view.bounds, configuration: configuration)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.isOpaque = false; web.backgroundColor = .clear; web.scrollView.backgroundColor = .clear
        web.scrollView.isScrollEnabled = false; web.isUserInteractionEnabled = false
        if #available(iOS 11.0, *) { web.scrollView.contentInsetAdjustmentBehavior = .never }
        web.navigationDelegate = self; web.uiDelegate = self
        view.addSubview(web)

        nameLabel.text = partnerName.isEmpty ? kind.title : partnerName
        nameLabel.font = .systemFont(ofSize: video ? 24 : 30, weight: .bold)
        statusLabel.text = "\(kind.title) 연결하는 중…"; statusLabel.font = .preferredFont(forTextStyle: video ? .body : .title3)
        costLabel.text = "통화 중 초당 \(ClubCall.coins(kind.costPerSecond))코인 사용"; costLabel.font = .preferredFont(forTextStyle: .footnote)
        for label in [nameLabel, statusLabel, costLabel] {
            label.textColor = .white; label.textAlignment = .center; label.numberOfLines = 0
            label.layer.shadowColor = UIColor.black.cgColor; label.layer.shadowOpacity = video ? 0.8 : 0; label.layer.shadowRadius = 3; label.layer.shadowOffset = .zero
        }
        let dim = UIColor(white: video ? 0 : 1, alpha: video ? 0.45 : 0.18)
        style(muteButton, title: "음소거", color: dim); muteButton.addTarget(self, action: #selector(toggleMute), for: .touchUpInside)
        style(cameraButton, title: "화면 끄기", color: dim); cameraButton.addTarget(self, action: #selector(toggleCamera), for: .touchUpInside)
        style(flipButton, title: "카메라 전환", color: dim); flipButton.addTarget(self, action: #selector(flipCamera), for: .touchUpInside)
        style(endButton, title: "통화 종료", color: UIColor(red: 0.85, green: 0.2, blue: 0.2, alpha: 1)); endButton.addTarget(self, action: #selector(hangUp), for: .touchUpInside)
        for button in [muteButton, cameraButton, flipButton] { button.isEnabled = false }
        let info = UIStackView(arrangedSubviews: [nameLabel, statusLabel, costLabel]); info.axis = .vertical; info.spacing = video ? 4 : 12
        let controls = UIStackView(arrangedSubviews: video ? [muteButton, cameraButton, flipButton] : [muteButton]); controls.spacing = 10; controls.distribution = .fillEqually
        let actions = UIStackView(arrangedSubviews: [controls, endButton]); actions.axis = .vertical; actions.spacing = 12
        for stack in [info, actions] { stack.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(stack) }
        NSLayoutConstraint.activate([
            info.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24), info.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            info.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: video ? 16 : 80),
            actions.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20), actions.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            actions.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            controls.heightAnchor.constraint(equalToConstant: 52), endButton.heightAnchor.constraint(equalToConstant: 56)
        ])

        CallMonitor.shared.inCall = true
        UIApplication.shared.isIdleTimerDisabled = true
        ringTimeout = Timer.scheduledTimer(withTimeInterval: ClubCall.ringSeconds, repeats: false) { [weak self] _ in
            guard let self = self, !self.hasPartner else { return }
            self.finish("상대방이 통화에 들어오지 않아 연결을 종료했어요.")
        }
        guard let page = Bundle.main.url(forResource: "ForestCall", withExtension: "html"), let html = try? String(contentsOf: page, encoding: .utf8),
              let base = Service.validURL(Service.shared.address) else { finish("통화 화면을 준비하지 못했습니다."); return }
        // 마이크·카메라는 보안 출처(HTTPS)에서만 열리므로 포레스트클럽 서버 주소를 페이지 출처로 사용한다.
        web.loadHTMLString(html, baseURL: base)
    }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    private func style(_ button: UIButton, title: String, color: UIColor) {
        button.setTitle(title, for: .normal); button.setTitleColor(.white, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold); button.titleLabel?.adjustsFontSizeToFitWidth = true
        button.backgroundColor = color; button.layer.cornerRadius = 26
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let text = message.body as? String, let data = text.data(using: .utf8),
              let event = (try? JSONSerialization.jsonObject(with: data)) as? Record else { return }
        let remote = event["remote"] as? Int ?? 0
        switch string(event, "type") {
        case "ready":
            guard !ended, let argument = try? JSONSerialization.data(withJSONObject: [roomURL.absoluteString]), let literal = String(data: argument, encoding: .utf8) else { return }
            web.evaluateJavaScript("forestJoin(\(literal)[0], '\(kind.rawValue)')")
        case "joined":
            guard !ended else { return }
            startedAt = Date(); for button in [muteButton, cameraButton, flipButton] { button.isEnabled = true }
            billing = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
            clock = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.updateStatus() }
            partnersChanged(remote)
        case "participants": partnersChanged(remote)
        case "left": finish(nil)
        case "error": finish(string(event, "message"))
        case "closed": close()
        default: break
        }
    }
    private func partnersChanged(_ remote: Int) {
        guard !ended else { return }
        if remote > 0 { hasPartner = true; ringTimeout?.invalidate() }
        else if hasPartner { finish("상대방이 통화를 종료했어요."); return }
        updateStatus()
    }
    private func updateStatus() {
        guard !ended, let startedAt = startedAt else { return }
        let seconds = Int(Date().timeIntervalSince(startedAt))
        statusLabel.text = hasPartner ? String(format: "통화 중 %02d:%02d", seconds / 60, seconds % 60) : "상대방이 받기를 기다리는 중…"
    }
    /// 웹 버전과 같이 통화방에 들어간 뒤 1초마다 차감하고, 잔액이 유지 기준 이하이거나 차감에 실패하면 종료한다.
    private func tick() {
        Service.shared.json(["api", "calls", "tick"], body: ["callType": kind.rawValue, "roomUrl": roomURL.absoluteString]) { [weak self] json, error in
            guard let self = self, !self.ended else { return }
            guard let result = json as? Record else { self.finish(error.map { "\($0) 통화를 종료해요." } ?? "코인이 부족해 통화를 종료해요."); return }
            if let coins = result["coins"] as? Int { self.costLabel.text = "초당 \(ClubCall.coins(self.kind.costPerSecond))코인 사용 중 · 보유 \(ClubCall.coins(coins))코인" }
            if result["shouldEnd"] as? Bool == true {
                self.finish("코인이 \(ClubCall.coins(result["continueMin"] as? Int ?? 1500))개 이하로 떨어져 통화를 종료해요. 충전 후 다시 이용해주세요.")
            }
        }
    }
    @objc private func toggleMute() {
        muted.toggle()
        muteButton.setTitle(muted ? "마이크 켜기" : "음소거", for: .normal)
        web.evaluateJavaScript("forestMute(\(muted))")
    }
    @objc private func toggleCamera() {
        cameraOff.toggle()
        cameraButton.setTitle(cameraOff ? "화면 켜기" : "화면 끄기", for: .normal)
        web.evaluateJavaScript("forestCamera(\(!cameraOff))")
    }
    @objc private func flipCamera() { web.evaluateJavaScript("forestFlip()") }
    @objc private func hangUp() { finish(nil) }
    private func finish(_ message: String?) {
        guard !ended else { return }
        ended = true; endMessage = message
        billing?.invalidate(); clock?.invalidate(); ringTimeout?.invalidate()
        statusLabel.text = "통화를 종료하는 중…"; for button in [muteButton, cameraButton, flipButton, endButton] { button.isEnabled = false }
        UIApplication.shared.isIdleTimerDisabled = false
        // Daily 통화방에서 정상적으로 나간 뒤(closed) 화면을 닫고, 응답이 없으면 잠시 후 닫는다.
        if pageLoaded { web.evaluateJavaScript("window.forestLeave ? forestLeave() : 0") { _, _ in } }
        DispatchQueue.main.asyncAfter(deadline: .now() + (pageLoaded ? 2 : 0.5)) { [weak self] in self?.close() }
    }
    private func close() {
        guard !closed else { return }
        if !ended { finish(nil); return }
        closed = true
        CallMonitor.shared.inCall = false
        web.configuration.userContentController.removeScriptMessageHandler(forName: "call")
        web.stopLoading(); web.navigationDelegate = nil; web.uiDelegate = nil
        let presenter = presentingViewController, message = endMessage
        dismiss(animated: true) { if let message = message, !message.isEmpty { presenter?.notice(message) } }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // 처음 불러온 통화 페이지 외의 화면 이동과 새 창은 막는다.
        guard let frame = navigationAction.targetFrame else { decisionHandler(.cancel); return }
        decisionHandler(frame.isMainFrame && pageLoaded ? .cancel : .allow)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { pageLoaded = true }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish("통화 화면을 불러오지 못했습니다.") }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish("통화 화면을 불러오지 못했습니다.") }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { finish("통화 연결이 끊어졌어요.") }
    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        // 앱이 이미 권한을 받았으므로 통화 페이지의 요청은 다시 묻지 않고 허용한다. 카메라는 페이스톡에서만 쓴다.
        let allowed = type == .microphone || kind == .video
        decisionHandler(allowed && frame.isMainFrame && origin.host == Service.validURL(Service.shared.address)?.host ? .grant : .deny)
    }
}

/// WKUserContentController가 메시지 처리기를 강하게 붙잡아 통화 화면이 해제되지 않는 것을 막는다.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
