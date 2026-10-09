import UIKit

private let green = UIColor(red: 0.12, green: 0.28, blue: 0.22, alpha: 1)

struct Event: Decodable {
    let id: String
    let type: String
    let name: String
    let capacity: Int
    let remaining: Int?
    static let examples = [
        Event(id: "golf-jeju", type: "golf", name: "제주 프리미엄 투어 라운딩", capacity: 8, remaining: nil),
        Event(id: "golf-south", type: "golf", name: "남부권 정기 라운딩", capacity: 12, remaining: nil),
        Event(id: "golf-welcome", type: "golf", name: "웰컴 라운딩", capacity: 6, remaining: nil),
        Event(id: "travel-scotland", type: "travel", name: "스코틀랜드 골프 오리진 투어", capacity: 10, remaining: nil),
        Event(id: "travel-bali", type: "travel", name: "발리 웰니스 & 골프 리트릿", capacity: 12, remaining: nil),
        Event(id: "travel-napa", type: "travel", name: "나파밸리 와인 & 골프 투어", capacity: 10, remaining: nil)
    ]
}

final class Service {
    static let shared = Service()
    var address: String { UserDefaults.standard.string(forKey: "forest.server") ?? "" }
    var events = Event.examples
    var live = false
    var user: String?
    private var session = Service.makeSession()
    private var revision = 0
    private static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.httpShouldSetCookies = true
        config.httpCookieAcceptPolicy = .always
        return URLSession(configuration: config)
    }
    func connect(_ address: String, completion: @escaping (String?) -> Void) {
        guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.scheme == "https", let host = url.host, !host.isEmpty,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else {
            completion("HTTPS 서버 루트 주소를 입력해주세요.")
            return
        }
        revision += 1
        session.invalidateAndCancel()
        session = Service.makeSession()
        user = nil
        live = false
        events = Event.examples
        UserDefaults.standard.set(url.absoluteString, forKey: "forest.server")
        refresh(completion)
    }
    func request(_ path: [String], body: [String: String]? = nil, completion: @escaping (Data?, String?) -> Void) {
        guard var url = URL(string: address), url.scheme == "https" else {
            completion(nil, "마이페이지에서 HTTPS 서버를 연결해주세요.")
            return
        }
        for component in path { url.appendPathComponent(component) }
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body = body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        let version = revision
        session.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                guard version == self.revision else { completion(nil, "서버 연결이 변경되었습니다."); return }
                if let error = error { completion(nil, error.localizedDescription); return }
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                    let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                    completion(nil, json?["error"] as? String ?? "서버 요청에 실패했습니다.")
                    return
                }
                completion(data ?? Data(), nil)
            }
        }.resume()
    }
    func refresh(_ completion: @escaping (String?) -> Void) {
        request(["api", "events"]) { data, error in
            if let data = data, let events = try? JSONDecoder().decode([Event].self, from: data) {
                self.events = events
                self.live = true
                completion(nil)
            } else {
                self.events = Event.examples
                self.live = false
                completion(error ?? "모임 응답을 읽을 수 없습니다.")
            }
        }
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let tabs = UITabBarController()
        let home = EventsController(home: true)
        home.tabBarItem = UITabBarItem(title: "홈", image: nil, tag: 0)
        let events = EventsController(home: false)
        events.tabBarItem = UITabBarItem(title: "모임", image: nil, tag: 1)
        let account = AccountController()
        account.tabBarItem = UITabBarItem(title: "마이페이지", image: nil, tag: 2)
        tabs.viewControllers = [home, events, account].map { UINavigationController(rootViewController: $0) }
        tabs.tabBar.tintColor = green
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.tintColor = green
        window.rootViewController = tabs
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

extension UIViewController {
    func notice(_ text: String) {
        let alert = UIAlertController(title: "포레스트클럽", message: text, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "확인", style: .default))
        present(alert, animated: true)
    }
}

