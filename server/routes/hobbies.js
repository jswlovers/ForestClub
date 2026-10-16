const express = require('express');
const { listActive } = require('../services/hobbies');

const router = express.Router();

// 공개 취미 목록(로그인 불필요): 랜딩 페이지 취미 라운지와 가입 화면이 쓴다.
// 회원 수는 승인된 회원 기준 합계만 보여주고 누가 골랐는지는 노출하지 않는다.
router.get('/', (req, res) => {
  res.json(listActive());
});

module.exports = router;
