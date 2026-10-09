import UIKit

// Draw template icons with UIKit because SF Symbols are unavailable on iOS 12.
enum MenuIcon {
    case home, events, account, menu
    static func draw(_ kind: MenuIcon) -> UIImage {
        return UIGraphicsImageRenderer(size: CGSize(width: 26, height: 26)).image { _ in
            UIColor.black.setStroke()
            let path = UIBezierPath()
            path.lineWidth = 2
            path.lineCapStyle = .round
            path.lineJoinStyle = .round
            switch kind {
            case .home:
                path.move(to: CGPoint(x: 2, y: 12)); path.addLine(to: CGPoint(x: 13, y: 3)); path.addLine(to: CGPoint(x: 24, y: 12))
                path.move(to: CGPoint(x: 6, y: 10)); path.addLine(to: CGPoint(x: 6, y: 23)); path.addLine(to: CGPoint(x: 20, y: 23)); path.addLine(to: CGPoint(x: 20, y: 10))
            case .events:
                path.append(UIBezierPath(roundedRect: CGRect(x: 3, y: 5, width: 20, height: 18), cornerRadius: 3))
                path.move(to: CGPoint(x: 3, y: 11)); path.addLine(to: CGPoint(x: 23, y: 11))
                for x in [8, 18] { path.move(to: CGPoint(x: x, y: 2)); path.addLine(to: CGPoint(x: x, y: 7)) }
            case .account:
                path.append(UIBezierPath(ovalIn: CGRect(x: 8, y: 2, width: 10, height: 10)))
                path.move(to: CGPoint(x: 3, y: 24)); path.addCurve(to: CGPoint(x: 23, y: 24), controlPoint1: CGPoint(x: 3, y: 10), controlPoint2: CGPoint(x: 23, y: 10))
            case .menu:
                for y in [6, 13, 20] { path.move(to: CGPoint(x: 3, y: y)); path.addLine(to: CGPoint(x: 23, y: y)) }
            }
            path.stroke()
        }.withRenderingMode(.alwaysTemplate)
    }
}

final class MenuController: UITableViewController {
    let items = [["골프모임", "여행모임"], ["로그인 · 회원가입 · 서버 설정"], ["클럽 소개", "멤버십 · 지원하기", "멤버 후기", "내 프로필", "내 지원 현황", "내 신청함", "쪽지함", "코인 충전", "고객센터"]]
    init() { super.init(style: .grouped) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() { super.viewDidLoad(); title = "전체 메뉴" }
    override func numberOfSections(in tableView: UITableView) -> Int { items.count }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { items[section].count }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { ["모임", "회원 계정", "회원 웹 서비스"][section] }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        section == 2 ? "회원 웹 서비스는 연결된 웹사이트에서 이용합니다. 서버 연결 전에도 메뉴를 확인할 수 있습니다." : nil
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
        cell.textLabel?.text = items[indexPath.section][indexPath.row]
        cell.textLabel?.numberOfLines = 0
        cell.accessoryType = .disclosureIndicator
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        if indexPath.section == 0 {
            let events = EventsController(home: false)
            events.categories.selectedSegmentIndex = indexPath.row + 1
            // EventsController defaults to all during viewDidLoad; set the filter after loading.
            events.loadViewIfNeeded()
            events.categories.selectedSegmentIndex = indexPath.row + 1
            navigationController?.pushViewController(events, animated: true)
        } else if indexPath.section == 1 {
            navigationController?.pushViewController(AccountController(), animated: true)
        } else {
            let destination = WebMenuController(menuTitle: items[indexPath.section][indexPath.row])
            navigationController?.pushViewController(destination, animated: true)
        }
    }
}

final class WebMenuController: UITableViewController {
    let menuTitle: String
    init(menuTitle: String) { self.menuTitle = menuTitle; super.init(style: .grouped) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() { super.viewDidLoad(); title = menuTitle }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { 1 }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { "\(menuTitle)은 웹 서비스에서 이용합니다." }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        Service.shared.live ? "회원 메뉴는 웹사이트 로그인 후 선택해주세요. 웹사이트의 iOS 12 지원 여부에 따라 기능 사용이 제한될 수 있습니다." : "마이페이지에서 서비스 서버를 먼저 연결해주세요."
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
        cell.textLabel?.text = Service.shared.live ? "웹 서비스 열기" : "서버 연결 설정"
        cell.accessoryType = .disclosureIndicator
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard Service.shared.live, var components = URLComponents(string: Service.shared.address) else {
            navigationController?.pushViewController(AccountController(), animated: true); return
        }
        components.fragment = ["클럽 소개": "about", "멤버십 · 지원하기": "membership", "멤버 후기": "voice"][menuTitle]
        if let url = components.url { UIApplication.shared.open(url) }
    }
}
