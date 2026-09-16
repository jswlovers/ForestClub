const hamburger=document.querySelector('#hamburger'),mobileMenu=document.querySelector('#mobileMenu');
hamburger.onclick=()=>mobileMenu.classList.toggle('show');

function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

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

document.addEventListener('click',e=>{
  const btn=e.target.closest('[data-scroll]');
  if(btn){document.getElementById(btn.dataset.scroll).scrollIntoView({behavior:'smooth'});mobileMenu.classList.remove('show')}
});

document.querySelectorAll('.join').forEach(b=>b.addEventListener('click',async e=>{
  const name=e.target.dataset.name;
  try{
    await api(`/api/events/${encodeURIComponent(name)}/interest`,{method:'POST'});
    showToast(`${name} 문의가 접수되었어요. 담당자가 곧 연락드립니다.`);
    e.target.textContent='문의 접수됨 ✓';
    e.target.disabled=true;
    loadEventCapacity();
  }catch(err){showToast(err.message)}
}));

/* ── 모임 정원 표시 (실제 참가 문의 수 기반) ────────────── */
async function loadEventCapacity(){
  try{
    const events=await api('/api/events');
    events.forEach(ev=>{
      const remainingText=ev.remaining>0?`${ev.remaining}자리 남음`:'마감';
      document.querySelectorAll(`.event-tag[data-event="${CSS.escape(ev.name)}"]`).forEach(el=>{
        el.textContent=`정원 ${ev.capacity}명 · ${remainingText}`;
      });
      document.querySelectorAll(`.travel-card small[data-event="${CSS.escape(ev.name)}"]`).forEach(el=>{
        el.textContent=`${el.dataset.duration} · 정원 ${ev.capacity}명 · ${remainingText}`;
      });
    });
  }catch{}
}
loadEventCapacity();

document.querySelector('#moreGolf').onclick=()=>showToast('이번 시즌 골프 모임 일정 6건을 모두 불러왔어요');
document.querySelector('#moreTravel').onclick=()=>showToast('이번 시즌 여행 프로그램 5건을 모두 불러왔어요');

