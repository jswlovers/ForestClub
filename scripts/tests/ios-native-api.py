"""Local API fixture for native iOS UI integration tests; never used by the app in production."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json

messages = []
charges = []
coins = 5000
profile = {"id": 1, "name": "테스트 회원", "email": "test@example.com", "phone": "010-1234-5678", "region": "서울"}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def respond(self, data, status=200, cookie=None):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

    def authenticated(self):
        if "fc_session=native-ui-test" in self.headers.get("Cookie", ""):
            return True
        self.respond({"error": "로그인이 필요합니다"}, 401)
        return False

    def do_GET(self):
        if self.path == "/api/events":
            self.respond([{"id": "golf-jeju", "type": "golf", "name": "제주 프리미엄 투어 라운딩", "capacity": 8, "remaining": 6}])
            return
        if not self.authenticated():
            return
        responses = {
            "/api/auth/me": profile,
            "/api/messages/conversations": [{"userId": 2, "name": "대화 상대", "lastPreview": "안녕하세요", "lastAt": "2026-10-08", "unread": 1}],
            "/api/messages/conversations/2": {"partner": {"id": 2, "name": "대화 상대"}, "messages": messages},
            "/api/messages/members": [{"id": 2, "name": "대화 상대", "region": "서울"}],
            "/api/coins/balance": {"coins": coins},
            "/api/coins/charge-requests/me": charges,
            "/api/coins/ledger": [],
            "/api/applications/me": [],
            "/api/companions/incoming": [],
            "/api/companions/outgoing": [],
            "/api/tickets/me": [],
        }
        self.respond(responses.get(self.path, {"error": "잘못된 API"}), 200 if self.path in responses else 404)

    def do_POST(self):
        global coins
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if self.path == "/api/auth/login":
            if body.get("email") != "test@example.com" or body.get("password") != "test-password":
                self.respond({"error": "이메일 또는 비밀번호가 올바르지 않아요"}, 401)
                return
            self.respond(profile, cookie="fc_session=native-ui-test; Path=/; HttpOnly; Max-Age=3600")
            return
        if not self.authenticated():
            return
        if self.path == "/api/messages":
            if body.get("recipientUserId") != 2 or not body.get("body"):
                self.respond({"error": "메시지를 확인해주세요"}, 400)
                return
            coins -= 500
            messages.append({"id": len(messages) + 1, "sender_id": 1, "recipient_id": 2, "body": body["body"], "created_at": "2026-10-08"})
            self.respond({"id": len(messages), "coins": coins}, 201)
        elif self.path == "/api/coins/charge-requests":
            charges.append({"id": len(charges) + 1, "amount_krw": body["amountKrw"], "status": "pending", "created_at": "2026-10-08"})
            self.respond({"id": len(charges)}, 201)
        elif self.path == "/api/auth/logout":
            self.respond({}, cookie="fc_session=; Path=/; Max-Age=0")
        else:
            self.respond({"error": "잘못된 API"}, 404)

    def do_PATCH(self):
        if not self.authenticated():
            return
        if self.path == "/api/auth/profile":
            profile.update(json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}"))
            self.respond(profile)
        else:
            self.respond({"error": "잘못된 API"}, 404)

if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 18743), Handler).serve_forever()
