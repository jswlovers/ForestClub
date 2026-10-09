# 포레스트클럽 최신 iOS 앱

iOS 17.0 이상용 앱입니다. SwiftUI 앱 진입점에서 UIKit 화면을 표시하며, iPhone 5s용 앱과 `shared/Native/`의 화면 및 API 클라이언트를 함께 사용합니다.

빌드 6부터 프로필, 멤버십 지원, 동행 신청, 쪽지 대화와 첨부파일, 코인 잔액·충전 신청, 고객센터를 모두 앱 내부에서 이용합니다. 외부 웹사이트 로그인은 필요하지 않습니다. 로그인 세션은 키체인에 보관하고, 로그아웃이나 서버 만료 시 해제합니다. 비밀번호는 저장하지 않습니다.

## 실행

1. 저장소 전체를 내려받고 Xcode에서 `forest.xcodeproj`를 엽니다. `../shared/Native` 폴더도 필요합니다.
2. `forest` 스킴과 iPhone 시뮬레이터를 선택해 실행합니다.
3. 앱은 `https://forest.sean2022.one:8888`에 자동 연결합니다. 별도의 서버 주소 입력은 필요하지 않습니다.

Debug UI 테스트에서는 앱 실행 인수 `-forest.server http://localhost:18743`으로 로컬 fixture를 사용할 수 있습니다. Release 앱은 운영 서버에 연결합니다.

최신 IPA는 `artifacts/ForestClub-iPhone15ProMax-iOS17-build8.ipa`입니다. iOS 17.0 이상(예: iPhone 15 Pro Max iOS 17.1.1)의 실제 기기용 arm64 빌드 8이며 설치 도구에서 서명해야 합니다. iPhone 5s에는 `artifacts/ForestClub-iOS12-build7.ipa`를 사용합니다. 이전 IPA는 보존합니다.

직접 Xcode로 기기에 설치하려면 Signing & Capabilities에서 개발 팀과 고유한 Bundle Identifier를 설정합니다. App Store 배포용 아이콘과 서명은 별도 준비가 필요합니다.

쪽지 발송은 500코인, 첨부는 최대 15MB이며 충전 신청은 관리자 확인과 승인이 필요합니다. 프로필 사진 업로드는 현재 앱에 포함되지 않습니다.

보이스톡: 대화창의 '보이스톡' 버튼으로 걸고, 앱이 열려 있으면 받기/거절 창이 뜹니다. 대화의 통화 메시지를 눌러도 참여할 수 있습니다. 통화 중 초당 10코인이 사용되며 잔액 기준은 웹과 같습니다. 페이스톡(영상)은 웹사이트에서 이용합니다. 앱이 꺼져 있을 때의 착신 알림(푸시)은 아직 지원하지 않습니다.

## 검증

`forestTests/NativeSessionTests.swift`는 한 번의 로그인 쿠키를 여러 회원 API에서 공유하고 로그아웃·만료 시 해제하는지 확인합니다. `forestUITests/NativeNavigationTests.swift`는 로컬 API로 앱 내부 로그인 → 쪽지 전송 → 코인 조회 → 프로필 화면을 확인합니다. `scripts/tests/README.md`에 실행 방법이 있습니다.

실제 운영 서버 전체 흐름과 iPhone 5s의 설치·실행은 아직 검증하지 못했습니다.
