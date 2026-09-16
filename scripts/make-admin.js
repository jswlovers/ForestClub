// 이미 가입한 회원 계정을 관리자로 승격시키는 운영 스크립트.
// 사용법: node scripts/make-admin.js someone@example.com
const db = require('../server/db');

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.error('사용법: node scripts/make-admin.js someone@example.com');
  process.exit(1);
}

const user = db.prepare('SELECT id, name, role FROM users WHERE email = ?').get(email);
if (!user) {
  console.error(`'${email}' 계정을 찾을 수 없어요. 먼저 사이트에서 회원가입을 해야 합니다.`);
  process.exit(1);
}
if (user.role === 'admin') {
  console.log(`'${email}'(${user.name})님은 이미 관리자예요.`);
  process.exit(0);
}

db.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).run(user.id);
console.log(`'${email}'(${user.name})님을 관리자로 전환했어요.`);
