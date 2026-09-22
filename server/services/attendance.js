// 모임 참석 확정/취소/무단불참 처리. 코인은 "차감"이 아니라 "보류"로 다룬다는 운영정책의
// 명시적 권고에 따라, 확정 시점에는 coin_ledger를 건드리지 않고 event_attendances.hold_coins로만
// 표시했다가, 실제로 확정(몰수)될 몫만 이 시점에 debitCoins로 실제 차감한다.
const db = require('../db');
const { debitCoins, getAvailableBalance } = require('./coins');
const { findEventByName } = require('../events-catalog');

const getAttendance = db.prepare('SELECT * FROM event_attendances WHERE id = ?');
const insertAttendance = db.prepare(`
  INSERT INTO event_attendances (user_id, event_name, event_date, hold_coins)
  VALUES (?, ?, ?, ?)
`);
const listMyAttendances = db.prepare(`
  SELECT * FROM event_attendances WHERE user_id = ? ORDER BY created_at DESC
`);
const updateResolved = db.prepare(`
  UPDATE event_attendances
  SET status = ?, released_pct = ?, penalty_krw = ?, penalty_note = ?, cancelled_at = ?, resolved_at = datetime('now')
  WHERE id = ?
`);

class AttendanceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function confirmAttendance(userId, eventName, eventDate) {
  const event = findEventByName(eventName);
  if (!event) throw new AttendanceError('존재하지 않는 모임이에요', 404);

  const parsed = new Date(`${eventDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime()) || parsed < new Date(new Date().toDateString())) {
    throw new AttendanceError('모임 개최일을 확인해주세요 (오늘 이후 날짜만 가능해요)');
  }

  if (getAvailableBalance(userId) < event.holdCoins) {
    throw new AttendanceError(`참석 확정에는 ${event.holdCoins.toLocaleString()}코인이 필요해요 (사용 가능 코인 부족)`, 402);
  }

  const info = insertAttendance.run(userId, event.name, eventDate, event.holdCoins);
  return getAttendance.get(info.lastInsertRowid);
}

// 개최일까지 남은 일수로 보류 해제 비율을 정한다(이용약관 제12조의2 5항).
function releasePctByDaysUntil(daysUntil) {
  if (daysUntil >= 7) return 100;
  if (daysUntil >= 3) return 50;
  return 0;
}

function daysUntil(eventDateStr) {
  const eventDate = new Date(`${eventDateStr}T00:00:00`);
  const today = new Date(new Date().toDateString());
  return Math.round((eventDate - today) / (1000 * 60 * 60 * 24));
}

/**
 * 보류를 해제하고(=confirmed 상태에서 빼서 available 계산에서 제외시키고), 해제되지 않는 몫만
 * 그제서야 실제로 차감한다. 이 순서가 중요하다 — 보류 중인 코인을 자기 자신의 담보로 차감할 수는 없다.
 */
function resolveAttendance(attendanceId, { status, releasedPct, penaltyKrw = null, penaltyNote = null }) {
  const attendance = getAttendance.get(attendanceId);
  if (!attendance) throw new AttendanceError('참석 확정 내역을 찾을 수 없어요', 404);
  if (attendance.status !== 'confirmed') throw new AttendanceError('이미 처리된 참석 확정이에요', 409);

  const forfeited = Math.round((attendance.hold_coins * (100 - releasedPct)) / 100);

  updateResolved.run(
    status, releasedPct, penaltyKrw, penaltyNote,
    status === 'cancelled' ? new Date().toISOString() : null,
    attendanceId
  );

  if (forfeited > 0) {
    const type = status === 'no_show' ? 'event_no_show_forfeit' : 'event_cancel_forfeit';
    const label = status === 'no_show' ? '무단불참' : '취소';
    debitCoins(attendance.user_id, forfeited, type, `모임 '${attendance.event_name}' ${label} 보류 몰수`);
  }

  return getAttendance.get(attendanceId);
}

function cancelAttendance(userId, attendanceId) {
  const attendance = getAttendance.get(attendanceId);
  if (!attendance) throw new AttendanceError('참석 확정 내역을 찾을 수 없어요', 404);
  if (attendance.user_id !== userId) throw new AttendanceError('권한이 없어요', 403);
  if (attendance.status !== 'confirmed') throw new AttendanceError('이미 처리된 참석 확정이에요', 409);

  const pct = releasePctByDaysUntil(daysUntil(attendance.event_date));
  return resolveAttendance(attendanceId, { status: 'cancelled', releasedPct: pct });
}

module.exports = {
  AttendanceError,
  confirmAttendance,
  cancelAttendance,
  resolveAttendance,
  listMyAttendances,
  getAttendance,
  releasePctByDaysUntil,
  daysUntil,
};
