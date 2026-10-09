# 운영 서버 자동 연결 앱

모든 앱은 `https://forest.sean2022.one:8888`에 자동 연결합니다. 일반 화면의 서버 주소 설정 메뉴를 제거했습니다. HTTPS 인증서 검증은 유지합니다.

최신 설치 파일:

- `ForestClub-iPhone16Pro-build6.ipa`: iPhone 16 Pro 등 iOS 18.5 이상, arm64, 빌드 6, 서명 없음
- `ForestClub-iOS12-build6.ipa`: iPhone 5s 등 iOS 12.0 이상, arm64, 빌드 6, 서명 없음
- `ForestClub-Android-debug-build2.apk`: Android 6.0(API 23) 이상, 버전 코드 2, 개발 테스트용 인증서로 서명

iOS IPA는 Sideloadly 등 설치 도구에서 서명해야 합니다. Android APK는 직접 설치용이며 Play Store 배포용이 아닙니다. 이전 산출물은 보존합니다.

네이티브 앱 내부 회원 서비스와 공유 로그인, 안전한 세션 보관을 지원합니다. 운영 서버의 닉네임, 사용 가능 코인 잔액, 가입 심사 상태를 표시하며 가입 절차는 약관 동의 → 가입 가능 여부 확인 → 회원 정보 입력 순서입니다.

검증:

- 운영 서버의 공개 모임 API와 HTTPS 연결 확인
- 두 iOS 기기용 Release 빌드와 IPA 압축 검사, arm64/최소 OS/빌드 번호 확인
- iPhone 16 Pro / iOS 18.6 시뮬레이터에서 로그인 관련 단위 테스트 4개 및 로그인·쪽지·코인·프로필·재실행 복원 UI 테스트 1개 통과
- Android 단위 테스트 6개 통과
- Android 15 에뮬레이터에서 Keystore 암호화 세션 복원, 공유 로그인, 쪽지 전송·코인 잔액 갱신·프로필 API 기기 테스트 1개 통과
- Android APK 빌드 2 및 Lint 오류 0개, APK 서명과 API 23 최소 버전 검사
- Android 에뮬레이터에서 운영 서버의 공개 모임과 실제 남은 자리 자동 표시 확인

운영 서버에 테스트 계정·쪽지·충전 데이터를 만들지 않았습니다. 실제 Android/iPhone 기기의 전체 흐름, 운영 서버의 회원가입·심사·과금 결과는 별도 검증이 필요합니다.
