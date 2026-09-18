const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const express = require('express');
const cookieParser = require('cookie-parser');

const db = require('./db');
const { hashPassword } = require('./auth');

const authRoutes = require('./routes/auth');
const applicationRoutes = require('./routes/applications');
const eventRoutes = require('./routes/events');
const companionRoutes = require('./routes/companions');
const coinRoutes = require('./routes/coins');
const messageRoutes = require('./routes/messages');
const callRoutes = require('./routes/calls');
const ticketRoutes = require('./routes/tickets');
const identityRoutes = require('./routes/identity');
const adminRoutes = require('./routes/admin');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@forestclub.kr';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234!';

function ensureAdminSeed() {
  const existing = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get();
  if (existing) return;
  db.prepare(`INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, NULL, ?, 'admin')`).run(
    '관리자',
    ADMIN_EMAIL,
    hashPassword(ADMIN_PASSWORD)
  );
  console.log(`[seed] 관리자 계정 생성: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD} (운영 배포 전 ADMIN_EMAIL, ADMIN_PASSWORD 환경변수로 변경하세요)`);
}
ensureAdminSeed();

const app = express();

// 리버스 프록시(Nginx 등) 뒤에서 실행할 때만 켜세요. 켜지 않은 상태로 프록시를 두면
// 요청 제한(rate limit)이 프록시의 IP만 보게 되고, 반대로 프록시 없이 켜면
// 누구나 X-Forwarded-For 헤더를 조작해 요청 제한을 우회할 수 있습니다.
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/companions', companionRoutes);
app.use('/api/coins', coinRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/identity', identityRoutes);
app.use('/api/admin', adminRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했어요' });
});

const PORT = process.env.PORT || 3000;

// HTTPS_CERT_PATH/HTTPS_KEY_PATH가 설정돼 있으면 HTTPS로 직접 서비스한다.
// 모바일 브라우저는 보안 컨텍스트(HTTPS)가 아니면 카메라/마이크(WebRTC) 접근 자체를
// 막기 때문에, 같은 네트워크의 폰에서 보이스톡/페이스톡을 테스트하려면 필요하다.
// mkcert로 로컬에서 신뢰되는 인증서를 만들 수 있다: mkcert <PC의 LAN IP> localhost 127.0.0.1
if (process.env.HTTPS_CERT_PATH && process.env.HTTPS_KEY_PATH) {
  const options = {
    cert: fs.readFileSync(process.env.HTTPS_CERT_PATH),
    key: fs.readFileSync(process.env.HTTPS_KEY_PATH),
  };
  https.createServer(options, app).listen(PORT, () => {
    console.log(`포레스트클럽 서버 실행 중 (HTTPS): https://localhost:${PORT}`);
  });
} else {
  app.listen(PORT, () => {
    console.log(`포레스트클럽 서버 실행 중: http://localhost:${PORT}`);
  });
}
