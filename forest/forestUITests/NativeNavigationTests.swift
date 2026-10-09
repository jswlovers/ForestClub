import XCTest

final class NativeNavigationTests: XCTestCase {
    func testLoginMessageCoinsAndProfileStayInsideApp() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-forest.server", "http://localhost:18743"]
        app.launch()
        app.tabBars.buttons["마이페이지"].tap()
        if app.tables.cells.containing(.staticText, identifier: "로그아웃").firstMatch.waitForExistence(timeout: 2) {
            app.tables.cells.containing(.staticText, identifier: "로그아웃").firstMatch.tap()
        }
        let login = app.tables.cells.containing(.staticText, identifier: "로그인").firstMatch
        XCTAssertTrue(login.waitForExistence(timeout: 10)); login.tap()
        app.textFields["이메일"].tap(); app.textFields["이메일"].typeText("test@example.com")
        app.secureTextFields["비밀번호"].tap(); app.secureTextFields["비밀번호"].typeText("test-password")
        app.navigationBars.buttons["로그인"].tap()
        let inbox = app.tables.cells.containing(.staticText, identifier: "쪽지함").firstMatch
        XCTAssertTrue(inbox.waitForExistence(timeout: 10)); inbox.tap()
        let partner = app.tables.cells.containing(.staticText, identifier: "대화 상대 · 새 쪽지 1").firstMatch
        XCTAssertTrue(partner.waitForExistence(timeout: 10)); partner.tap()
        let input = app.textViews["쪽지 내용"]
        XCTAssertTrue(input.waitForExistence(timeout: 10)); input.tap(); input.typeText("앱에서 보낸 쪽지")
        app.buttons["보내기"].tap()
        XCTAssertTrue(app.staticTexts["나: 앱에서 보낸 쪽지"].waitForExistence(timeout: 10))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.tables.cells.containing(.staticText, identifier: "코인 충전").firstMatch.tap()
        XCTAssertTrue(app.staticTexts["4500 코인"].waitForExistence(timeout: 10))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.tables.cells.containing(.staticText, identifier: "내 프로필").firstMatch.tap()
        let region = app.textFields["지역"]
        XCTAssertTrue(region.waitForExistence(timeout: 10))
        XCTAssertEqual(region.value as? String, "서울")
        XCTAssertTrue(app.navigationBars.buttons["저장"].exists)
        XCTAssertEqual(app.state, .runningForeground)
        app.terminate()
        app.launch()
        app.tabBars.buttons["마이페이지"].tap()
        XCTAssertTrue(app.tables.cells.containing(.staticText, identifier: "쪽지함").firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.tables.cells.containing(.staticText, identifier: "로그인").firstMatch.exists)
    }
}
