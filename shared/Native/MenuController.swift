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
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { ["모임", "회원 계정", "회원 서비스"][section] }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        section == 2 ? "모든 회원 기능은 앱 안에서 한 번의 로그인으로 이용합니다." : nil
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
            openNativeMenu(items[indexPath.section][indexPath.row])
        }
    }
}


extension UIViewController {
    func openNativeMenu(_ title: String) {
        switch title {
        case "클럽 소개":
            navigationController?.pushViewController(TextPageController(title: title, sections: [("포레스트클럽", "골프와 여행을 함께 즐기는 프라이빗 멤버십입니다."), ("함께하는 경험", "소규모 라운딩과 국내외 골프·여행 모임에서 취향을 나눕니다."), ("가입 절차", "온라인 지원서 → 서류 심사 → 멤버 인터뷰 → 승인 및 웰컴")]), animated: true)
        case "멤버 후기":
            navigationController?.pushViewController(TextPageController(title: title, sections: [("소개 자료의 후기", "비슷한 위치에서 비슷한 고민을 나눌 수 있는 자리가 드물었는데, 여기서는 편하게 말할 수 있어요."), ("라운딩", "라운딩 인원이 적어서 좋았습니다. 기다림 없이 여유롭게, 대화도 충분히 나눌 수 있어요."), ("여행", "스코틀랜드 투어는 평생 잊지 못할 경험이었습니다. 일정 하나하나가 세심했어요.")]), animated: true)
        case "멤버십 · 지원하기": openApplication()
        case "내 프로필": openProfile()
        default:
            requireLogin {
                let controller: UIViewController
                switch title {
                case "쪽지함": controller = ConversationsController()
                case "코인 충전": controller = CoinsController()
                case "내 신청함": controller = CompanionInboxController()
                case "고객센터": controller = SupportController()
                default:
                    controller = RecordsController(title: "내 지원 현황", path: ["api", "applications", "me"], render: { row in
                        (statusText(string(row, "status")), [string(row, "created_at"), string(row, "admin_note")].filter { !$0.isEmpty }.joined(separator: "\n"))
                    })
                }
                self.navigationController?.pushViewController(controller, animated: true)
            }
        }
    }
}

enum NativeApp {
    static func makeRoot() -> UITabBarController {
        let tabs = UITabBarController()
        let controllers: [UIViewController] = [EventsController(home: true), EventsController(home: false), AccountController(), MenuController()]
        let labels = ["홈", "모임", "마이페이지", "전체 메뉴"]
        let icons: [MenuIcon] = [.home, .events, .account, .menu]
        tabs.viewControllers = controllers.enumerated().map { index, controller in
            let navigation = UINavigationController(rootViewController: controller)
            navigation.tabBarItem = UITabBarItem(title: labels[index], image: MenuIcon.draw(icons[index]), tag: index)
            navigation.navigationBar.tintColor = green
            return navigation
        }
        tabs.tabBar.tintColor = green
        if #available(iOS 13.0, *) { tabs.overrideUserInterfaceStyle = .light }
        if !Service.shared.address.isEmpty { Service.shared.restoreUser { _ in } }
        return tabs
    }
}
