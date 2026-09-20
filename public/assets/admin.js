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
  await Promise.all([loadUsers(),loadApplications(),loadIdentityVerifications(),loadCompanions(),loadInterests(),loadTickets(),loadCoinCharges(),loadCoinLedger(),loadNotifications(),loadKakao()]);
}

const REPORT_WARN_THRESHOLD=3,REPORT_SUSPEND_THRESHOLD=5;
// 본인 인증은 "신분증 인증" 탭의 서류 심사로만 부여되므로 여기 수동 토글에는 넣지 않는다.
const VERIFY_TYPE_LABEL={employment:'재직',golf:'골프'};

function verifyToggles(u){
  const identityPill=`<span class="status-pill ${u.verified_identity_at?'approved':'pending'}">${u.verified_identity_at?'✓ 본인인증':'본인 미인증'}</span>`;
  const toggles=Object.entries(VERIFY_TYPE_LABEL).map(([type,label])=>{
    const on=!!u[`verified_${type}_at`];
    return `<button type="button" class="verify-toggle${on?' on':''}" data-action="toggle-verify" data-type="${type}" data-id="${u.id}" data-on="${on}">${on?'✓ ':''}${label}</button>`;
  }).join('');
  return identityPill+toggles;
}

async function loadUsers(){
  const users=await api('/api/admin/users');
  document.querySelector('#usersCount').textContent=`총 ${users.length}명`;
  document.querySelector('#usersBody').innerHTML=users.map(u=>`
    <tr data-id="${u.id}">
      <td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.phone||'-')}</td><td>${u.role==='admin'?'관리자':'회원'}</td><td>${u.coins.toLocaleString()}</td>
      <td>${u.suspended_at?`<span class="status-pill suspended" title="${esc(u.suspended_reason||'')}">정지됨</span>`:'<span class="status-pill approved">정상</span>'}</td>
      <td>${u.report_count?`<span class="status-pill ${u.report_count>=REPORT_SUSPEND_THRESHOLD?'suspended':(u.report_count>=REPORT_WARN_THRESHOLD?'pending':'')}">${u.report_count}건</span>`:'-'}</td>
      <td>${u.role==='admin'?'-':verifyToggles(u)}</td>
      <td>${fmt(u.created_at)}</td>
      <td>${u.role==='admin'?'-':(u.suspended_at?`<div class="row-actions"><button class="approve-btn" data-action="unsuspend" data-id="${u.id}">정지 해제</button></div>`:`<div class="row-actions"><button class="reject-btn" data-action="suspend" data-id="${u.id}">이용 정지</button></div>`)}</td>
    </tr>
  `).join('')||'<tr><td colspan="10">회원이 없어요</td></tr>';

  const notifyUser=document.querySelector('#notifyUser');
  const withPhone=users.filter(u=>u.role!=='admin'&&u.phone);
  const userOptions=withPhone.length?withPhone.map(u=>`<option value="${u.id}">${esc(u.name)} (${esc(u.email)})</option>`).join(''):'<option value="">연락처가 등록된 회원이 없어요</option>';
  notifyUser.innerHTML=userOptions;
  document.querySelector('#kakaoUser').innerHTML=userOptions;
}

document.querySelector('#usersBody').addEventListener('click',async e=>{
  const btn=e.target.closest('[data-action]');
  if(!btn) return;
  if(btn.dataset.action==='toggle-verify'){
    try{
      const verified=btn.dataset.on!=='true';
      await api(`/api/admin/users/${btn.dataset.id}/verify`,{method:'POST',body:{type:btn.dataset.type,verified}});
      loadUsers();
    }catch(err){showToast(err.message)}
    return;
  }
  let body;
  if(btn.dataset.action==='suspend'){
    const reason=window.prompt('정지 사유를 입력해주세요 (선택)')||'';
    body={reason};
  }
  try{
    await api(`/api/admin/users/${btn.dataset.id}/${btn.dataset.action}`,{method:'POST',body});
    showToast(btn.dataset.action==='suspend'?'회원 이용을 정지했어요':'정지를 해제했어요');
    loadUsers();loadTickets();
  }catch(err){showToast(err.message)}
});

