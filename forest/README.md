# 포레스트클럽 최신 iOS 앱

iOS 18.5 이상용 앱입니다. SwiftUI 앱 진입점에서 UIKit 화면을 표시하며, iPhone 5s용 앱과 `shared/Native/`의 화면 및 API 클라이언트를 함께 사용합니다.

빌드 5부터 프로필, 멤버십 지원, 동행 신청, 쪽지 대화와 첨부파일, 코인 잔액·충전 신청, 고객센터를 모두 앱 내부에서 이용합니다. 외부 웹사이트 로그인은 필요하지 않습니다. 로그인 세션은 키체인에 보관하고, 로그아웃이나 서버 만료 시 해제합니다. 비밀번호는 저장하지 않습니다.

## 실행

1. 저장소 전체를 내려받고 Xcode에서 `forest.xcodeproj`를 엽니다. `../shared/Native` 폴더도 필요합니다.
2. `forest` 스킴과 iPhone 시뮬레이터를 선택해 실행합니다.
3. 저장소 루트에서 Node 22.6 이상으로 `npm install`, `npm start`를 실행합니다.
4. 마이페이지 → 서버 주소 설정에 `http://localhost:3000`을 입력합니다.

실제 기기에서는 접근 가능한 HTTPS 서버 주소를 입력합니다. 서버 연결 전에는 예시 모임만 탐색할 수 있습니다.

최신 IPA는 `artifacts/ForestClub-iOS18-build5.ipa`입니다. 실제 기기용 arm64 빌드 5이며 설치 도구에서 서명해야 합니다. iPhone 5s에는 `artifacts/ForestClub-iOS12-build5.ipa`를 사용합니다. 이전 IPA는 보존합니다.

직접 Xcode로 기기에 설치하려면 Signing & Capabilities에서 개발 팀과 고유한 Bundle Identifier를 설정합니다. App Store 배포용 아이콘과 서명은 별도 준비가 필요합니다.

쪽지 발송은 500코인, 첨부는 최대 15MB이며 충전 신청은 관리자 확인과 승인이 필요합니다. 실시간 음성·영상 통화 UI와 프로필 사진 업로드는 현재 앱에 포함되지 않습니다.

## 검증

`forestTests/NativeSessionTests.swift`는 한 번의 로그인 쿠키를 여러 회원 API에서 공유하고 로그아웃·만료 시 해제하는지 확인합니다. `forestUITests/NativeNavigationTests.swift`는 로컬 API로 앱 내부 로그인 → 쪽지 전송 → 코인 조회 → 프로필 화면을 확인합니다. `scripts/tests/README.md`에 실행 방법이 있습니다.

실제 운영 서버 전체 흐름과 iPhone 5s의 설치·실행은 아직 검증하지 못했습니다.
