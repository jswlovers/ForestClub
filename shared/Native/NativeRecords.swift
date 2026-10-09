import UIKit

typealias Record = [String: Any]
func string(_ row: Record, _ key: String) -> String {
    if let value = row[key] as? String { return value }
    if let value = row[key] as? NSNumber { return value.stringValue }
    return ""
}
func statusText(_ value: String) -> String {
    ["pending": "대기 중", "approved": "승인", "rejected": "반려", "declined": "거절", "accepted": "수락", "cancelled": "취소", "open": "접수", "resolved": "처리 완료", "closed": "종료"][value] ?? value
}

class RecordsController: UITableViewController {
    var records: [Record] = []
    let path: [String]
    let render: (Record) -> (String, String)
    let selected: ((Record, UIViewController) -> Void)?
    var message = "불러오는 중…"
    private var loginObserver: NSObjectProtocol?
    init(title: String, path: [String], render: @escaping (Record) -> (String, String), selected: ((Record, UIViewController) -> Void)? = nil) {
        self.path = path; self.render = render; self.selected = selected; super.init(style: .grouped); self.title = title
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad()
        refreshControl = UIRefreshControl(); refreshControl?.addTarget(self, action: #selector(reload), for: .valueChanged)
        tableView.rowHeight = UITableView.automaticDimension; tableView.estimatedRowHeight = 90
        loginObserver = NotificationCenter.default.addObserver(forName: .clubLoginChanged, object: nil, queue: .main) { [weak self] _ in
            if Service.shared.userId == nil { self?.records = []; self?.message = "로그인이 필요합니다."; self?.tableView.reloadData() }
        }
    }
    deinit { if let observer = loginObserver { NotificationCenter.default.removeObserver(observer) } }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        requireLogin { self.reload() }
    }
    @objc func reload() {
        Service.shared.json(path) { json, error in
            self.refreshControl?.endRefreshing()
            self.records = json as? [Record] ?? []
            self.message = error ?? (self.records.isEmpty ? "아직 내역이 없습니다." : "")
            self.tableView.reloadData()
        }
    }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { records.count }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { message.isEmpty ? nil : message }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        let display = render(records[indexPath.row])
        cell.textLabel?.text = display.0; cell.textLabel?.numberOfLines = 0; cell.textLabel?.font = .preferredFont(forTextStyle: .headline)
        cell.detailTextLabel?.text = display.1; cell.detailTextLabel?.numberOfLines = 0; cell.detailTextLabel?.font = .preferredFont(forTextStyle: .subheadline)
        cell.accessoryType = selected == nil ? .none : .disclosureIndicator
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        selected?(records[indexPath.row], self)
    }
}

final class MembersController: RecordsController {
    init(event: Event? = nil) {
        super.init(title: event == nil ? "새 대화" : "동행할 회원", path: ["api", event == nil ? "messages" : "companions", "members"], render: { row in
            (string(row, "name"), [string(row, "region"), string(row, "interest"), string(row, "intro")].filter { !$0.isEmpty }.joined(separator: " · "))
        }, selected: { row, controller in
            guard let id = row["id"] as? Int else { return }
            if let event = event {
                let form = NativeFormController(title: "동행 신청", fields: [FormField(key: "message", title: "함께하고 싶은 이유", multiline: true)], explanation: "\(string(row, "name"))님에게 '\(event.name)' 동행을 신청합니다.", submitTitle: "신청", send: { values, done in
                    Service.shared.json(["api", "companions"], body: ["targetUserId": id, "eventName": event.name, "message": values["message"] ?? ""]) { _, error in done(error) }
                }, success: { controller.navigationController?.popToViewController(controller, animated: true); controller.notice("동행 신청을 보냈습니다.") })
                controller.navigationController?.pushViewController(form, animated: true)
            } else { controller.navigationController?.pushViewController(ChatController(partnerId: id, name: string(row, "name")), animated: true) }
        })
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}

final class ConversationsController: RecordsController {
    init() {
        super.init(title: "쪽지함", path: ["api", "messages", "conversations"], render: { row in
            let unread = row["unread"] as? Int ?? 0
            return (string(row, "name") + (unread > 0 ? " · 새 쪽지 \(unread)" : ""), string(row, "lastPreview") + "\n" + string(row, "lastAt"))
        }, selected: { row, controller in
            guard let id = row["userId"] as? Int else { return }
            controller.navigationController?.pushViewController(ChatController(partnerId: id, name: string(row, "name")), animated: true)
        })
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad()
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "새 대화", style: .plain, target: self, action: #selector(compose))
    }
    @objc func compose() { requireLogin { self.navigationController?.pushViewController(MembersController(), animated: true) } }
}

final class CompanionInboxController: RecordsController {
    let direction = UISegmentedControl(items: ["받은 신청", "보낸 신청"])
    init() {
        super.init(title: "내 신청함", path: [], render: { row in
            (string(row, "event_name"), [string(row, "requester_name"), string(row, "target_name"), statusText(string(row, "status")), string(row, "message")].filter { !$0.isEmpty }.joined(separator: " · "))
        })
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad(); direction.selectedSegmentIndex = 0
        direction.addTarget(self, action: #selector(reload), for: .valueChanged); navigationItem.titleView = direction
    }
    override func reload() {
        let selection = direction.selectedSegmentIndex
        Service.shared.json(["api", "companions", selection == 0 ? "incoming" : "outgoing"]) { json, error in
            guard selection == self.direction.selectedSegmentIndex else { return }
            self.records = json as? [Record] ?? []; self.message = error ?? (self.records.isEmpty ? "아직 신청 내역이 없습니다." : "")
            self.refreshControl?.endRefreshing(); self.tableView.reloadData()
        }
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let row = records[indexPath.row]
        guard string(row, "status") == "pending", let id = row["id"] as? Int else { return }
        let alert = UIAlertController(title: string(row, "event_name"), message: string(row, "message"), preferredStyle: .alert)
        let actions = direction.selectedSegmentIndex == 0 ? [("수락", "accept"), ("거절", "decline")] : [("신청 취소", "cancel")]
        for (title, action) in actions {
            alert.addAction(UIAlertAction(title: title, style: action == "accept" ? .default : .destructive) { _ in
                Service.shared.json(["api", "companions", String(id), action], body: [:]) { _, error in
                    if let error = error { self.notice(error) } else { self.reload() }
                }
            })
        }
        alert.addAction(UIAlertAction(title: "닫기", style: .cancel)); present(alert, animated: true)
    }
}
