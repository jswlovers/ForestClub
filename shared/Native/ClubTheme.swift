import UIKit

/// 웹(public/assets/style.css)과 같은 색과 서체. 앱 전체 분위기는 여기 한 곳에서 정한다.
/// 진녹색(forest)·골드·크림 배경에 제목은 세리프 — 웹의 Playfair Display 자리에 iOS 기본 세리프를 쓴다.
enum ClubTheme {
    static let forest = UIColor(red: 27 / 255, green: 51 / 255, blue: 40 / 255, alpha: 1)    // #1b3328
    static let forestDeep = UIColor(red: 19 / 255, green: 37 / 255, blue: 32 / 255, alpha: 1) // #132520
    static let gold = UIColor(red: 184 / 255, green: 146 / 255, blue: 79 / 255, alpha: 1)    // #b8924f
    static let goldLight = UIColor(red: 230 / 255, green: 211 / 255, blue: 171 / 255, alpha: 1) // #e6d3ab
    static let cream = UIColor(red: 247 / 255, green: 244 / 255, blue: 236 / 255, alpha: 1)  // #f7f4ec
    static let ink = UIColor(red: 32 / 255, green: 38 / 255, blue: 31 / 255, alpha: 1)       // #20261f
    static let muted = UIColor(red: 107 / 255, green: 114 / 255, blue: 104 / 255, alpha: 1)  // #6b7268
    static let line = UIColor(red: 227 / 255, green: 221 / 255, blue: 205 / 255, alpha: 1)   // #e3ddcd

    /// 제목용 세리프. iOS 13 이상은 시스템 세리프(New York), iOS 12는 Georgia.
    static func serif(_ size: CGFloat, bold: Bool = true) -> UIFont {
        let base = UIFont.systemFont(ofSize: size, weight: bold ? .semibold : .regular)
        if #available(iOS 13.0, *), let descriptor = base.fontDescriptor.withDesign(.serif) {
            return UIFont(descriptor: descriptor, size: size)
        }
        return UIFont(name: bold ? "Georgia-Bold" : "Georgia", size: size) ?? base
    }

    /// 화면을 만들기 전에 한 번 호출한다(appearance는 이후에 만들어지는 뷰에만 적용된다).
    static func apply() {
        let titleAttributes: [NSAttributedString.Key: Any] = [.foregroundColor: forest, .font: serif(18)]
        let navigation = UINavigationBar.appearance()
        navigation.tintColor = forest
        navigation.titleTextAttributes = titleAttributes
        if #available(iOS 13.0, *) {
            let bar = UINavigationBarAppearance()
            bar.configureWithOpaqueBackground()
            bar.backgroundColor = cream
            bar.shadowColor = line
            bar.titleTextAttributes = titleAttributes
            navigation.standardAppearance = bar
            navigation.compactAppearance = bar
            navigation.scrollEdgeAppearance = bar
        } else {
            navigation.barTintColor = cream
            navigation.isTranslucent = false
        }

        let tabs = UITabBar.appearance()
        tabs.tintColor = forest
        tabs.unselectedItemTintColor = muted
        if #available(iOS 13.0, *) {
            let bar = UITabBarAppearance()
            bar.configureWithOpaqueBackground()
            bar.backgroundColor = .white
            bar.shadowColor = line
            tabs.standardAppearance = bar
            if #available(iOS 15.0, *) { tabs.scrollEdgeAppearance = bar }
        } else {
            tabs.barTintColor = .white
            tabs.isTranslucent = false
        }

        UITableView.appearance().backgroundColor = cream
        UITableView.appearance().separatorColor = line
        UITableViewCell.appearance().backgroundColor = .white
        UITableViewCell.appearance().tintColor = gold
        UISegmentedControl.appearance().tintColor = forest
        if #available(iOS 13.0, *) {
            UISegmentedControl.appearance().selectedSegmentTintColor = forest
            UISegmentedControl.appearance().setTitleTextAttributes([.foregroundColor: UIColor.white], for: .selected)
            UISegmentedControl.appearance().setTitleTextAttributes([.foregroundColor: muted], for: .normal)
        }
        UISwitch.appearance().onTintColor = forest
        UIRefreshControl.appearance().tintColor = gold
    }

    /// 웹의 주 버튼: 진녹색 바탕, 흰 글씨, 둥근 모서리.
    static func primary(_ button: UIButton) {
        button.backgroundColor = forest
        button.setTitleColor(.white, for: .normal)
        button.setTitleColor(UIColor.white.withAlphaComponent(0.6), for: .disabled)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .semibold)
        button.layer.cornerRadius = 24
        button.contentEdgeInsets = UIEdgeInsets(top: 14, left: 22, bottom: 14, right: 22)
    }

    /// 보조 버튼: 테두리만 있는 버튼.
    static func secondary(_ button: UIButton) {
        button.backgroundColor = .clear
        button.setTitleColor(forest, for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .semibold)
        button.layer.cornerRadius = 24
        button.layer.borderWidth = 1
        button.layer.borderColor = line.cgColor
        button.contentEdgeInsets = UIEdgeInsets(top: 14, left: 22, bottom: 14, right: 22)
    }

    /// 홈 화면 상단의 진녹색 소개 카드(웹 첫 화면과 같은 문구·분위기).
    static func heroView(width: CGFloat) -> UIView {
        let container = UIView(frame: CGRect(x: 0, y: 0, width: width, height: 236))
        let card = UIView()
        card.backgroundColor = forest
        card.layer.cornerRadius = 22
        card.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(card)

        let eyebrow = UILabel()
        eyebrow.attributedText = NSAttributedString(string: "FOREST CLUB", attributes: [.kern: 3, .foregroundColor: gold, .font: UIFont.systemFont(ofSize: 12, weight: .bold)])
        let headline = UILabel()
        headline.text = "좋은 사람들과,\n더 넓은 세상으로."
        headline.numberOfLines = 0
        headline.font = serif(28)
        headline.textColor = .white
        let sub = UILabel()
        sub.text = "골프와 여행, 함께하는 취향"
        sub.font = UIFont.systemFont(ofSize: 14)
        sub.textColor = goldLight
        let stack = UIStackView(arrangedSubviews: [eyebrow, headline, sub])
        stack.axis = .vertical
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            card.topAnchor.constraint(equalTo: container.topAnchor, constant: 16),
            card.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -8),
            card.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 16),
            card.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -16),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -24),
            stack.centerYAnchor.constraint(equalTo: card.centerYAnchor)
        ])
        return container
    }
}