const STATUS_LABEL={pending:'대기중',approved:'승인됨',rejected:'거절됨',accepted:'수락됨',declined:'거절됨',cancelled:'취소됨',sent:'발송됨',mock:'모의발송',failed:'발송실패',in_progress:'처리중',resolved:'처리완료'};
const TICKET_CATEGORY_LABEL={complaint:'클레임/불만',refund:'환불 요청',report:'회원 신고',other:'기타 요청'};

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

async function loadIdentityVerifications(){
  const list=await api('/api/admin/identity-verifications');
  document.querySelector('#identityCount').textContent=`총 ${list.length}건`;
  document.querySelector('#identityBody').innerHTML=list.map(v=>`
    <tr data-id="${v.id}">
      <td>${esc(v.user_name)}<br>${esc(v.user_email)}</td>
      <td><a href="${v.document_url}" target="_blank" rel="noopener"><img class="id-doc-thumb" src="${v.document_url}" alt="신분증"></a></td>
      <td><span class="status-pill ${v.status}">${STATUS_LABEL[v.status]}</span></td>
      <td>${esc(v.admin_note||'-')}</td>
      <td>${fmt(v.created_at)}</td>
      <td>${v.status==='pending'?`<div class="row-actions"><button class="approve-btn" data-action="approve" data-id="${v.id}">승인</button><button class="reject-btn" data-action="reject" data-id="${v.id}">반려</button></div>`:'-'}</td>
    </tr>
  `).join('')||'<tr><td colspan="6">접수된 신청이 없어요</td></tr>';
}

