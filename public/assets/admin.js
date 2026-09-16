function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmt(dt){return dt?new Date(dt.replace(' ','T')+'Z').toLocaleString('ko-KR'):''}

async function api(path,options={}){
  const res=await fetch(path,{
    method:options.method||'GET',
    headers:options.body?{'Content-Type':'application/json'}:undefined,
    body:options.body?JSON.stringify(options.body):undefined,
    credentials:'include',
  });
  let data=null;
  const text=await res.text();
  if(text){try{data=JSON.parse(text)}catch{data=null}}
  if(!res.ok) throw new Error((data&&data.error)||'요청 중 오류가 발생했어요');
  return data;
}

let timer;
function showToast(msg){
  const t=document.querySelector('#toast');
  t.textContent=msg;
  t.classList.add('show');
  clearTimeout(timer);
  timer=setTimeout(()=>t.classList.remove('show'),2600);
}

const loginPane=document.querySelector('#adminLoginPane'),appPane=document.querySelector('#adminAppPane');
const loginForm=document.querySelector('#adminLoginForm'),loginError=document.querySelector('#adminLoginError');
const logoutBtn=document.querySelector('#adminLogoutBtn');

async function init(){
  try{
    const user=await api('/api/auth/me');
    if(user.role==='admin'){
      loginPane.classList.add('hidden');appPane.classList.remove('hidden');logoutBtn.classList.remove('hidden');
      loadAll();
      return;
    }
  }catch{}
  loginPane.classList.remove('hidden');appPane.classList.add('hidden');logoutBtn.classList.add('hidden');
}

loginForm.onsubmit=async e=>{
  e.preventDefault();
  loginError.textContent='';
  const email=document.querySelector('#adminLoginEmail').value.trim();
  const password=document.querySelector('#adminLoginPassword').value;
  try{
    const user=await api('/api/auth/login',{method:'POST',body:{email,password}});
    if(user.role!=='admin'){
      await api('/api/auth/logout',{method:'POST'});
      loginError.textContent='관리자 계정이 아니에요';
      return;
    }
    init();
  }catch(err){loginError.textContent=err.message}
};

logoutBtn.onclick=async()=>{
  try{await api('/api/auth/logout',{method:'POST'})}catch{}
  init();
};

document.querySelectorAll('.admin-tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.admin-tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');
  document.querySelectorAll('.admin-panel').forEach(p=>p.classList.add('hidden'));
  document.querySelector(`#panel-${t.dataset.tab}`).classList.remove('hidden');
});

async function loadAll(){
  await Promise.all([loadUsers(),loadApplications(),loadCompanions(),loadInterests(),loadCoinCharges(),loadCoinLedger(),loadNotifications()]);
}

async function loadUsers(){
  const users=await api('/api/admin/users');
  document.querySelector('#usersCount').textContent=`총 ${users.length}명`;
  document.querySelector('#usersBody').innerHTML=users.map(u=>`
    <tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.phone||'-')}</td><td>${u.role==='admin'?'관리자':'회원'}</td><td>${u.coins.toLocaleString()}</td><td>${fmt(u.created_at)}</td></tr>
  `).join('')||'<tr><td colspan="6">회원이 없어요</td></tr>';
}

const STATUS_LABEL={pending:'대기중',approved:'승인됨',rejected:'거절됨',accepted:'수락됨',declined:'거절됨',cancelled:'취소됨',sent:'발송됨',mock:'모의발송',failed:'발송실패'};

async function loadApplications(){
  const apps=await api('/api/admin/applications');
  document.querySelector('#applicationsCount').textContent=`총 ${apps.length}건`;
  document.querySelector('#applicationsBody').innerHTML=apps.map(a=>`
    <tr data-id="${a.id}">
      <td>${esc(a.name)}</td><td>${esc(a.phone)}</td><td>${esc(a.email)}</td>
      <td>${esc(a.age_group||'-')}</td><td>${esc(a.region||'-')}</td><td>${esc(a.job||'-')}</td>
      <td>${esc(a.golf_experience||'-')}</td><td>${esc(a.interest||'-')}</td><td>${esc(a.referrer||'-')}</td>
      <td>${esc(a.intro||'-')}</td>
      <td><span class="status-pill ${a.status}">${STATUS_LABEL[a.status]}</span></td>
      <td>${esc(a.admin_note||'-')}</td>
      <td>${fmt(a.created_at)}</td>
      <td>${a.status==='pending'?`<div class="row-actions"><button class="approve-btn" data-action="approve" data-id="${a.id}">승인</button><button class="reject-btn" data-action="reject" data-id="${a.id}">거절</button></div>`:'-'}</td>
    </tr>
  `).join('')||'<tr><td colspan="14">접수된 지원서가 없어요</td></tr>';
}

document.querySelector('#applicationsBody').addEventListener('click',async e=>{
  const btn=e.target.closest('[data-action]');
  if(!btn) return;
  let body;
  if(btn.dataset.action==='reject'){
    const reason=window.prompt('거절 사유를 입력해주세요 (선택, 비워두면 기본 문구로 발송돼요)')||'';
    body={reason};
  }
  try{
    await api(`/api/admin/applications/${btn.dataset.id}/${btn.dataset.action}`,{method:'POST',body});
    showToast(btn.dataset.action==='approve'?'승인 처리했어요. 안내 문자를 보냈어요':'거절 처리했어요. 안내 문자를 보냈어요');
    loadApplications();loadNotifications();
  }catch(err){showToast(err.message)}
});

