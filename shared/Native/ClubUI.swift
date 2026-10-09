import UIKit

let green = ClubTheme.forest

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
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "전체 메뉴", style: .plain, target: self, action: #selector(openMenu))
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
        if home { tableView.tableHeaderView = ClubTheme.heroView(width: view.bounds.width) }
        if !Service.shared.address.isEmpty { refresh() }
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); reload() }
    @objc func reload() { tableView.reloadData() }
    @objc func openMenu() { navigationController?.pushViewController(MenuController(), animated: true) }
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
        let heading = home ? "추천 모임 · " : ""
        return heading + (Service.shared.live ? "현재 모집 현황" : "서비스에 연결하지 못했습니다 · 예시 모임")
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        let event = filtered[indexPath.row]
        cell.textLabel?.text = event.name
        cell.textLabel?.numberOfLines = 0
        cell.textLabel?.font = ClubTheme.serif(17)
        cell.textLabel?.textColor = ClubTheme.ink
        cell.detailTextLabel?.text = (event.type == "golf" ? "골프" : "여행") + " · 정원 \(event.capacity)명" + (event.remaining.map { " · 남은 자리 \($0)명" } ?? " · 예시")
        cell.detailTextLabel?.numberOfLines = 0
        cell.detailTextLabel?.font = .preferredFont(forTextStyle: .caption1)
        cell.detailTextLabel?.textColor = ClubTheme.muted
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
        view.backgroundColor = ClubTheme.cream
        let eyebrow = UILabel()
        eyebrow.attributedText = NSAttributedString(string: event.type == "golf" ? "GOLF GATHERING" : "TRAVEL GATHERING", attributes: [.kern: 2, .foregroundColor: ClubTheme.gold, .font: UIFont.systemFont(ofSize: 12, weight: .bold)])
        let name = UILabel()
        name.text = event.name
        name.font = ClubTheme.serif(28)
        name.numberOfLines = 0
        name.textColor = green
        let info = UILabel()
        info.numberOfLines = 0
        info.font = .preferredFont(forTextStyle: .body)
        info.textColor = ClubTheme.ink
        info.text = "정원 \(event.capacity)명\n\n참가 문의를 남겨주시면 운영진이 일정과 참가 절차를 안내해드립니다."
        if !Service.shared.live { info.text! += "\n\n현재 예시 모드입니다. 인터넷 연결을 확인한 후 다시 시도해주세요." }
        button.setTitle("참가 문의하기", for: .normal)
        ClubTheme.primary(button)
        button.isEnabled = Service.shared.live && event.remaining != 0
        button.addTarget(self, action: #selector(submit), for: .touchUpInside)
        let companion = UIButton(type: .system)
        companion.setTitle("동행할 회원 찾기", for: .normal)
        ClubTheme.secondary(companion)
        companion.addTarget(self, action: #selector(findCompanion), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [eyebrow, name, info, button, companion])
        stack.axis = .vertical
        stack.spacing = 18
        stack.setCustomSpacing(8, after: eyebrow)
        stack.setCustomSpacing(28, after: info)
        stack.setCustomSpacing(12, after: button)
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
    @objc func findCompanion() {
        requireLogin { self.navigationController?.pushViewController(MembersController(event: self.event), animated: true) }
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
    var loginObserver: NSObjectProtocol?
    private var memberItems: [String] {
        Service.shared.userId == nil ? ["로그인", "회원가입"] : ["내 프로필", "쪽지함", "코인 충전", "내 지원 현황", "내 신청함", "고객센터", "로그아웃"]
    }
    init() { super.init(style: .grouped) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad(); title = "마이페이지"
        loginObserver = NotificationCenter.default.addObserver(forName: .clubLoginChanged, object: nil, queue: .main) { [weak self] _ in self?.tableView.reloadData() }
    }
    deinit { if let observer = loginObserver { NotificationCenter.default.removeObserver(observer) } }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated); tableView.reloadData()
        if !Service.shared.address.isEmpty { Service.shared.restoreUser { _ in self.tableView.reloadData() } }
    }
    override func numberOfSections(in tableView: UITableView) -> Int { 2 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { section == 0 ? memberItems.count : 1 }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        if section == 0 { return Service.shared.user.map { "\($0)님, 반갑습니다" } ?? "한 번 로그인으로 모든 회원 기능 이용" }
        return "포레스트클럽"
    }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        section == 0 ? "로그인 세션은 키체인에 보관됩니다. 로그아웃하거나 서버에서 세션이 만료되면 다시 로그인해주세요." : nil
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.numberOfLines = 0; cell.detailTextLabel?.numberOfLines = 0; cell.accessoryType = .disclosureIndicator
        if indexPath.section == 0 { cell.textLabel?.text = memberItems[indexPath.row] }
        else { cell.textLabel?.text = "전체 메뉴" }
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true); guard !busy else { return }
        if indexPath.section == 1 { navigationController?.pushViewController(MenuController(), animated: true); return }
        let item = memberItems[indexPath.row]
        switch item {
        case "로그인": authPrompt(signup: false)
        case "회원가입": authPrompt(signup: true)
        case "로그아웃":
            busy = true
            Service.shared.request(["api", "auth", "logout"], body: [:]) { _, error in
                self.busy = false
                if let error = error { self.notice(error) } else { self.tableView.reloadData() }
            }
        default: openNativeMenu(item)
        }
    }
    func authPrompt(signup: Bool) {
        guard !Service.shared.address.isEmpty else { notice("서버를 먼저 연결해주세요."); return }
        if signup {
            navigationController?.pushViewController(SignupConsentController { self.navigationController?.popToViewController(self, animated: true); self.tableView.reloadData() }, animated: true)
            return
        }
        let form = NativeFormController.login(signup: false) {
            self.navigationController?.popToViewController(self, animated: true); self.tableView.reloadData()
            if let error = Service.shared.persistenceError { self.notice(error) }
        }
        navigationController?.pushViewController(form, animated: true)
    }
}
