import UIKit

struct FormField {
    let key: String
    let title: String
    var value: String = ""
    var required = false
    var keyboard: UIKeyboardType = .default
    var secure = false
    var multiline = false
    var options: [(String, String)] = []
}

final class NativeFormController: UITableViewController, UIPickerViewDataSource, UIPickerViewDelegate {
    private var selectedValues: [String: String] = [:]
    let fields: [FormField]
    let explanation: String?
    let submitTitle: String
    var textFields: [String: UITextField] = [:]
    var textViews: [String: UITextView] = [:]
    var validate: (([String: String]) -> String?)?
    let send: ([String: String], @escaping (String?) -> Void) -> Void
    let success: () -> Void
    var saving = false
    private let boundUserId: Int?
    private var loginObserver: NSObjectProtocol?
    init(title: String, fields: [FormField], explanation: String? = nil, submitTitle: String = "저장", send: @escaping ([String: String], @escaping (String?) -> Void) -> Void, success: @escaping () -> Void) {
        self.boundUserId = Service.shared.userId
        self.fields = fields; self.explanation = explanation; self.submitTitle = submitTitle; self.send = send; self.success = success
        super.init(style: .grouped); self.title = title
        for field in fields {
            if field.multiline {
                let input = UITextView(); input.text = field.value; input.font = .preferredFont(forTextStyle: .body)
                input.accessibilityLabel = field.title; input.isScrollEnabled = false; input.backgroundColor = .clear
                textViews[field.key] = input
            } else {
                let input = UITextField(); input.text = field.value; input.placeholder = field.title
                input.keyboardType = field.keyboard; input.isSecureTextEntry = field.secure
                input.font = .preferredFont(forTextStyle: .body); input.accessibilityLabel = field.title
                if field.keyboard == .emailAddress || field.secure { input.autocapitalizationType = .none; input.autocorrectionType = .no }
                if field.key == "email" { input.textContentType = .username }
                if field.secure { input.textContentType = .password }
                if !field.options.isEmpty {
                    let picker = UIPickerView(); picker.tag = fields.firstIndex(where: { $0.key == field.key }) ?? 0; picker.dataSource = self; picker.delegate = self
                    input.inputView = picker
                    if let choice = field.options.first(where: { $0.1 == field.value }) { input.text = choice.0; selectedValues[field.key] = choice.1 }
                    let toolbar = UIToolbar(); toolbar.sizeToFit(); toolbar.items = [UIBarButtonItem(title: "완료", style: .done, target: self, action: #selector(endEditing))]; input.inputAccessoryView = toolbar
                }
                textFields[field.key] = input
            }
        }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad()
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: submitTitle, style: .done, target: self, action: #selector(submit))
        tableView.keyboardDismissMode = .interactive
        tableView.rowHeight = UITableView.automaticDimension
        tableView.estimatedRowHeight = 88
        loginObserver = NotificationCenter.default.addObserver(forName: .clubLoginChanged, object: nil, queue: .main) { [weak self] _ in
            guard let self = self, let bound = self.boundUserId, bound != Service.shared.userId else { return }
            for field in self.textFields.values { field.text = "" }
            for field in self.textViews.values { field.text = "" }
            self.tableView.isUserInteractionEnabled = false; self.navigationItem.rightBarButtonItem?.isEnabled = false
        }
    }
    deinit { if let observer = loginObserver { NotificationCenter.default.removeObserver(observer) } }
    override func numberOfSections(in tableView: UITableView) -> Int { fields.count }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { 1 }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { fields[section].title + (fields[section].required ? " *" : "") }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? { section == fields.count - 1 ? explanation : nil }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
        cell.selectionStyle = .none
        let field = fields[indexPath.section]
        let input: UIView = field.multiline ? textViews[field.key]! : textFields[field.key]!
        input.translatesAutoresizingMaskIntoConstraints = false
        cell.contentView.addSubview(input)
        NSLayoutConstraint.activate([
            input.topAnchor.constraint(equalTo: cell.contentView.topAnchor, constant: 12),
            input.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor, constant: -12),
            input.leadingAnchor.constraint(equalTo: cell.contentView.leadingAnchor, constant: 16),
            input.trailingAnchor.constraint(equalTo: cell.contentView.trailingAnchor, constant: -16),
            input.heightAnchor.constraint(greaterThanOrEqualToConstant: field.multiline ? 110 : 32)
        ])
        return cell
    }
    func numberOfComponents(in pickerView: UIPickerView) -> Int { 1 }
    func pickerView(_ pickerView: UIPickerView, numberOfRowsInComponent component: Int) -> Int { fields[pickerView.tag].options.count + 1 }
    func pickerView(_ pickerView: UIPickerView, titleForRow row: Int, forComponent component: Int) -> String? { row == 0 ? "선택해주세요" : fields[pickerView.tag].options[row - 1].0 }
    func pickerView(_ pickerView: UIPickerView, didSelectRow row: Int, inComponent component: Int) {
        let field = fields[pickerView.tag]
        selectedValues[field.key] = row == 0 ? "" : field.options[row - 1].1
        textFields[field.key]?.text = row == 0 ? "" : field.options[row - 1].0
    }
    @objc func endEditing() { view.endEditing(true) }
    @objc func close() { dismiss(animated: true) }
    @objc func submit() {
        guard !saving else { return }
        if let bound = boundUserId, bound != Service.shared.userId { notice("로그인이 변경되었습니다. 메뉴에서 다시 열어주세요."); return }
        view.endEditing(true)
        var values: [String: String] = [:]
        for field in fields {
            let text = field.options.isEmpty ? (textFields[field.key]?.text ?? textViews[field.key]?.text ?? "") : (selectedValues[field.key] ?? "")
            values[field.key] = field.secure ? text : text.trimmingCharacters(in: .whitespacesAndNewlines)
            if field.required && values[field.key]?.isEmpty != false { notice("\(field.title)을 입력해주세요."); return }
        }
        if let error = validate?(values) { notice(error); return }
        saving = true
        navigationItem.rightBarButtonItem?.isEnabled = false
        tableView.isUserInteractionEnabled = false
        send(values) { error in
            self.saving = false; self.navigationItem.rightBarButtonItem?.isEnabled = true; self.tableView.isUserInteractionEnabled = true
            if let error = error { self.notice(error); return }
            self.success()
        }
    }
    static func login(signup: Bool, success: @escaping () -> Void) -> NativeFormController {
        var fields: [FormField] = []
        if signup { fields.append(FormField(key: "name", title: "이름", required: true)) }
        fields.append(FormField(key: "email", title: "이메일", required: true, keyboard: .emailAddress))
        fields.append(FormField(key: "password", title: "비밀번호", required: true, secure: true))
        let form = NativeFormController(title: signup ? "회원가입" : "로그인", fields: fields, explanation: "한 번 로그인하면 쪽지·코인·프로필·신청함을 모두 앱 안에서 이용할 수 있습니다.", submitTitle: signup ? "가입" : "로그인", send: { values, done in
            Service.shared.json(["api", "auth", signup ? "signup" : "login"], body: values) { _, error in done(error) }
        }, success: success)
        form.validate = { values in signup && (values["password"] ?? "").count < 8 ? "비밀번호는 8자 이상이어야 합니다." : nil }
        return form
    }
}

final class TextPageController: UITableViewController {
    let sections: [(String, String)]
    init(title: String, sections: [(String, String)]) { self.sections = sections; super.init(style: .grouped); self.title = title }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func numberOfSections(in tableView: UITableView) -> Int { sections.count }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { 1 }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { sections[section].0 }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
        cell.textLabel?.text = sections[indexPath.section].1; cell.textLabel?.numberOfLines = 0
        cell.textLabel?.font = .preferredFont(forTextStyle: .body); cell.selectionStyle = .none
        return cell
    }
}
