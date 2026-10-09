import SwiftUI

private let clubGreen = Color(red: 0.12, green: 0.28, blue: 0.22)

struct ContentView: View {
    @StateObject private var store = ClubStore()
    var body: some View {
        TabView {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        Label("FOREST CLUB", systemImage: "leaf.fill").font(.headline).tracking(3).foregroundStyle(clubGreen)
                        VStack(alignment: .leading, spacing: 24) {
                            Text("좋은 사람들과,\n더 넓은 세상으로.").font(.system(size: 34, weight: .semibold, design: .serif))
                            Text("라운딩의 즐거움부터 여행의 설렘까지.\n당신의 다음 여정을 함께하세요.").font(.subheadline)
                            Image(systemName: "mountain.2.fill").font(.system(size: 90)).frame(maxWidth: .infinity).foregroundStyle(.white.opacity(0.6)).accessibilityHidden(true)
                        }.padding(26).frame(maxWidth: .infinity, alignment: .leading).foregroundStyle(.white)
                            .background(clubGreen.gradient, in: RoundedRectangle(cornerRadius: 24))
                        Text("함께하는 취향, 깊어지는 인연").font(.title2.bold())
                        HStack {
                            Label("골프 · 함께하는 라운딩", systemImage: "figure.golf")
                            Spacer()
                            Label("여행 · 새로운 발견", systemImage: "airplane")
                        }.font(.caption).foregroundStyle(clubGreen)
                        Text("추천 모임").font(.title2.bold())
                        if !store.isLive { Text("예시 모임 · 마이페이지에서 서버를 연결해주세요").font(.caption).foregroundStyle(.secondary) }
                        ForEach(store.events.prefix(3)) { event in
                            NavigationLink { EventDetail(event: event, store: store) } label: { EventCard(event: event) }.buttonStyle(.plain)
                        }
                    }.padding(20)
                }.background(Color(.systemGroupedBackground)).navigationTitle("포레스트클럽").navigationBarTitleDisplayMode(.inline)
                    .refreshable { await store.refresh() }
            }.tabItem { Label("홈", systemImage: "house") }
            EventList(store: store).tabItem { Label("모임", systemImage: "figure.golf") }
            AccountView(store: store).tabItem { Label("마이페이지", systemImage: "person.crop.circle") }
        }.tint(clubGreen).task { await store.refresh() }
    }
}

struct EventCard: View {
    let event: ClubEvent
    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: event.type == "golf" ? "figure.golf" : "airplane").font(.title)
                .frame(width: 54, height: 70).foregroundStyle(clubGreen)
                .background(clubGreen.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
            VStack(alignment: .leading, spacing: 8) {
                Text(event.type == "golf" ? "GOLF CLUB" : "TRAVEL CLUB").font(.caption2).tracking(2).foregroundStyle(.secondary)
                Text(event.name).font(.headline)
                Text(event.remaining.map { "정원 \(event.capacity)명 · 남은 자리 \($0)명" } ?? "정원 \(event.capacity)명 · 예시 모임").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
        }.padding(16).background(.background, in: RoundedRectangle(cornerRadius: 18))
    }
}

struct EventList: View {
    @ObservedObject var store: ClubStore
    @State private var category = "all"
    @State private var search = ""
    private var filtered: [ClubEvent] {
        store.events.filter { (category == "all" || $0.type == category) && (search.isEmpty || $0.name.localizedCaseInsensitiveContains(search)) }
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    Picker("모임 종류", selection: $category) {
                        Text("전체").tag("all")
                        Text("골프").tag("golf")
                        Text("여행").tag("travel")
                    }.pickerStyle(.segmented)
                    if !store.isLive { Text(store.connectionMessage ?? "예시 모임입니다. 서버 연결 후 실제 모집 현황을 확인할 수 있습니다.").font(.caption).foregroundStyle(.secondary) }
                    if filtered.isEmpty { ContentUnavailableView.search(text: search) }
                    ForEach(filtered) { event in
                        NavigationLink { EventDetail(event: event, store: store) } label: { EventCard(event: event) }.buttonStyle(.plain)
                    }
                }.padding(20)
            }.background(Color(.systemGroupedBackground)).navigationTitle("함께할 모임")
                .searchable(text: $search, prompt: "어떤 여정을 찾으세요?").refreshable { await store.refresh() }
        }
    }
}

