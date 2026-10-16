const db = require('../db');

// 회원 한 명이 고를 수 있는 취미 수. 너무 많으면 "같은 취미"가 의미를 잃는다.
const MAX_HOBBIES = 10;

const listActiveStmt = db.prepare(`
  SELECT h.id, h.slug, h.name, h.category, h.icon, h.prompt, h.sort_order,
    (SELECT COUNT(*) FROM user_hobbies uh JOIN users u ON u.id = uh.user_id
      WHERE uh.hobby_id = h.id AND u.role != 'admin' AND u.status = 'approved' AND u.withdrawn_at IS NULL) AS members
  FROM hobbies h WHERE h.active = 1
  ORDER BY h.sort_order, h.id
`);
const listAllStmt = db.prepare(`
  SELECT h.*,
    (SELECT COUNT(*) FROM user_hobbies uh JOIN users u ON u.id = uh.user_id
      WHERE uh.hobby_id = h.id AND u.role != 'admin' AND u.withdrawn_at IS NULL) AS members
  FROM hobbies h ORDER BY h.active DESC, h.sort_order, h.id
`);
const userHobbiesStmt = db.prepare(`
  SELECT h.id, h.slug, h.name, h.category, h.icon, h.prompt
  FROM user_hobbies uh JOIN hobbies h ON h.id = uh.hobby_id
  WHERE uh.user_id = ? AND h.active = 1
  ORDER BY h.sort_order, h.id
`);
const allUserHobbiesStmt = db.prepare(`
  SELECT uh.user_id, h.id, h.name, h.icon
  FROM user_hobbies uh JOIN hobbies h ON h.id = uh.hobby_id
  WHERE h.active = 1
  ORDER BY h.sort_order, h.id
`);
const activeIdsStmt = db.prepare('SELECT id FROM hobbies WHERE active = 1');
const clearUserStmt = db.prepare('DELETE FROM user_hobbies WHERE user_id = ?');
const addUserStmt = db.prepare('INSERT OR IGNORE INTO user_hobbies (user_id, hobby_id) VALUES (?, ?)');

/** 공개 목록(활동 중인 취미 + 승인 회원 수). 랜딩 페이지 "취미 라운지"와 가입 화면에서 쓴다. */
function listActive() {
  return listActiveStmt.all();
}

/** 관리자용: 숨긴 취미까지 모두. */
function listAll() {
  return listAllStmt.all();
}

function forUser(userId) {
  return userHobbiesStmt.all(userId);
}

/** userId → [{id, name, icon}] 맵. 회원 목록에 취미를 붙일 때 한 번에 읽는다. */
function mapByUser() {
  const map = new Map();
  for (const row of allUserHobbiesStmt.all()) {
    if (!map.has(row.user_id)) map.set(row.user_id, []);
    map.get(row.user_id).push({ id: row.id, name: row.name, icon: row.icon });
  }
  return map;
}

/**
 * 요청 값(hobbyIds)을 검증해 정수 id 배열로 돌려준다. 활동 중인 취미만 허용.
 * @returns {{ids?: number[], error?: string}}
 */
function parseHobbyIds(raw, { required = false } = {}) {
  if (raw === undefined || raw === null) return required ? { error: '좋아하는 취미를 하나 이상 골라주세요' } : { ids: null };
  if (!Array.isArray(raw)) return { error: '취미 선택 값을 확인해주세요' };
  const active = new Set(activeIdsStmt.all().map((r) => r.id));
  const ids = [...new Set(raw.map(Number))].filter((id) => active.has(id));
  if (required && !ids.length) return { error: '좋아하는 취미를 하나 이상 골라주세요' };
  if (ids.length > MAX_HOBBIES) return { error: `취미는 최대 ${MAX_HOBBIES}개까지 고를 수 있어요` };
  return { ids };
}

/** 회원의 취미를 통째로 바꾼다(트랜잭션 안에서 불러도 된다). */
function setForUser(userId, ids) {
  clearUserStmt.run(userId);
  for (const id of ids) addUserStmt.run(userId, id);
}

/**
 * 회원 목록에 취미를 붙이고 "취미가 같은 이성" 순으로 정리한다.
 * - 보는 사람의 성별이 있으면 이성만 남긴다(동성 회원은 목록에 나오지 않음).
 * - hobbyId가 있으면 그 취미를 고른 회원만 남긴다.
 * - 같은 취미가 많은 회원이 먼저 오고, 같으면 원래 순서(최근 가입순)를 지킨다.
 */
function decorateMembers(viewer, rows, { hobbyId } = {}) {
  const byUser = mapByUser();
  const mine = new Set((byUser.get(viewer.id) || []).map((h) => h.id));
  const wanted = Number(hobbyId) || null;
  return rows
    .filter((m) => !viewer.gender || !m.gender || m.gender !== viewer.gender)
    .map((m, index) => {
      const list = byUser.get(m.id) || [];
      const shared = list.filter((h) => mine.has(h.id));
      return { ...m, hobbies: list, sharedHobbies: shared, sharedCount: shared.length, index };
    })
    .filter((m) => !wanted || m.hobbies.some((h) => h.id === wanted))
    .sort((a, b) => b.sharedCount - a.sharedCount || a.index - b.index)
    .map(({ index, ...m }) => m);
}

const slugsStmt = db.prepare('SELECT id, slug FROM hobbies');
/** 고른 취미에서 예전 "관심 분야" 값(골프/여행/둘 다)을 만든다. 둘 다 없으면 null. */
function interestFromHobbies(ids) {
  if (!ids || !ids.length) return null;
  const slugs = new Set(slugsStmt.all().filter((h) => ids.includes(h.id)).map((h) => h.slug));
  if (slugs.has('golf') && slugs.has('travel')) return '둘 다';
  if (slugs.has('golf')) return '골프';
  if (slugs.has('travel')) return '여행';
  return null;
}

module.exports = { interestFromHobbies, MAX_HOBBIES, listActive, listAll, forUser, mapByUser, parseHobbyIds, setForUser, decorateMembers };
