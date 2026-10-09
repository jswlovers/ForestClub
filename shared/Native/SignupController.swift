import UIKit

final class SignupConsentController: UITableViewController {
    var agreements = [false, false, false, false]
    let success: () -> Void
    init(success: @escaping () -> Void) { self.success = success; super.init(style: .grouped); title = "회원가입 · 약관 동의" }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() { super.viewDidLoad(); navigationItem.rightBarButtonItem = UIBarButtonItem(title: "다음", style: .done, target: self, action: #selector(proceedToIdentity)); update() }
    func update() { navigationItem.rightBarButtonItem?.isEnabled = agreements.prefix(3).allSatisfy { $0 }; tableView.reloadData() }
    override func numberOfSections(in tableView: UITableView) -> Int { 2 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { section == 0 ? 4 : 2 }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { section == 0 ? "필수 동의 후 회원 정보를 입력합니다." : "동의 내용 확인" }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
        cell.textLabel?.text = indexPath.section == 0 ? ["[필수] 만 19세 이상입니다", "[필수] 이용약관에 동의합니다", "[필수] 개인정보 수집·이용에 동의합니다", "[선택] 광고성 정보 수신에 동의합니다"][indexPath.row] : (indexPath.row == 0 ? "이용약관 전문" : "개인정보 처리방침 전문")
        cell.textLabel?.numberOfLines = 0; cell.accessoryType = indexPath.section == 0 ? (agreements[indexPath.row] ? .checkmark : .none) : .disclosureIndicator
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        if indexPath.section == 0 { agreements[indexPath.row].toggle(); update(); return }
        Service.shared.request([indexPath.row == 0 ? "terms.html" : "privacy.html"]) { data, error in
            guard let data = data, let rendered = try? NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.html, .characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil) else { self.notice(error ?? "약관을 불러오지 못했습니다."); return }
            self.navigationController?.pushViewController(TextPageController(title: "이용약관 · 개인정보 안내", sections: [("서비스 약관", rendered.string)]), animated: true)
        }
    }
    @objc func proceedToIdentity() {
        let fields: [FormField] = [
            FormField(key: "name", title: "이름", required: true),
            FormField(key: "birthDate", title: "생년월일 (YYYY-MM-DD)", required: true, keyboard: .numbersAndPunctuation),
            FormField(key: "gender", title: "성별", required: true, options: [("남성", "male"), ("여성", "female")]),
            FormField(key: "phone", title: "휴대전화 번호", required: true, keyboard: .phonePad)
        ]
        let wrapped = NativeFormController(title: "회원가입 · 본인 정보", fields: fields, explanation: "만 19세 이상만 가입할 수 있습니다. 서버에서 가입 가능 여부를 확인합니다.", submitTitle: "다음", send: { values, done in
            guard Self.isAdult(values["birthDate"] ?? "") else { done("생년월일을 확인해주세요. 만 19세 이상만 가입할 수 있습니다."); return }
            Service.shared.json(["api", "auth", "signup", "precheck"], body: values) { _, error in
                if let error = error { done(error); return }
                done(nil); self.openDetails(identity: values)
            }
        }, success: {})
        navigationController?.pushViewController(wrapped, animated: true)
    }
    static func isAdult(_ value: String) -> Bool {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
        guard let date = formatter.date(from: value), formatter.string(from: date) == value else { return false }
        return (Calendar.current.dateComponents([.year], from: date, to: Date()).year ?? 0) >= 19
    }
    func openDetails(identity: [String: String]) {
        let regions = ["서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시", "울산광역시", "세종특별자치시", "경기도", "강원특별자치도", "충청북도", "충청남도", "전북특별자치도", "전라남도", "경상북도", "경상남도", "제주특별자치도"]
        let golf = ["골프는 하지 않음", "입문 (1년 미만)", "1~3년", "3~5년", "5~10년", "10년 이상"]
        let form = NativeFormController(title: "회원가입 · 회원 정보", fields: [
            FormField(key: "nickname", title: "닉네임", required: true),
            FormField(key: "region", title: "거주 지역", required: true, options: regions.map { ($0, $0) }),
            FormField(key: "job", title: "직업", required: true),
            FormField(key: "maritalStatus", title: "혼인 여부", required: true, options: [("미혼", "single"), ("이혼 또는 사별", "divorced_widowed"), ("법률상 배우자가 있음", "married")]),
            FormField(key: "golfExperience", title: "골프 구력", required: true, options: golf.map { ($0, $0) }),
            FormField(key: "interest", title: "관심 분야", required: true, options: [("골프", "골프"), ("여행", "여행"), ("골프 · 여행 모두", "둘 다")]),
            FormField(key: "referrer", title: "추천인"), FormField(key: "intro", title: "자기소개", multiline: true),
            FormField(key: "email", title: "이메일", required: true, keyboard: .emailAddress),
            FormField(key: "password", title: "비밀번호 (8자 이상)", required: true, secure: true)
        ], explanation: "회원가입이 멤버십 지원으로 접수됩니다. 심사 결과는 내 지원 현황에서 확인하세요.", submitTitle: "가입 신청", send: { values, done in
            guard (values["password"] ?? "").count >= 8 else { done("비밀번호는 8자 이상이어야 합니다."); return }
            guard values["maritalStatus"] != "married" else { done("서비스 이용약관에 따라 법률상 배우자가 없는 분만 가입할 수 있습니다."); return }
            var body: Record = identity; values.forEach { body[$0.key] = $0.value }
            body["ageAgreed"] = self.agreements[0]; body["termsAgreed"] = self.agreements[1]; body["privacyAgreed"] = self.agreements[2]; body["marketingAgreed"] = self.agreements[3]
            Service.shared.json(["api", "auth", "signup"], body: body) { _, error in done(error) }
        }, success: { self.success() })
        navigationController?.pushViewController(form, animated: true)
    }
}
