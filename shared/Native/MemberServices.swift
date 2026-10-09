import UIKit

final class CoinsController: UITableViewController {
    var balance = "불러오는 중…"
    var charges: [Record] = []
    var ledger: [Record] = []
    var errorText: String?
    var loading = false
    private var loginObserver: NSObjectProtocol?
    init() { super.init(style: .grouped); title = "코인" }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad(); tableView.rowHeight = UITableView.automaticDimension; tableView.estimatedRowHeight = 90
        refreshControl = UIRefreshControl(); refreshControl?.addTarget(self, action: #selector(reload), for: .valueChanged)
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "충전 신청", style: .plain, target: self, action: #selector(charge))
        loginObserver = NotificationCenter.default.addObserver(forName: .clubLoginChanged, object: nil, queue: .main) { [weak self] _ in
            if Service.shared.userId == nil { self?.charges = []; self?.ledger = []; self?.balance = "로그인이 필요합니다."; self?.tableView.reloadData() }
        }
    }
    deinit { if let observer = loginObserver { NotificationCenter.default.removeObserver(observer) } }
    override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); requireLogin { self.reload() } }
    @objc func reload() {
        guard !loading else { return }; loading = true
        let group = DispatchGroup(); errorText = nil; charges = []; ledger = []; balance = "불러오는 중…"
        group.enter(); Service.shared.json(["api", "coins", "balance"]) { json, error in
            if let record = json as? Record, let value = (record["available"] ?? record["coins"]) as? Int { self.balance = "\(value) 코인" } else { self.balance = "잔액 확인 실패"; self.errorText = error }; group.leave()
        }
        group.enter(); Service.shared.json(["api", "coins", "charge-requests", "me"]) { json, error in self.charges = json as? [Record] ?? []; if let error = error { self.errorText = error }; group.leave() }
        group.enter(); Service.shared.json(["api", "coins", "ledger"]) { json, error in self.ledger = json as? [Record] ?? []; if let error = error { self.errorText = error }; group.leave() }
        group.notify(queue: .main) { self.loading = false; self.refreshControl?.endRefreshing(); self.tableView.reloadData() }
    }
    @objc func charge() {
        requireLogin {
            let form = NativeFormController(title: "코인 충전 신청", fields: [FormField(key: "amountKrw", title: "충전 금액 (원)", required: true, keyboard: .numberPad)], explanation: "최소 1,000원 · 1원 = 1코인\n무통장입금 충전 신청입니다. 운영진이 입금을 확인하고 승인하면 코인이 지급됩니다.", submitTitle: "신청", send: { values, done in
                Service.shared.json(["api", "coins", "charge-requests"], body: ["amountKrw": Int(values["amountKrw"] ?? "") ?? 0, "provider": "manual"]) { _, error in done(error) }
            }, success: { self.navigationController?.popToViewController(self, animated: true); self.notice("충전 신청을 접수했습니다. 운영진의 입금 확인과 승인을 기다려주세요.") })
            form.validate = { values in (Int(values["amountKrw"] ?? "") ?? 0) < 1000 ? "최소 1,000원부터 신청할 수 있습니다." : nil }
            self.navigationController?.pushViewController(form, animated: true)
        }
    }
    override func numberOfSections(in tableView: UITableView) -> Int { 3 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { section == 0 ? 1 : max(1, section == 1 ? charges.count : ledger.count) }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { ["보유 코인", "충전 신청 내역", "코인 사용 내역"][section] }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? { section == 0 ? errorText : nil }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil); cell.selectionStyle = .none
        cell.textLabel?.numberOfLines = 0; cell.detailTextLabel?.numberOfLines = 0
        if indexPath.section == 0 { cell.textLabel?.text = balance; cell.detailTextLabel?.text = "텍스트·첨부 쪽지 발송은 1건당 500코인"; return cell }
        let rows = indexPath.section == 1 ? charges : ledger
        guard !rows.isEmpty else { cell.textLabel?.text = "내역이 없습니다."; return cell }
        let row = rows[indexPath.row]
        if indexPath.section == 1 {
            cell.textLabel?.text = string(row, "amount_krw") + "원 · " + statusText(string(row, "status"))
            cell.detailTextLabel?.text = [string(row, "created_at"), string(row, "admin_note")].filter { !$0.isEmpty }.joined(separator: "\n")
        } else {
            cell.textLabel?.text = (string(row, "direction") == "credit" ? "+" : "−") + string(row, "amount") + " 코인"
            cell.detailTextLabel?.text = string(row, "note") + "\n" + string(row, "created_at")
        }
        return cell
    }
}

