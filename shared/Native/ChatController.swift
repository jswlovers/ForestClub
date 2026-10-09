import UIKit
import QuickLook

final class ChatController: UIViewController, UITableViewDataSource, UITableViewDelegate, UITextViewDelegate, QLPreviewControllerDataSource, UIDocumentPickerDelegate {
    let partnerId: Int
    let table = UITableView(frame: .zero, style: .plain)
    let input = UITextView()
    let send = UIButton(type: .system)
    let balanceLabel = UILabel()
    var messages: [Record] = []
    var bottom: NSLayoutConstraint!
    var timer: Timer?
    var sending = false
    var previewURL: URL?
    var keyboardObserver: NSObjectProtocol?
    var loginObserver: NSObjectProtocol?
    init(partnerId: Int, name: String) { self.partnerId = partnerId; super.init(nibName: nil, bundle: nil); title = name }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    deinit { timer?.invalidate(); for observer in [keyboardObserver, loginObserver].compactMap({ $0 }) { NotificationCenter.default.removeObserver(observer) } }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .white
        table.dataSource = self; table.delegate = self; table.keyboardDismissMode = .interactive
        table.rowHeight = UITableView.automaticDimension; table.estimatedRowHeight = 90
        input.font = .preferredFont(forTextStyle: .body); input.delegate = self
        input.layer.borderColor = UIColor.lightGray.cgColor; input.layer.borderWidth = 1; input.layer.cornerRadius = 8
        input.accessibilityLabel = "쪽지 내용"
        send.setTitle("보내기", for: .normal); send.addTarget(self, action: #selector(sendText), for: .touchUpInside)
        balanceLabel.font = .preferredFont(forTextStyle: .caption1); balanceLabel.text = "쪽지 1건당 500코인 · 최대 200자"
        balanceLabel.numberOfLines = 0
        let compose = UIStackView(arrangedSubviews: [input, send]); compose.spacing = 10
        let footer = UIStackView(arrangedSubviews: [balanceLabel, compose]); footer.axis = .vertical; footer.spacing = 8
        view.addSubview(table); view.addSubview(footer)
        table.translatesAutoresizingMaskIntoConstraints = false; footer.translatesAutoresizingMaskIntoConstraints = false
        bottom = footer.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -10)
        NSLayoutConstraint.activate([
            table.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), table.leadingAnchor.constraint(equalTo: view.leadingAnchor), table.trailingAnchor.constraint(equalTo: view.trailingAnchor), table.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -8),
            footer.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12), footer.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12), bottom,
            input.heightAnchor.constraint(equalToConstant: 72), send.widthAnchor.constraint(equalToConstant: 62)
        ])
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "첨부", style: .plain, target: self, action: #selector(attach))
        loginObserver = NotificationCenter.default.addObserver(forName: .clubLoginChanged, object: nil, queue: .main) { [weak self] _ in
            guard let self = self else { return }
            if Service.shared.userId == nil {
                self.messages = []; self.table.reloadData(); self.input.text = ""; self.timer?.invalidate(); self.send.isEnabled = false; self.balanceLabel.text = "로그인이 필요합니다."
            } else { self.send.isEnabled = true }
        }
        keyboardObserver = NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] notification in
            guard let self = self, let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
            let local = self.view.convert(frame, from: nil)
            self.bottom.constant = -max(10, self.view.bounds.height - local.minY - self.view.safeAreaInsets.bottom + 10)
            let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
            UIView.animate(withDuration: duration) { self.view.layoutIfNeeded() }
        }
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        requireLogin {
            self.reload(scroll: true)
            self.timer?.invalidate()
            self.timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in self?.reload(scroll: false) }
        }
    }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); timer?.invalidate(); timer = nil }
    func reload(scroll: Bool) {
        Service.shared.json(["api", "messages", "conversations", String(partnerId)]) { json, error in
            if let error = error {
                self.balanceLabel.text = error
                if Service.shared.userId == nil { self.timer?.invalidate(); self.send.isEnabled = false }
                return
            }
            guard let response = json as? Record else { return }
            let rows = response["messages"] as? [Record] ?? []
            let countChanged = rows.count != self.messages.count
            self.messages = rows; self.table.reloadData()
            if (scroll || countChanged) && !rows.isEmpty { self.table.scrollToRow(at: IndexPath(row: rows.count - 1, section: 0), at: .bottom, animated: !scroll) }
            self.refreshBalance()
        }
    }
    func refreshBalance() {
        Service.shared.json(["api", "coins", "balance"]) { json, error in
            if let coins = (json as? Record)?["coins"] as? Int { self.balanceLabel.text = "보유 \(coins)코인 · 발송 500코인 · 최대 200자" }
            else if let error = error { self.balanceLabel.text = error }
        }
    }
    @objc func sendText() {
        let text = input.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sending, !text.isEmpty else { return }
        guard text.utf16.count <= 200 else { notice("쪽지는 200자 이하로 입력해주세요."); return }
        beginSend()
        Service.shared.json(["api", "messages"], body: ["recipientUserId": partnerId, "body": text]) { _, error in
            self.endSend(error)
            if error == nil { self.input.text = "" }
        }
    }
    func beginSend() { sending = true; send.isEnabled = false; navigationItem.rightBarButtonItem?.isEnabled = false; input.isEditable = false }
    func endSend(_ error: String?) {
        sending = false; send.isEnabled = true; navigationItem.rightBarButtonItem?.isEnabled = true; input.isEditable = true
        if let error = error { notice(error) } else { reload(scroll: true) }
    }
    @objc func attach() {
        let picker = UIDocumentPickerViewController(documentTypes: ["public.data"], in: .import)
        picker.delegate = self; present(picker, animated: true)
    }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else { return }
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 15 * 1024 * 1024 else { notice("첨부파일은 15MB 이하로 선택해주세요."); return }
        guard let data = try? Data(contentsOf: url) else { notice("첨부파일을 읽지 못했습니다."); return }
        let alert = UIAlertController(title: "첨부파일 전송", message: "\(url.lastPathComponent)\n발송 시 500코인이 사용됩니다.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "취소", style: .cancel))
        alert.addAction(UIAlertAction(title: "보내기", style: .default) { _ in
            self.beginSend()
            Service.shared.uploadMessage(partnerId: self.partnerId, filename: url.lastPathComponent, data: data) { error in self.endSend(error) }
        })
        present(alert, animated: true)
    }
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { messages.count }
    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let row = messages[indexPath.row]
        let mine = row["sender_id"] as? Int == Service.shared.userId
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.text = (mine ? "나: " : "상대: ") + string(row, "body")
        cell.textLabel?.numberOfLines = 0; cell.textLabel?.font = .preferredFont(forTextStyle: .body)
        cell.textLabel?.textColor = mine ? green : .black
        cell.detailTextLabel?.text = [string(row, "attachment_name"), string(row, "created_at")].filter { !$0.isEmpty }.joined(separator: " · ")
        cell.detailTextLabel?.numberOfLines = 0
        cell.accessoryType = string(row, "attachment_url").hasPrefix("/api/messages/attachments/") ? .disclosureIndicator : .none
        return cell
    }
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let row = messages[indexPath.row], path = string(row, "attachment_url")
        guard path.hasPrefix("/api/messages/attachments/") else { return }
        Service.shared.attachment(path) { data, error in
            guard let data = data else { self.notice(error ?? "첨부파일을 열 수 없습니다."); return }
            do {
                let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let name = (string(row, "attachment_name") as NSString).lastPathComponent
                let file = folder.appendingPathComponent(name.isEmpty ? "첨부파일" : name)
                try data.write(to: file, options: .atomic)
                self.previewURL = file
                let preview = QLPreviewController(); preview.dataSource = self; self.present(preview, animated: true)
            } catch { self.notice("첨부파일을 열지 못했습니다.") }
        }
    }
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { previewURL == nil ? 0 : 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { previewURL! as NSURL }
}