document.querySelectorAll('.dialog-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());

/* ── 멤버십 지원서 ─────────────────────────────────────── */
const applyDialog=document.querySelector('#applyDialog'),doneDialog=document.querySelector('#doneDialog');
const applyForm=document.querySelector('#applyForm'),applyError=document.querySelector('#applyError');

function openApply(){applyError.textContent='';applyForm.reset();applyDialog.showModal()}
['#applyTop','#applyHero','#applyBottom','#applyMobile'].forEach(sel=>{
  document.querySelector(sel).onclick=()=>{mobileMenu.classList.remove('show');openApply()};
});

applyForm.onsubmit=async e=>{
  e.preventDefault();
  const name=document.querySelector('#applyName').value.trim();
  const phone=document.querySelector('#applyPhone').value.trim();
  const email=document.querySelector('#applyEmail').value.trim();
  const ageGroup=document.querySelector('#applyAge').value;
  const region=document.querySelector('#applyRegion').value.trim();
  const job=document.querySelector('#applyJob').value.trim();
  const golfExperience=document.querySelector('#applyGolf').value;
  const interest=document.querySelector('#applyInterest').value;
  const referrer=document.querySelector('#applyReferrer').value.trim();
  const intro=document.querySelector('#applyIntro').value.trim();
  if(!name||!phone||!email){applyError.textContent='성함, 연락처, 이메일을 입력해주세요';return}
  try{
    await api('/api/applications',{method:'POST',body:{name,phone,email,ageGroup,region,job,golfExperience,interest,referrer,intro}});
    applyDialog.close();
    document.querySelector('#doneText').textContent=`${name}님, ${interest} 분야 지원서가 접수되었습니다. ${ageGroup}${region?' · '+region:''} 프로필로 심사를 시작하며, 접수 확인 문자를 보내드렸어요. 영업일 기준 3일 이내 연락드릴게요.`;
    doneDialog.showModal();
  }catch(err){applyError.textContent=err.message}
};
document.querySelector('#doneClose').onclick=()=>doneDialog.close();

/* ── 회원가입 / 로그인 ─────────────────────────────────── */
const authBtn=document.querySelector('#authBtn'),authMobile=document.querySelector('#authMobile');
const authMenu=document.querySelector('#authMenu'),authDialog=document.querySelector('#authDialog');
const loginForm=document.querySelector('#loginForm'),signupForm=document.querySelector('#signupForm');
const loginError=document.querySelector('#loginError'),signupError=document.querySelector('#signupError');
const adminBtn=document.querySelector('#adminBtn'),adminMobile=document.querySelector('#adminMobile');
const requestsBtn=document.querySelector('#requestsBtn'),requestsMobile=document.querySelector('#requestsMobile');
const profileBtn=document.querySelector('#profileBtn'),profileMobile=document.querySelector('#profileMobile');
const myApplicationsBtn=document.querySelector('#myApplicationsBtn'),myApplicationsMobile=document.querySelector('#myApplicationsMobile');
const messagesBtn=document.querySelector('#messagesBtn'),messagesMobile=document.querySelector('#messagesMobile');
const coinsBtn=document.querySelector('#coinsBtn'),coinsMobile=document.querySelector('#coinsMobile');
const coinBadge=document.querySelector('#coinBadge');
const logoutBtn=document.querySelector('#logoutBtn'),logoutMobile=document.querySelector('#logoutMobile');

let currentUser=null;

function renderAuth(){
  const loggedIn=!!currentUser;
  if(currentUser){
    authBtn.textContent=currentUser.name;authBtn.dataset.state='in';
    adminBtn.classList.toggle('hidden',currentUser.role!=='admin');
    adminMobile.classList.toggle('hidden',currentUser.role!=='admin');
    authMobile.classList.add('hidden');
    logoutMobile.classList.remove('hidden');
    refreshCoinBadge();
  }else{
    authBtn.textContent='로그인';authBtn.dataset.state='out';
    authMobile.classList.remove('hidden');authMobile.textContent='로그인';
    logoutMobile.classList.add('hidden');
    adminBtn.classList.add('hidden');
    adminMobile.classList.add('hidden');
    coinBadge.classList.add('hidden');
  }
  [requestsBtn,requestsMobile,profileBtn,profileMobile,myApplicationsBtn,myApplicationsMobile,messagesBtn,messagesMobile,coinsBtn,coinsMobile].forEach(el=>el.classList.toggle('hidden',!loggedIn));
}

async function refreshSession(){
  try{currentUser=await api('/api/auth/me')}catch{currentUser=null}
  renderAuth();
}
refreshSession();

function openAuthDialog(){loginError.textContent='';signupError.textContent='';loginForm.reset();signupForm.reset();mobileMenu.classList.remove('show');authDialog.showModal()}
authBtn.onclick=()=>{if(authBtn.dataset.state==='in'){authMenu.classList.toggle('show')}else{openAuthDialog()}};
authMobile.onclick=openAuthDialog;

document.querySelectorAll('.auth-tab').forEach(t=>t.onclick=()=>{document.querySelectorAll('.auth-tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');const isLogin=t.dataset.tab==='login';loginForm.classList.toggle('hidden',!isLogin);signupForm.classList.toggle('hidden',isLogin)});

signupForm.onsubmit=async e=>{
  e.preventDefault();
  const name=document.querySelector('#signupName').value.trim();
  const email=document.querySelector('#signupEmail').value.trim();
  const phone=document.querySelector('#signupPhone').value.trim();
  const password=document.querySelector('#signupPassword').value;
  if(!name||!email||password.length<8){signupError.textContent='이름, 이메일, 8자 이상 비밀번호를 확인해주세요';return}
  try{
    currentUser=await api('/api/auth/signup',{method:'POST',body:{name,email,phone,password}});
    authDialog.close();renderAuth();
    showToast(phone?`${name}님, 포레스트클럽 가입을 환영합니다. 환영 문자를 보내드렸어요`:`${name}님, 포레스트클럽 가입을 환영합니다`);
  }catch(err){signupError.textContent=err.message}
};

loginForm.onsubmit=async e=>{
  e.preventDefault();
  const email=document.querySelector('#loginEmail').value.trim();
  const password=document.querySelector('#loginPassword').value;
  try{
    currentUser=await api('/api/auth/login',{method:'POST',body:{email,password}});
    authDialog.close();renderAuth();
    showToast(`${currentUser.name}님, 환영합니다`);
  }catch(err){loginError.textContent=err.message}
};

async function logout(){
  try{await api('/api/auth/logout',{method:'POST'})}catch{}
  currentUser=null;
  authMenu.classList.remove('show');mobileMenu.classList.remove('show');renderAuth();showToast('로그아웃 되었어요');
}
logoutBtn.onclick=logout;logoutMobile.onclick=logout;

/* ── 비밀번호 재설정 ───────────────────────────────────── */
const resetDialog=document.querySelector('#resetDialog');
const resetRequestForm=document.querySelector('#resetRequestForm'),resetConfirmForm=document.querySelector('#resetConfirmForm');
const resetRequestError=document.querySelector('#resetRequestError'),resetConfirmError=document.querySelector('#resetConfirmError');
let resetEmail='';

document.querySelector('#forgotPasswordLink').onclick=()=>{
  authDialog.close();
  resetRequestError.textContent='';resetConfirmError.textContent='';
  resetRequestForm.reset();resetConfirmForm.reset();
  resetRequestForm.classList.remove('hidden');resetConfirmForm.classList.add('hidden');
  resetDialog.showModal();
};

resetRequestForm.onsubmit=async e=>{
  e.preventDefault();
  resetEmail=document.querySelector('#resetEmail').value.trim();
  try{
    const r=await api('/api/auth/password-reset/request',{method:'POST',body:{email:resetEmail}});
    showToast(r.message);
    resetRequestForm.classList.add('hidden');resetConfirmForm.classList.remove('hidden');
  }catch(err){resetRequestError.textContent=err.message}
};

resetConfirmForm.onsubmit=async e=>{
  e.preventDefault();
  const code=document.querySelector('#resetCode').value.trim();
  const newPassword=document.querySelector('#resetNewPassword').value;
  try{
    await api('/api/auth/password-reset/confirm',{method:'POST',body:{email:resetEmail,code,newPassword}});
    resetDialog.close();
    showToast('비밀번호가 재설정됐어요. 새 비밀번호로 로그인해주세요');
    openAuthDialog();
  }catch(err){resetConfirmError.textContent=err.message}
};

adminBtn.onclick=()=>{location.href='/admin.html'};
adminMobile.onclick=()=>{location.href='/admin.html'};

document.addEventListener('click',e=>{if(authMenu.classList.contains('show')&&!authMenu.contains(e.target)&&e.target!==authBtn)authMenu.classList.remove('show')});

/* ── 동행 신청 ─────────────────────────────────────────── */
const companionDialog=document.querySelector('#companionDialog'),companionForm=document.querySelector('#companionForm');
const companionError=document.querySelector('#companionError'),companionTarget=document.querySelector('#companionTarget');
const companionTargetHint=document.querySelector('#companionTargetHint');
let companionEventName=null;
let membersCache=[];

document.querySelectorAll('.companion').forEach(b=>b.addEventListener('click',async e=>{
  if(!currentUser){mobileMenu.classList.remove('show');showToast('동행 신청은 로그인 후 이용할 수 있어요');openAuthDialog();return}
  companionEventName=e.target.dataset.name;
  companionError.textContent='';
  document.querySelector('#companionEventLabel').textContent=`'${companionEventName}' 모임에 함께하고 싶은 회원을 선택해주세요.`;
  companionTarget.innerHTML='<option>불러오는 중...</option>';
  companionTargetHint.textContent='';
  companionForm.reset();
  companionDialog.showModal();
  try{
    membersCache=await api('/api/companions/members');
    if(!membersCache.length){
      companionTarget.innerHTML='<option value="">신청 가능한 회원이 아직 없어요</option>';
    }else{
      companionTarget.innerHTML=membersCache.map(m=>`<option value="${m.id}">${esc(m.name)}${m.interest?` · ${esc(m.interest)}`:''}</option>`).join('');
      updateCompanionHint();
    }
  }catch(err){companionError.textContent=err.message}
}));

companionTarget.addEventListener('change',updateCompanionHint);
function updateCompanionHint(){
  const m=membersCache.find(x=>String(x.id)===companionTarget.value);
  if(!m){companionTargetHint.textContent='';return}
  const parts=[m.age_group,m.region,m.interest].filter(Boolean);
  companionTargetHint.textContent=(parts.length?parts.join(' · ')+' — ':'')+(m.intro||'자기소개가 아직 없어요');
}

companionForm.onsubmit=async e=>{
  e.preventDefault();
  const targetUserId=Number(companionTarget.value);
  const message=document.querySelector('#companionMessage').value.trim();
  if(!targetUserId){companionError.textContent='신청할 회원을 선택해주세요';return}
  try{
    await api('/api/companions',{method:'POST',body:{targetUserId,eventName:companionEventName,message}});
    companionDialog.close();
    showToast('동행 신청을 보냈어요. 상대 회원에게 알림 문자가 발송됩니다');
  }catch(err){companionError.textContent=err.message}
};

/* ── 내 동행 신청함 ────────────────────────────────────── */
const requestsDialog=document.querySelector('#requestsDialog');
const incomingList=document.querySelector('#incomingList'),outgoingList=document.querySelector('#outgoingList');

function openRequests(){mobileMenu.classList.remove('show');authMenu.classList.remove('show');requestsDialog.showModal();loadRequests()}
requestsBtn.onclick=openRequests;requestsMobile.onclick=openRequests;

document.querySelectorAll('.req-tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.req-tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');
  const isIncoming=t.dataset.reqtab==='incoming';
  incomingList.classList.toggle('hidden',!isIncoming);
  outgoingList.classList.toggle('hidden',isIncoming);
});

