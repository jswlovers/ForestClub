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
    let items = [["함께 라운딩", "함께 떠나는 여행"], ["로그인 · 회원가입 · 계정 관리"], ["쪽지함", "내 신청함", "For Rest 소개", "이런 분께", "멤버십 · 지원하기", "내 프로필", "내 지원 현황", "코인 충전", "고객센터"]]
    init() { super.init(style: .grouped) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() { super.viewDidLoad(); title = "전체 메뉴" }
    override func numberOfSections(in tableView: UITableView) -> Int { items.count }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { items[section].count }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { ["만남 뒤 모임", "회원 계정", "만남과 회원 서비스"][section] }
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
        // 웹 첫 화면(public/index.html)의 FOR REST · HOW WE MEET · FOR YOU 섹션과 같은 내용.
        case "For Rest 소개":
            navigationController?.pushViewController(TextPageController(title: title, sections: [
                ("For Rest, Forest", "For Rest를 줄이면 Forest가 됩니다. 숲에서 쉬듯, 사람에게서 쉬는 시간. 애쓰지 않아도 편안한 사람, 함께 있으면 쉬어지는 만남을 만듭니다."),
                ("검증된 사람들", "서류 심사와 인터뷰를 거쳐 승인된 회원끼리만 만납니다."),
                ("휴식 같은 만남은 이렇게", "01 프로필과 쪽지로 인사를 건네고\n02 편해지면 보이스톡, 더 가까워지면 페이스톡\n03 모임 참석이나 동행 신청으로 편안한 첫 만남\n04 마음이 통했다면 함께할 소규모 라운딩을 추천해 드립니다"),
                ("가입 절차", "회원가입 · 지원 → 서류 심사 → 멤버 인터뷰 → 승인, 그리고 첫 인사")
            ]), animated: true)
        case "이런 분께":
            navigationController?.pushViewController(TextPageController(title: title, sections: [
                ("쉼이 되는 만남", "일과 책임으로 꽉 찬 하루 끝에, 아무 말 없이도 편안한 사람을 만나고 싶은 분"),
                ("천천히 알아가는 대화", "가벼운 만남보다 대화로 천천히 서로를 알아가는 시간이 더 소중한 분"),
                ("만남 뒤의 즐거움", "마음 맞는 사람과 주말 라운딩이나 짧은 여행을 함께하고 싶은 분")
            ]), animated: true)
        case "멤버십 · 지원하기": openMembershipStatus()
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
                    self.openMembershipStatus(); return
                }
                self.navigationController?.pushViewController(controller, animated: true)
            }
        }
    }
}

enum NativeApp {
    static func makeRoot() -> UITabBarController {
        ClubTheme.apply()
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
        CallMonitor.shared.start()
        return tabs
    }
}