final class SupportController: RecordsController {
    init() {
        super.init(title: "고객센터", path: ["api", "tickets", "me"], render: { row in
            (string(row, "subject") + " · " + statusText(string(row, "status")), [string(row, "body"), string(row, "admin_note"), string(row, "created_at")].filter { !$0.isEmpty }.joined(separator: "\n"))
        })
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad(); navigationItem.rightBarButtonItem = UIBarButtonItem(title: "문의하기", style: .plain, target: self, action: #selector(compose))
    }
    @objc func compose() {
        requireLogin {
            let alert = UIAlertController(title: "문의 유형", message: nil, preferredStyle: .alert)
            for (title, category) in [("일반 문의", "other"), ("불편 사항", "complaint"), ("환불 문의", "refund"), ("회원 신고", "report")] {
                alert.addAction(UIAlertAction(title: title, style: .default) { _ in
                    if category == "report" {
                        let members = RecordsController(title: "신고할 회원", path: ["api", "tickets", "target-members"], render: { row in (string(row, "name"), "") }, selected: { row, controller in
                            self.openForm(category: category, targetId: row["id"] as? Int, parent: controller)
                        })
                        self.navigationController?.pushViewController(members, animated: true)
                    } else { self.openForm(category: category, targetId: nil, parent: self) }
                })
            }
            alert.addAction(UIAlertAction(title: "취소", style: .cancel)); self.present(alert, animated: true)
        }
    }
    func openForm(category: String, targetId: Int?, parent: UIViewController) {
        let form = NativeFormController(title: "문의 작성", fields: [FormField(key: "subject", title: "제목", required: true), FormField(key: "body", title: "내용", required: true, multiline: true)], submitTitle: "접수", send: { values, done in
            var body: Record = values; body["category"] = category
            if let targetId = targetId { body["targetUserId"] = targetId }
            Service.shared.json(["api", "tickets"], body: body) { _, error in done(error) }
        }, success: { self.navigationController?.popToViewController(self, animated: true); self.notice("문의가 접수되었습니다.") })
        parent.navigationController?.pushViewController(form, animated: true)
    }
}

extension UIViewController {
    func openProfile() {
        requireLogin {
            Service.shared.json(["api", "auth", "me"]) { json, error in
                guard let profile = json as? Record else { self.notice(error ?? "프로필을 읽을 수 없습니다."); return }
                let fields = [("phone", "연락처"), ("ageGroup", "연령대"), ("region", "지역"), ("job", "직업"), ("golfExperience", "골프 구력"), ("interest", "관심 분야"), ("intro", "자기소개")].map { key, title in
                    FormField(key: key, title: title, value: string(profile, key), keyboard: key == "phone" ? .phonePad : .default, multiline: key == "intro")
                }
                let form = NativeFormController(title: "내 프로필", fields: fields, explanation: "연락처는 010-1234-5678 형식으로 입력해주세요.", send: { values, done in
                    Service.shared.json(["api", "auth", "profile"], body: values, method: "PATCH") { _, error in done(error) }
                }, success: { self.navigationController?.popToViewController(self, animated: true); self.notice("프로필을 저장했습니다.") })
                self.navigationController?.pushViewController(form, animated: true)
            }
        }
    }
    func openApplication() {
        requireLogin {
            Service.shared.json(["api", "auth", "me"]) { json, error in
                guard let profile = json as? Record else { self.notice(error ?? "계정을 확인하지 못했습니다."); return }
                let fields = [("name", "이름"), ("phone", "연락처"), ("email", "이메일"), ("ageGroup", "연령대"), ("region", "지역"), ("job", "직업"), ("golfExperience", "골프 구력"), ("interest", "관심 분야"), ("referrer", "추천인"), ("intro", "자기소개")].map { key, title in
                    FormField(key: key, title: title, value: string(profile, key), required: ["name", "phone", "email"].contains(key), keyboard: key == "email" ? .emailAddress : (key == "phone" ? .phonePad : .default), multiline: key == "intro")
                }
                let form = NativeFormController(title: "멤버십 지원서", fields: fields, explanation: "온라인 지원 → 서류 심사 → 멤버 인터뷰 → 승인 및 웰컴 라운딩", submitTitle: "지원", send: { values, done in
                    Service.shared.json(["api", "applications"], body: values) { _, error in done(error) }
                }, success: { self.navigationController?.popToViewController(self, animated: true); self.notice("멤버십 지원서가 접수되었습니다.") })
                self.navigationController?.pushViewController(form, animated: true)
            }
        }
    }
}

extension UIViewController {
    func openMembershipStatus() {
        requireLogin {
            Service.shared.json(["api", "auth", "me"]) { json, error in
                guard let user = json as? Record else { self.notice(error ?? "심사 상태를 확인하지 못했습니다."); return }
                if let status = user["status"] as? String {
                    let message = status == "pending" ? "회원가입이 멤버십 지원으로 접수되었습니다. 심사 승인 후 회원 서비스를 이용할 수 있습니다." : (status == "approved" ? "멤버십이 승인되었습니다." : string(user, "rejectedReason"))
                    let controller = TextPageController(title: "내 지원 현황", sections: [("멤버십 가입 심사", statusText(status)), ("안내", message), ("내 정보", [string(user, "interest"), string(user, "golfExperience"), string(user, "region")].filter { !$0.isEmpty }.joined(separator: " · "))])
                    self.navigationController?.pushViewController(controller, animated: true)
                } else {
                    let controller = RecordsController(title: "내 지원 현황", path: ["api", "applications", "me"], render: { row in (statusText(string(row, "status")), [string(row, "created_at"), string(row, "admin_note")].filter { !$0.isEmpty }.joined(separator: "\n")) })
                    self.navigationController?.pushViewController(controller, animated: true)
                }
            }
        }
    }
}