const STATUS_LABEL={pending:'대기중',accepted:'수락됨',declined:'거절됨',cancelled:'취소됨'};

async function loadRequests(){
  incomingList.innerHTML='<p class="request-empty">불러오는 중...</p>';
  outgoingList.innerHTML='';
  try{
    const [incoming,outgoing]=await Promise.all([api('/api/companions/incoming'),api('/api/companions/outgoing')]);
    incomingList.innerHTML=incoming.length?incoming.map(r=>`
      <div class="request-card" data-id="${r.id}">
        <h4>${esc(r.requester_name)}님의 동행 신청<span class="req-status ${r.status}">${STATUS_LABEL[r.status]}</span></h4>
        <p>모임: ${esc(r.event_name)}</p>
        ${r.message?`<p>메시지: ${esc(r.message)}</p>`:''}
        <div class="req-meta">${new Date(r.created_at).toLocaleString('ko-KR')}</div>
        ${r.status==='pending'?`<div class="req-actions"><button class="accept-btn" data-action="accept" data-id="${r.id}">수락</button><button class="decline-btn" data-action="decline" data-id="${r.id}">거절</button></div>`:''}
      </div>`).join(''):'<p class="request-empty">아직 받은 동행 신청이 없어요</p>';
    outgoingList.innerHTML=outgoing.length?outgoing.map(r=>`
      <div class="request-card" data-id="${r.id}">
        <h4>${esc(r.target_name)}님에게 보낸 신청<span class="req-status ${r.status}">${STATUS_LABEL[r.status]}</span></h4>
        <p>모임: ${esc(r.event_name)}</p>
        ${r.message?`<p>메시지: ${esc(r.message)}</p>`:''}
        <div class="req-meta">${new Date(r.created_at).toLocaleString('ko-KR')}</div>
        ${r.status==='pending'?`<div class="req-actions"><button class="decline-btn" data-action="cancel" data-id="${r.id}">신청 취소</button></div>`:''}
      </div>`).join(''):'<p class="request-empty">아직 보낸 동행 신청이 없어요</p>';
  }catch(err){incomingList.innerHTML=`<p class="request-empty">${esc(err.message)}</p>`}
}