struct EventDetail: View {
    let event: ClubEvent
    @ObservedObject var store: ClubStore
    @State private var busy = false
    @State private var submitted = false
    @State private var message: String?
    private var current: ClubEvent { store.events.first { $0.id == event.id } ?? event }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Image(systemName: event.type == "golf" ? "figure.golf" : "globe.asia.australia.fill")
                    .font(.system(size: 90)).foregroundStyle(.white).frame(maxWidth: .infinity).frame(height: 220)
                    .background(clubGreen.gradient, in: RoundedRectangle(cornerRadius: 24)).accessibilityHidden(true)
                Text(event.name).font(.largeTitle.bold())
                Label("정원 \(event.capacity)명", systemImage: "person.2")
                if store.isLive, let remaining = current.remaining { Label("남은 자리 \(remaining)명", systemImage: "ticket") }
                Text("참가 문의를 남겨주시면 운영진이 일정과 참가 절차를 안내해드립니다.").foregroundStyle(.secondary)
                if !store.isLive { Text("문의 접수는 마이페이지에서 서버 연결 후 가능합니다.").font(.callout) }
                Button {
                    busy = true
                    Task {
                        defer { busy = false }
                        do {
                            try await store.submitInterest(event)
                            submitted = true
                            message = "참가 문의가 접수되었습니다."
                        } catch { message = error.localizedDescription }
                    }
                } label: {
                    HStack {
                        if busy { ProgressView().tint(.white) }
                        Text(submitted ? "문의 접수 완료" : "참가 문의하기").bold()
                    }.frame(maxWidth: .infinity).padding(10)
                }.buttonStyle(.borderedProminent).disabled(busy || submitted || !store.isLive || current.remaining == 0)
            }.padding(20)
        }.navigationTitle("모임 안내").navigationBarTitleDisplayMode(.inline)
            .alert("참가 문의", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("확인") { message = nil }
            } message: { Text(message ?? "") }
    }
}

struct AccountView: View {
    @ObservedObject var store: ClubStore
    @State private var signup = false
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var address = ""
    @State private var busy = false
    @State private var message: String?
    var body: some View {
        NavigationStack {
            Form {
                if let user = store.user {
                    Section("내 계정") {
                        Label("\(user.name)님, 반갑습니다", systemImage: "person.crop.circle.fill")
                        Text(user.email).foregroundStyle(.secondary)
                        Button("로그아웃", role: .destructive) { perform { try await store.logout() } }.disabled(busy)
                    }
                } else {
                    Section("포레스트클럽과 함께하세요") {
                        Picker("계정", selection: $signup) {
                            Text("로그인").tag(false)
                            Text("회원가입").tag(true)
                        }.pickerStyle(.segmented)
                        if signup { TextField("이름", text: $name).textContentType(.name) }
                        TextField("이메일", text: $email).keyboardType(.emailAddress).textContentType(.username)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                        SecureField("비밀번호 (8자 이상)", text: $password).textContentType(signup ? .newPassword : .password)
                        Button(signup ? "회원가입" : "로그인") {
                            perform {
                                try await store.authenticate(signup: signup, name: name, email: email, password: password)
                                password = ""
                            }
                        }.disabled(busy || !store.isLive || email.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty || (signup && (name.trimmingCharacters(in: .whitespaces).isEmpty || password.count < 8)))
                    }
                }
                Section {
                    TextField("https://서버주소", text: $address).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("서버 연결") { perform { try await store.connect(to: address) } }.disabled(busy)
                    if busy { ProgressView("처리 중…") }
                    Label(store.isLive ? "서버 연결됨" : "예시 모드", systemImage: store.isLive ? "checkmark.circle.fill" : "network.slash")
                    if let error = store.connectionMessage { Text(error).font(.caption).foregroundStyle(.secondary) }
                } header: { Text("서비스 연결") } footer: {
                    Text("시뮬레이터: http://localhost:3000 · 실제 기기: HTTPS 서버 주소. 로그인은 앱 종료 시 해제됩니다.")
                }
                if store.isLive, let url = URL(string: store.serverAddress) {
                    Section("회원 서비스") {
                        Link(destination: url) { Label("멤버십 · 동행 · 쪽지 서비스 열기", systemImage: "safari") }
                        Text("웹 서비스에서 별도 로그인이 필요할 수 있습니다.").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }.navigationTitle("마이페이지").onAppear { address = store.serverAddress }
                .alert("안내", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                    Button("확인") { message = nil }
                } message: { Text(message ?? "") }
        }
    }
    private func perform(_ action: @escaping @MainActor () async throws -> Void) {
        busy = true
        Task {
            defer { busy = false }
            do { try await action() } catch { message = error.localizedDescription }
        }
    }
}

#Preview { ContentView() }
