// 랜딩 페이지 카드와 1:1로 대응하는 정식 모임 목록.
// 동행 신청(companion request)이 유효한 모임을 가리키는지 검증하는 데도 쓰인다.
const EVENTS = [
  { id: 'golf-jeju', type: 'golf', name: '제주 프리미엄 투어 라운딩', capacity: 8 },
  { id: 'golf-south', type: 'golf', name: '남부권 정기 라운딩', capacity: 12 },
  { id: 'golf-welcome', type: 'golf', name: '웰컴 라운딩', capacity: 6 },
  { id: 'travel-scotland', type: 'travel', name: '스코틀랜드 골프 오리진 투어', capacity: 10 },
  { id: 'travel-bali', type: 'travel', name: '발리 웰니스 & 골프 리트릿', capacity: 12 },
  { id: 'travel-napa', type: 'travel', name: '나파밸리 와인 & 골프 투어', capacity: 10 },
];

function findEventByName(name) {
  return EVENTS.find((e) => e.name === name) || null;
}

module.exports = { EVENTS, findEventByName };