const REQUEST_ACTION_TOAST={accept:'동행 신청을 수락했어요',decline:'동행 신청을 거절했어요',cancel:'동행 신청을 취소했어요'};

document.querySelectorAll('#incomingList,#outgoingList').forEach(list=>list.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-action]');
  if(!btn) return;
  try{
    await api(`/api/companions/${btn.dataset.id}/${btn.dataset.action}`,{method:'POST'});
    showToast(REQUEST_ACTION_TOAST[btn.dataset.action]);
    loadRequests();
  }catch(err){showToast(err.message)}
}));

/* ── 내 프로필 ─────────────────────────────────────────── */
const profileDialog=document.querySelector('#profileDialog'),profileForm=document.querySelector('#profileForm');
const profileError=document.querySelector('#profileError');

function openProfile(){
  mobileMenu.classList.remove('show');authMenu.classList.remove('show');
  profileError.textContent='';passwordError.textContent='';passwordForm.reset();
  document.querySelector('#profilePhone').value=currentUser.phone||'';
  document.querySelector('#profileAge').value=currentUser.ageGroup||'';
  document.querySelector('#profileRegion').value=currentUser.region||'';
  document.querySelector('#profileJob').value=currentUser.job||'';
  document.querySelector('#profileGolf').value=currentUser.golfExperience||'';
  document.querySelector('#profileInterest').value=currentUser.interest||'';
  document.querySelector('#profileIntro').value=currentUser.intro||'';
  profileDialog.showModal();
}
profileBtn.onclick=openProfile;profileMobile.onclick=openProfile;