document.querySelector('#identityBody').addEventListener('click',async e=>{
  const btn=e.target.closest('[data-action]');
  if(!btn) return;
  let body;
  if(btn.dataset.action==='approve'){
    const note=window.prompt('메모를 남기시겠어요? (선택)')||'';
    body={note};
  }else{
    const reason=window.prompt('반려 사유를 입력해주세요 (선택)')||'';
    body={reason};
  }
  try{
    await api(`/api/admin/identity-verifications/${btn.dataset.id}/${btn.dataset.action}`,{method:'POST',body});
    showToast(btn.dataset.action==='approve'?'본인 인증을 승인했어요. 안내 문자를 보냈어요':'반려 처리했어요. 안내 문자를 보냈어요');
    loadIdentityVerifications();loadUsers();loadNotifications();
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

function ticketTargetCell(t){
  if(t.category==='report'){
    return t.target_name?`${esc(t.target_name)}${t.target_suspended_at?' <span class="status-pill suspended">정지됨</span>':''}`:'-';
  }
  if(t.category==='refund'){
    return t.charge_amount_krw?`${t.charge_amount_krw.toLocaleString()}원 (${t.charge_coins.toLocaleString()}코인)`:'-';
  }
  return '-';
}

function ticketActionsCell(t){
  const actions=[];
  if(t.status==='pending'||t.status==='in_progress'){
    if(t.category==='refund'){
      actions.push(`<button class="approve-btn" data-action="refund" data-id="${t.id}">환불 처리</button>`);
    }else{
      actions.push(`<button class="approve-btn" data-action="resolve" data-id="${t.id}">완료 처리</button>`);
    }
    if(t.status==='pending'){
      actions.push(`<button data-action="in_progress" data-id="${t.id}">처리중으로</button>`);
    }
    actions.push(`<button class="reject-btn" data-action="reject" data-id="${t.id}">반려</button>`);
  }
  if(t.category==='report'&&t.target_id){
    actions.push(t.target_suspended_at
      ?`<button class="approve-btn" data-action="unsuspend-target" data-id="${t.id}" data-target="${t.target_id}">정지 해제</button>`
      :`<button class="reject-btn" data-action="suspend-target" data-id="${t.id}" data-target="${t.target_id}">회원 정지</button>`);
  }
  return actions.length?`<div class="row-actions">${actions.join('')}</div>`:'-';
}

async function loadTickets(){
  const list=await api('/api/admin/tickets');
  document.querySelector('#ticketsCount').textContent=`총 ${list.length}건`;
  document.querySelector('#ticketsBody').innerHTML=list.map(t=>`
    <tr data-id="${t.id}">
      <td>${esc(t.user_name)}<br>${esc(t.user_email)}</td>
      <td>${esc(TICKET_CATEGORY_LABEL[t.category]||t.category)}</td>
      <td>${esc(t.subject)}</td>
      <td>${esc(t.body)}</td>
      <td>${ticketTargetCell(t)}</td>
      <td><span class="status-pill ${t.status}">${STATUS_LABEL[t.status]}</span></td>
      <td>${esc(t.admin_note||'-')}${t.refund_coins?`<br>환불 ${t.refund_coins.toLocaleString()}코인`:''}</td>
      <td>${fmt(t.created_at)}</td>
      <td>${ticketActionsCell(t)}</td>
    </tr>
  `).join('')||'<tr><td colspan="9">접수된 문의가 없어요</td></tr>';
}

document.querySelector('#ticketsBody').addEventListener('click',async e=>{
  const btn=e.target.closest('[data-action]');
  if(!btn) return;
  const action=btn.dataset.action;
  try{
    if(action==='refund'){
      const amount=Number(window.prompt('환불할 코인 수를 입력해주세요')||'');
      if(!amount||amount<=0){showToast('환불할 코인 수를 확인해주세요');return}
      const note=window.prompt('메모를 남기시겠어요? (선택)')||'';
      await api(`/api/admin/tickets/${btn.dataset.id}/refund`,{method:'POST',body:{amount,note}});
      showToast('환불 처리했어요. 코인이 지급되고 안내 알림을 보냈어요');
    }else if(action==='resolve'||action==='in_progress'||action==='reject'){
      const note=window.prompt(action==='reject'?'반려 사유를 입력해주세요 (선택)':'메모를 남기시겠어요? (선택)')||'';
      const status=action==='resolve'?'resolved':(action==='reject'?'rejected':'in_progress');
      await api(`/api/admin/tickets/${btn.dataset.id}/status`,{method:'POST',body:{status,note}});
      showToast('처리 상태를 업데이트했어요. 안내 알림을 보냈어요');
    }else if(action==='suspend-target'||action==='unsuspend-target'){
      const targetAction=action==='suspend-target'?'suspend':'unsuspend';
      let body;
      if(targetAction==='suspend'){
        const reason=window.prompt('정지 사유를 입력해주세요 (선택)')||'';
        body={reason};
      }
      await api(`/api/admin/users/${btn.dataset.target}/${targetAction}`,{method:'POST',body});
      showToast(targetAction==='suspend'?'회원 이용을 정지했어요':'정지를 해제했어요');
    }
    loadTickets();loadUsers();loadCoinLedger();loadNotifications();
  }catch(err){showToast(err.message)}
});

async function loadNotifications(){
  const list=await api('/api/admin/notifications');
  document.querySelector('#notificationsCount').textContent=`최근 ${list.length}건`;
  document.querySelector('#notificationsBody').innerHTML=list.map(n=>`
    <tr><td>${n.user_name?esc(n.user_name):'-'}</td><td>${esc(n.phone||'-')}</td><td>${n.channel==='kakao'?'카카오 알림톡':'SMS'}</td><td>${esc(n.message)}</td>
    <td><span class="status-pill ${n.status}">${STATUS_LABEL[n.status]}</span></td><td>${fmt(n.created_at)}</td></tr>
  `).join('')||'<tr><td colspan="6">발송 기록이 없어요</td></tr>';
}

const notifyForm=document.querySelector('#notifyForm'),notifyError=document.querySelector('#notifyError');
const notifyTarget=document.querySelector('#notifyTarget'),notifyUserField=document.querySelector('#notifyUserField');

notifyTarget.addEventListener('change',()=>{
  notifyUserField.classList.toggle('hidden',notifyTarget.value!=='user');
});

notifyForm.onsubmit=async e=>{
  e.preventDefault();
  notifyError.textContent='';
  const target=notifyTarget.value;
  const message=document.querySelector('#notifyMessage').value.trim();
  if(!message){notifyError.textContent='보낼 메시지를 입력해주세요';return}
  const body={target,message};
  if(target==='user'){
    const userId=Number(document.querySelector('#notifyUser').value);
    if(!userId){notifyError.textContent='보낼 회원을 선택해주세요';return}
    body.userId=userId;
  }else if(!window.confirm('연락처가 등록된 전체 회원에게 발송할까요?')){
    return;
  }
  try{
    const result=await api('/api/admin/notify',{method:'POST',body});
    showToast(`발송 완료: 총 ${result.total}건 중 성공 ${result.sent}건${result.failed?`, 실패 ${result.failed}건`:''}`);
    document.querySelector('#notifyMessage').value='';
    loadNotifications();
  }catch(err){notifyError.textContent=err.message}
};

/* ── 카카오톡 발송 ─────────────────────────────────────────── */
const kakaoForm=document.querySelector('#kakaoForm'),kakaoError=document.querySelector('#kakaoError');
const kakaoType=document.querySelector('#kakaoType'),kakaoAudience=document.querySelector('#kakaoAudience');
const kakaoMessage=document.querySelector('#kakaoMessage'),kakaoPreview=document.querySelector('#kakaoPreview');
const KAKAO_TYPE_LABEL={alimtalk:'알림톡',friendtalk:'친구톡(광고)'};
const KAKAO_AUDIENCE_LABEL={all:'전체 회원',approved:'멤버십 승인 회원',verified:'본인 인증 완료 회원',interest_golf:'골프 관심 회원',interest_travel:'여행 관심 회원',user:'특정 회원'};
const KAKAO_TYPE_HINT={
  alimtalk:'결제 확인, 일정 변경처럼 회원이 알아야 하는 정보성 안내에만 쓰세요. 홍보·이벤트 내용은 넣으면 안 돼요. 승인된 알림톡 템플릿이 필요하고, 수신 동의 없이도 발송돼요.',
  friendtalk:'이벤트, 신규 모임 소식 같은 광고성 내용에 쓰세요. 광고 수신에 동의하고 카카오 채널을 친구 추가한 회원에게만 도달하며, "(광고)" 표기와 무료수신거부 문구가 자동으로 붙어요. 오후 8시 50분~오전 8시에는 발송할 수 없어요.',
};
let kakaoStatus=null;

function kakaoBody(){
  const body={type:kakaoType.value,audience:kakaoAudience.value,message:kakaoMessage.value.trim()};
  if(body.audience==='user') body.userId=Number(document.querySelector('#kakaoUser').value);
  return body;
}

function renderKakaoStatus(){
  const s=kakaoStatus;
  const live=(on,label)=>`<div>${label}: ${on?'<span class="ok">실제 발송</span>':'<span class="warn">모의 발송 (카카오 키/채널/템플릿 미설정이라 실제로는 나가지 않아요)</span>'}</div>`;
  document.querySelector('#kakaoStatus').innerHTML=
    live(s.alimtalkLive,'알림톡')+live(s.friendtalkLive,'친구톡')+
    `<div>연락처 등록 회원 ${s.reachable}명 중 광고 수신 동의 <strong>${s.consented}명</strong></div>`+
    (s.nightBlocked?'<div class="warn">지금은 야간 시간대(20:50~08:00)라 친구톡을 보낼 수 없어요</div>':'');
  document.querySelector('#kakaoTypeHint').textContent=KAKAO_TYPE_HINT[kakaoType.value];
  document.querySelector('#kakaoCharCount').textContent=`${kakaoMessage.value.length}/${s.maxMessageLength}`;
}

async function loadKakao(){
  const [status,campaigns]=await Promise.all([api('/api/admin/kakao/status'),api('/api/admin/kakao/campaigns')]);
  kakaoStatus=status;
  renderKakaoStatus();
  document.querySelector('#kakaoCount').textContent=`발송 이력 ${campaigns.length}건`;
  document.querySelector('#kakaoCampaignsBody').innerHTML=campaigns.map(c=>`
    <tr><td>${fmt(c.created_at)}</td><td>${KAKAO_TYPE_LABEL[c.type]||esc(c.type)}</td>
    <td>${esc(KAKAO_AUDIENCE_LABEL[c.audience]||c.audience)}${c.target_name?` (${esc(c.target_name)})`:''}</td>
    <td>${esc(c.message)}</td><td>${c.total}</td><td>${c.sent}</td><td>${c.mocked}</td><td>${c.failed}</td><td>${c.skipped_no_consent}</td><td>${esc(c.admin_name)}</td></tr>
  `).join('')||'<tr><td colspan="10">발송 이력이 없어요</td></tr>';
}

kakaoType.addEventListener('change',()=>{kakaoPreview.classList.add('hidden');if(kakaoStatus)renderKakaoStatus()});
kakaoAudience.addEventListener('change',()=>{
  document.querySelector('#kakaoUserField').classList.toggle('hidden',kakaoAudience.value!=='user');
  kakaoPreview.classList.add('hidden');
});
kakaoMessage.addEventListener('input',()=>{if(kakaoStatus)renderKakaoStatus()});

document.querySelector('#kakaoPreviewBtn').onclick=async()=>{
  kakaoError.textContent='';
  const {type,audience,userId,message}=kakaoBody();
  if(audience==='user'&&!userId){kakaoError.textContent='보낼 회원을 선택해주세요';return}
  try{
    const qs=new URLSearchParams({type,audience});
    if(userId) qs.set('userId',userId);
    const p=await api(`/api/admin/kakao/preview?${qs}`);
    const text=type==='friendtalk'?`${kakaoStatus.adPrefix}${message||'(내용)'}${kakaoStatus.adSuffix}`:(message||'(내용)');
    kakaoPreview.textContent=
      `받는 사람: ${p.count}명${p.sampleNames.length?` (${p.sampleNames.join(', ')}${p.count>p.sampleNames.length?' 외':''})`:''}`+
      `${p.skippedNoConsent?`\n광고 수신 미동의로 제외: ${p.skippedNoConsent}명`:''}\n\n실제 발송 문구\n──────────\n${text}`;
    kakaoPreview.classList.remove('hidden');
  }catch(err){kakaoError.textContent=err.message}
};

kakaoForm.onsubmit=async e=>{
  e.preventDefault();
  kakaoError.textContent='';
  const body=kakaoBody();
  if(!body.message){kakaoError.textContent='보낼 메시지를 입력해주세요';return}
  if(body.audience==='user'&&!body.userId){kakaoError.textContent='보낼 회원을 선택해주세요';return}
  try{
    const qs=new URLSearchParams({type:body.type,audience:body.audience});
    if(body.userId) qs.set('userId',body.userId);
    const p=await api(`/api/admin/kakao/preview?${qs}`);
    if(!p.count){kakaoError.textContent=body.type==='friendtalk'&&p.skippedNoConsent?'광고 수신에 동의한 회원이 없어요':'연락처가 등록된 대상 회원이 없어요';return}
    if(!window.confirm(`${KAKAO_TYPE_LABEL[body.type]}을(를) ${p.count}명에게 발송할까요?\n보낸 메시지는 취소할 수 없어요.`)) return;
    const sendBtn=document.querySelector('#kakaoSendBtn');
    sendBtn.disabled=true;
    try{
      const r=await api('/api/admin/kakao/send',{method:'POST',body});
      showToast(`발송 완료: ${r.total}명 중 ${r.sent?`성공 ${r.sent}`:`모의 ${r.mocked}`}${r.failed?`, 실패 ${r.failed}`:''}`);
      kakaoMessage.value='';kakaoPreview.classList.add('hidden');
      loadKakao();loadNotifications();
    }finally{sendBtn.disabled=false}
  }catch(err){kakaoError.textContent=err.message}
};

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
const LEDGER_TYPE_LABEL={purchase:'코인 충전',message_spend:'쪽지 발송',call_voice_spend:'보이스톡 이용',call_video_spend:'페이스톡 이용',refund:'환불 지급'};
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