final class EventsController: UITableViewController, UISearchResultsUpdating {
    let home: Bool
    let categories = UISegmentedControl(items: ["전체", "골프", "여행"])
    let search = UISearchController(searchResultsController: nil)
    var filtered: [Event] {
        let all = home ? Array(Service.shared.events.prefix(3)) : Service.shared.events
        return all.filter {
            let category = categories.selectedSegmentIndex
            let text = search.searchBar.text ?? ""
            return (category == 0 || $0.type == (category == 1 ? "golf" : "travel")) && (text.isEmpty || $0.name.localizedCaseInsensitiveContains(text))
        }
    }
    init(home: Bool) { self.home = home; super.init(style: .grouped) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = home ? "포레스트클럽" : "함께할 모임"
        categories.selectedSegmentIndex = 0
        categories.addTarget(self, action: #selector(reload), for: .valueChanged)
        if !home {
            navigationItem.titleView = categories
            search.searchResultsUpdater = self
            search.obscuresBackgroundDuringPresentation = false
            search.searchBar.placeholder = "모임 검색"
            navigationItem.searchController = search
            definesPresentationContext = true
        }
        refreshControl = UIRefreshControl()
        refreshControl?.addTarget(self, action: #selector(refresh), for: .valueChanged)
        tableView.rowHeight = UITableView.automaticDimension
        tableView.estimatedRowHeight = 90
        if !Service.shared.address.isEmpty { refresh() }
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); reload() }
    @objc func reload() { tableView.reloadData() }
    @objc func refresh() {
        Service.shared.refresh { error in
            self.refreshControl?.endRefreshing()
            self.reload()
            if let error = error { self.notice(error) }
        }
    }
    func updateSearchResults(for searchController: UISearchController) { reload() }
    override func numberOfSections(in tableView: UITableView) -> Int { 1 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { filtered.count }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        let greeting = home ? "좋은 사람들과, 더 넓은 세상으로.\n\n추천 모임\n" : ""
        return greeting + (Service.shared.live ? "현재 모집 현황" : "예시 모임 · 마이페이지에서 서버를 연결해주세요")
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        let event = filtered[indexPath.row]
        cell.textLabel?.text = event.name
        cell.textLabel?.numberOfLines = 0
        cell.textLabel?.font = .preferredFont(forTextStyle: .headline)
        cell.textLabel?.adjustsFontForContentSizeCategory = true
        cell.detailTextLabel?.text = (event.type == "golf" ? "골프" : "여행") + " · 정원 \(event.capacity)명" + (event.remaining.map { " · 남은 자리 \($0)명" } ?? " · 예시")
        cell.detailTextLabel?.numberOfLines = 0
        cell.detailTextLabel?.font = .preferredFont(forTextStyle: .caption1)
        cell.accessoryType = .disclosureIndicator
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        navigationController?.pushViewController(DetailController(event: filtered[indexPath.row]), animated: true)
    }
}

final class DetailController: UIViewController {
    let event: Event
    let button = UIButton(type: .system)
    init(event: Event) { self.event = event; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "모임 안내"
        view.backgroundColor = .white
        let name = UILabel()
        name.text = event.name
        name.font = .preferredFont(forTextStyle: .title1)
        name.numberOfLines = 0
        name.textColor = green
        let info = UILabel()
        info.numberOfLines = 0
        info.font = .preferredFont(forTextStyle: .body)
        info.text = "정원 \(event.capacity)명\n\n참가 문의를 남겨주시면 운영진이 일정과 참가 절차를 안내해드립니다."
        if !Service.shared.live { info.text! += "\n\n현재 예시 모드입니다. 마이페이지에서 서버를 연결해주세요." }
        button.setTitle("참가 문의하기", for: .normal)
        button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        button.isEnabled = Service.shared.live && event.remaining != 0
        button.addTarget(self, action: #selector(submit), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [name, info, button])
        stack.axis = .vertical
        stack.spacing = 26
        stack.translatesAutoresizingMaskIntoConstraints = false
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40)
        ])
    }
    @objc func submit() {
        button.isEnabled = false
        Service.shared.request(["api", "events", event.name, "interest"], body: [:]) { _, error in
            if let error = error { self.button.isEnabled = true; self.notice(error) }
            else {
                self.button.setTitle("문의 접수 완료", for: .normal)
                self.notice("참가 문의가 접수되었습니다.")
                Service.shared.refresh { _ in }
            }
        }
    }
}