profileForm.onsubmit=async e=>{
  e.preventDefault();
  const body={
    phone:document.querySelector('#profilePhone').value.trim(),
    ageGroup:document.querySelector('#profileAge').value,
    region:document.querySelector('#profileRegion').value.trim(),
    job:document.querySelector('#profileJob').value.trim(),
    golfExperience:document.querySelector('#profileGolf').value,
    interest:document.querySelector('#profileInterest').value,
    intro:document.querySelector('#profileIntro').value.trim(),
  };
  try{
    currentUser=await api('/api/auth/profile',{method:'PATCH',body});
    profileDialog.close();
    showToast('프로필을 저장했어요');
  }catch(err){profileError.textContent=err.message}
};

const passwordForm=document.querySelector('#passwordForm'),passwordError=document.querySelector('#passwordError');
passwordForm.onsubmit=async e=>{
  e.preventDefault();
  const currentPassword=document.querySelector('#currentPassword').value;
  const newPassword=document.querySelector('#newPassword').value;
  try{
    await api('/api/auth/password',{method:'POST',body:{currentPassword,newPassword}});
    passwordForm.reset();
    showToast('비밀번호를 변경했어요');
  }catch(err){passwordError.textContent=err.message}
};

/* ── 내 지원 현황 ──────────────────────────────────────── */
const myApplicationsDialog=document.querySelector('#myApplicationsDialog');
const myApplicationsList=document.querySelector('#myApplicationsList');
const APP_STATUS_LABEL={pending:'심사중',approved:'승인됨',rejected:'거절됨'};

function openMyApplications(){
  mobileMenu.classList.remove('show');authMenu.classList.remove('show');
  myApplicationsDialog.showModal();
  loadMyApplications();
}
myApplicationsBtn.onclick=openMyApplications;myApplicationsMobile.onclick=openMyApplications;

async function loadMyApplications(){
  myApplicationsList.innerHTML='<p class="request-empty">불러오는 중...</p>';
  try{
    const apps=await api('/api/applications/me');
    myApplicationsList.innerHTML=apps.length?apps.map(a=>`
      <div class="request-card">
        <h4>${esc(a.interest||'멤버십')} 지원서<span class="req-status ${a.status}">${APP_STATUS_LABEL[a.status]}</span></h4>
        <p>${esc(a.age_group||'-')}${a.region?' · '+esc(a.region):''}</p>
        ${a.admin_note?`<p>운영진 메모: ${esc(a.admin_note)}</p>`:''}
        <div class="req-meta">${new Date(a.created_at).toLocaleString('ko-KR')}</div>
      </div>`).join(''):'<p class="request-empty">아직 제출한 지원서가 없어요</p>';
  }catch(err){myApplicationsList.innerHTML=`<p class="request-empty">${esc(err.message)}</p>`}
}

/* ── 코인 ──────────────────────────────────────────────── */
const coinsDialog=document.querySelector('#coinsDialog'),chargeForm=document.querySelector('#chargeForm');
const chargeError=document.querySelector('#chargeError'),chargeHistory=document.querySelector('#chargeHistory');
const coinsBalanceEl=document.querySelector('#coinsBalance');

async function refreshCoinBadge(){
  try{
    const {coins}=await api('/api/coins/balance');
    coinBadge.textContent=`${coins.toLocaleString()} 코인`;
    coinBadge.classList.remove('hidden');
    return coins;
  }catch{coinBadge.classList.add('hidden');return 0}
}
coinBadge.onclick=()=>openCoins();

const CHARGE_STATUS_LABEL={pending:'대기중',approved:'승인됨',rejected:'반려됨'};

function openCoins(){
  mobileMenu.classList.remove('show');authMenu.classList.remove('show');
  chargeError.textContent='';chargeForm.reset();
  coinsDialog.showModal();
  loadCoinInfo();
}
coinsBtn.onclick=openCoins;coinsMobile.onclick=openCoins;

async function loadCoinInfo(){
  const coins=await refreshCoinBadge();
  coinsBalanceEl.textContent=coins.toLocaleString();
  chargeHistory.innerHTML='<p class="request-empty">불러오는 중...</p>';
  try{
    const list=await api('/api/coins/charge-requests/me');
    chargeHistory.innerHTML=list.length?list.map(c=>`
      <div class="request-card">
        <h4>${c.amount_krw.toLocaleString()}원 충전 (${c.coins.toLocaleString()}코인)<span class="req-status ${c.status}">${CHARGE_STATUS_LABEL[c.status]}</span></h4>
        ${c.admin_note?`<p>메모: ${esc(c.admin_note)}</p>`:''}
        <div class="req-meta">${new Date(c.created_at).toLocaleString('ko-KR')}</div>
      </div>`).join(''):'<p class="request-empty">아직 충전 내역이 없어요</p>';
  }catch(err){chargeHistory.innerHTML=`<p class="request-empty">${esc(err.message)}</p>`}
}