async function loadCompanions(){
  const list=await api('/api/admin/companions');
  document.querySelector('#companionsCount').textContent=`총 ${list.length}건`;
  document.querySelector('#companionsBody').innerHTML=list.map(c=>`
    <tr><td>${esc(c.requester_name)}</td><td>${esc(c.target_name)}</td><td>${esc(c.event_name)}</td><td>${esc(c.message||'-')}</td>
    <td><span class="status-pill ${c.status}">${STATUS_LABEL[c.status]}</span></td><td>${fmt(c.created_at)}</td></tr>
  `).join('')||'<tr><td colspan="6">동행 신청 내역이 없어요</td></tr>';
}

async function loadInterests(){
  const list=await api('/api/admin/event-interests');
  document.querySelector('#interestsCount').textContent=`총 ${list.length}건`;
  document.querySelector('#interestsBody').innerHTML=list.map(i=>`
    <tr><td>${i.user_name?esc(i.user_name):'비회원'}</td><td>${esc(i.event_name)}</td><td>${fmt(i.created_at)}</td></tr>
  `).join('')||'<tr><td colspan="3">문의 내역이 없어요</td></tr>';
}

async function loadNotifications(){
  const list=await api('/api/admin/notifications');
  document.querySelector('#notificationsCount').textContent=`최근 ${list.length}건`;
  document.querySelector('#notificationsBody').innerHTML=list.map(n=>`
    <tr><td>${n.user_name?esc(n.user_name):'-'}</td><td>${esc(n.phone||'-')}</td><td>${n.channel==='kakao'?'카카오 알림톡':'SMS'}</td><td>${esc(n.message)}</td>
    <td><span class="status-pill ${n.status}">${STATUS_LABEL[n.status]}</span></td><td>${fmt(n.created_at)}</td></tr>
  `).join('')||'<tr><td colspan="6">발송 기록이 없어요</td></tr>';
}

async function loadCoinCharges(){
  const list=await api('/api/admin/coin-charges');
  document.querySelector('#coinChargesCount').textContent=`총 ${list.length}건`;
  document.querySelector('#coinChargesBody').innerHTML=list.map(c=>`
    <tr data-id="${c.id}">
      <td>${esc(c.user_name)}</td><td>${esc(c.user_email)}</td>
      <td>${c.amount_krw.toLocaleString()}원</td><td>${c.coins.toLocaleString()}</td>
      <td>${c.provider==='toss'?'토스페이먼츠':'수동(무통장입금)'}</td>
      <td><span class="status-pill ${c.status}">${STATUS_LABEL[c.status]}</span></td>
      <td>${esc(c.admin_note||'-')}</td>
      <td>${fmt(c.created_at)}</td>
      <td>${c.status==='pending'?`<div class="row-actions"><button class="approve-btn" data-action="approve" data-id="${c.id}">승인</button><button class="reject-btn" data-action="reject" data-id="${c.id}">거절</button></div>`:'-'}</td>
    </tr>
  `).join('')||'<tr><td colspan="9">충전 요청이 없어요</td></tr>';
}

document.querySelector('#coinChargesBody').addEventListener('click',async e=>{
  const btn=e.target.closest('[data-action]');
  if(!btn) return;
  let body;
  if(btn.dataset.action==='approve'){
    const note=window.prompt('메모를 남기시겠어요? (선택, 예: 입금자명/계좌 확인 내용)')||'';
    body={note};
  }else{
    const reason=window.prompt('거절 사유를 입력해주세요 (선택)')||'';
    body={reason};
  }
  try{
    await api(`/api/admin/coin-charges/${btn.dataset.id}/${btn.dataset.action}`,{method:'POST',body});
    showToast(btn.dataset.action==='approve'?'승인 처리했어요. 코인이 지급되고 안내 알림을 보냈어요':'거절 처리했어요. 안내 알림을 보냈어요');
    loadCoinCharges();loadCoinLedger();loadUsers();loadNotifications();
  }catch(err){showToast(err.message)}
});

const LEDGER_ACCOUNT_LABEL={'platform:cash':'플랫폼 현금','platform:revenue':'플랫폼 매출'};
const LEDGER_TYPE_LABEL={purchase:'코인 충전',message_spend:'쪽지 발송'};
const LEDGER_DIRECTION_LABEL={debit:'차변',credit:'대변'};

async function loadCoinLedger(){
  const list=await api('/api/admin/coin-ledger');
  document.querySelector('#coinLedgerCount').textContent=`최근 ${list.length}건`;
  document.querySelector('#coinLedgerBody').innerHTML=list.map(l=>`
    <tr><td>${esc(l.transaction_group.slice(0,8))}</td>
    <td>${LEDGER_ACCOUNT_LABEL[l.account]||(l.user_name?esc(l.user_name)+' 코인계정':esc(l.account))}</td>
    <td>${LEDGER_DIRECTION_LABEL[l.direction]}</td>
    <td>${l.amount.toLocaleString()}</td>
    <td>${LEDGER_TYPE_LABEL[l.type]||esc(l.type)}</td>
    <td>${esc(l.note||'-')}</td>
    <td>${fmt(l.created_at)}</td></tr>
  `).join('')||'<tr><td colspan="7">원장 기록이 없어요</td></tr>';
}

init();