final class AccountController: UITableViewController {
    var busy = false
    init() { super.init(style: .grouped) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() { super.viewDidLoad(); title = "마이페이지" }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); tableView.reloadData() }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { 5 }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        return (Service.shared.user.map { "\($0)님, 반갑습니다" } ?? "포레스트클럽과 함께하세요") + "\n" + (Service.shared.live ? "서버 연결됨" : "예시 모드")
    }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        return "iOS 12 호환 버전 · 실제 서버의 HTTPS 주소를 설정해주세요.\n로그인 세션은 앱 종료 시 해제됩니다. 웹에서는 별도 로그인이 필요합니다."
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.text = ["서버 주소 설정", "로그인", "회원가입", "로그아웃", "멤버십 · 동행 · 쪽지 웹 서비스"][indexPath.row]
        cell.textLabel?.numberOfLines = 0
        if indexPath.row == 0 { cell.detailTextLabel?.text = Service.shared.address; cell.detailTextLabel?.numberOfLines = 0 }
        cell.accessoryType = .disclosureIndicator
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard !busy else { return }
        switch indexPath.row {
        case 0: serverPrompt()
        case 1: authPrompt(signup: false)
        case 2: authPrompt(signup: true)
        case 3:
            busy = true
            Service.shared.request(["api", "auth", "logout"], body: [:]) { _, error in
                self.busy = false
                if let error = error { self.notice(error) } else { Service.shared.user = nil; self.tableView.reloadData() }
            }
        default:
            if Service.shared.live, let url = URL(string: Service.shared.address) { UIApplication.shared.open(url) }
            else { notice("서버를 먼저 연결해주세요.") }
        }
    }
    func serverPrompt() {
        let alert = UIAlertController(title: "서버 연결", message: "HTTPS 서버 루트 주소를 입력하세요.", preferredStyle: .alert)
        alert.addTextField { field in
            field.placeholder = "https://서버주소"
            field.text = Service.shared.address
            field.keyboardType = .URL
            field.autocapitalizationType = .none
            field.autocorrectionType = .no
        }
        alert.addAction(UIAlertAction(title: "취소", style: .cancel))
        alert.addAction(UIAlertAction(title: "연결", style: .default) { _ in
            self.busy = true
            Service.shared.connect(alert.textFields?.first?.text ?? "") { error in
                self.busy = false
                self.tableView.reloadData()
                self.notice(error ?? "서버에 연결되었습니다.")
            }
        })
        present(alert, animated: true)
    }
    func authPrompt(signup: Bool) {
        guard Service.shared.live else { notice("서버를 먼저 연결해주세요."); return }
        let alert = UIAlertController(title: signup ? "회원가입" : "로그인", message: signup ? "비밀번호는 8자 이상 입력해주세요." : nil, preferredStyle: .alert)
        if signup { alert.addTextField { $0.placeholder = "이름" } }
        alert.addTextField { field in
            field.placeholder = "이메일"
            field.keyboardType = .emailAddress
            field.autocapitalizationType = .none
            field.autocorrectionType = .no
        }
        alert.addTextField { field in field.placeholder = "비밀번호"; field.isSecureTextEntry = true }
        alert.addAction(UIAlertAction(title: "취소", style: .cancel))
        alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in
            let fields = alert.textFields ?? []
            let offset = signup ? 1 : 0
            let name = signup ? fields[0].text ?? "" : ""
            let email = (fields[offset].text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let password = fields[offset + 1].text ?? ""
            guard !email.isEmpty, !password.isEmpty, !signup || (!name.trimmingCharacters(in: .whitespaces).isEmpty && password.count >= 8) else {
                self.notice("입력 내용을 확인해주세요."); return
            }
            self.busy = true
            Service.shared.request(["api", "auth", signup ? "signup" : "login"], body: ["name": name, "email": email, "password": password]) { data, error in
                self.busy = false
                if let error = error { self.notice(error); return }
                if let data = data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let name = json["name"] as? String {
                    Service.shared.user = name
                    self.tableView.reloadData()
                } else { self.notice("계정 응답을 읽을 수 없습니다.") }
            }
        })
        present(alert, animated: true)
    }
}
