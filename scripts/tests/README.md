# iOS 네이티브 앱 테스트

Xcode가 설치된 Mac에서 실행합니다. 로컬 API fixture는 실제 서비스 데이터와 알림을 사용하지 않습니다.

한 터미널에서:

```sh
python3 scripts/tests/ios-native-api.py
```

다른 터미널에서 사용 가능한 시뮬레이터 이름을 지정합니다:

```sh
xcodebuild -project forest/forest.xcodeproj -scheme forest \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -only-testing:forestTests \
  -only-testing:forestUITests/NativeNavigationTests \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- test
```

fixture는 127.0.0.1:18743에서 테스트 계정과 대화·코인 데이터를 제공합니다. 테스트 시작 전 서버를 다시 실행해 데이터를 초기화합니다. 완료 후 Ctrl+C로 종료합니다. 프로덕션에 배포하지 않습니다.

공유 로그인 테스트는 URLProtocol을 사용하므로 UI 테스트를 제외하면 fixture 없이 실행할 수 있습니다. 테스트용 인증 정보는 운영 계정과 관계없는 고정값입니다.

앱 재실행 후 키체인 세션 복원을 확인하므로 시뮬레이터용 임시 서명을 활성화합니다. 실제 기기용 IPA의 배포 서명과는 별개입니다.