chargeForm.onsubmit=async e=>{
  e.preventDefault();
  const amountKrw=Number(document.querySelector('#chargeAmount').value);
  try{
    await api('/api/coins/charge-requests',{method:'POST',body:{amountKrw}});
    chargeForm.reset();
    showToast('충전 신청을 접수했어요. 입금 확인 후 코인이 지급돼요');
    loadCoinInfo();
  }catch(err){chargeError.textContent=err.message}
};

/* ── 쪽지 ──────────────────────────────────────────────── */
const messagesDialog=document.querySelector('#messagesDialog');
const inboxList=document.querySelector('#inboxList'),sentList=document.querySelector('#sentList');
const composeDialog=document.querySelector('#composeDialog'),composeForm=document.querySelector('#composeForm');
const composeError=document.querySelector('#composeError'),composeTarget=document.querySelector('#composeTarget');
const composeBalance=document.querySelector('#composeBalance');

function openMessages(){
  mobileMenu.classList.remove('show');authMenu.classList.remove('show');
  messagesDialog.showModal();
  loadMessages();
}
messagesBtn.onclick=openMessages;messagesMobile.onclick=openMessages;

document.querySelectorAll('#messagesDialog .req-tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('#messagesDialog .req-tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');
  const isInbox=t.dataset.msgtab==='inbox';
  inboxList.classList.toggle('hidden',!isInbox);
  sentList.classList.toggle('hidden',isInbox);
});

async function loadMessages(){
  inboxList.innerHTML='<p class="request-empty">불러오는 중...</p>';
  sentList.innerHTML='';
  try{
    const [inbox,sent]=await Promise.all([api('/api/messages/inbox'),api('/api/messages/sent')]);
    inboxList.innerHTML=inbox.length?inbox.map(m=>`
      <div class="request-card">
        <h4>${esc(m.sender_name)}님이 보낸 쪽지</h4>
        <p>${esc(m.body)}</p>
        <div class="req-meta">${new Date(m.created_at).toLocaleString('ko-KR')}</div>
      </div>`).join(''):'<p class="request-empty">받은 쪽지가 없어요</p>';
    sentList.innerHTML=sent.length?sent.map(m=>`
      <div class="request-card">
        <h4>${esc(m.recipient_name)}님에게 보낸 쪽지</h4>
        <p>${esc(m.body)}</p>
        <div class="req-meta">${new Date(m.created_at).toLocaleString('ko-KR')}</div>
      </div>`).join(''):'<p class="request-empty">보낸 쪽지가 없어요</p>';
  }catch(err){inboxList.innerHTML=`<p class="request-empty">${esc(err.message)}</p>`}
}

document.querySelector('#composeBtn').onclick=async()=>{
  composeError.textContent='';composeForm.reset();
  composeTarget.innerHTML='<option>불러오는 중...</option>';
  composeDialog.showModal();
  try{
    const [members,{coins}]=await Promise.all([api('/api/messages/members'),api('/api/coins/balance')]);
    composeBalance.textContent=coins.toLocaleString();
    composeTarget.innerHTML=members.length?members.map(m=>`<option value="${m.id}">${esc(m.name)}${m.interest?` · ${esc(m.interest)}`:''}</option>`).join(''):'<option value="">쪽지를 보낼 회원이 없어요</option>';
  }catch(err){composeError.textContent=err.message}
};

composeForm.onsubmit=async e=>{
  e.preventDefault();
  const recipientUserId=Number(composeTarget.value);
  const body=document.querySelector('#composeBody').value.trim();
  if(!recipientUserId){composeError.textContent='받을 회원을 선택해주세요';return}
  if(!body){composeError.textContent='메시지 내용을 입력해주세요';return}
  try{
    await api('/api/messages',{method:'POST',body:{recipientUserId,body}});
    composeDialog.close();
    showToast('쪽지를 보냈어요 (500코인 사용)');
    refreshCoinBadge();
    loadMessages();
  }catch(err){composeError.textContent=err.message}
};
