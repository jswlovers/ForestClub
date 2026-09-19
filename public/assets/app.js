const hamburger=document.querySelector('#hamburger'),mobileMenu=document.querySelector('#mobileMenu');
hamburger.onclick=()=>mobileMenu.classList.toggle('show');

function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

function avatarHtml(photoUrl,name,size){
  size=size||36;
  if(photoUrl) return `<img class="avatar" src="${esc(photoUrl)}" alt="${esc(name||'')}" style="width:${size}px;height:${size}px">`;
  return `<span class="avatar avatar-fallback" style="width:${size}px;height:${size}px">${esc((name||'?').trim().charAt(0)||'?')}</span>`;
}

const VERIFY_BADGE_LABEL={identity:'본인인증',employment:'재직인증',golf:'골프인증'};
function verifyBadgesHtml(m){
  const badges=[];
  if(m.verified_identity)badges.push(`<span class="verify-badge">✓ ${VERIFY_BADGE_LABEL.identity}</span>`);
  if(m.verified_employment)badges.push(`<span class="verify-badge">✓ ${VERIFY_BADGE_LABEL.employment}</span>`);
  if(m.verified_golf)badges.push(`<span class="verify-badge">✓ ${VERIFY_BADGE_LABEL.golf}</span>`);
  return badges.join('');
}

async function api(path,options={}){
  const isFormData=options.body instanceof FormData;
  const res=await fetch(path,{
    method:options.method||'GET',
    headers:options.body&&!isFormData?{'Content-Type':'application/json'}:undefined,
    body:options.body?(isFormData?options.body:JSON.stringify(options.body)):undefined,
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
const supportBtn=document.querySelector('#supportBtn'),supportMobile=document.querySelector('#supportMobile');
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
    establishMessageBaseline();
  }else{
    authBtn.textContent='로그인';authBtn.dataset.state='out';
    authMobile.classList.remove('hidden');authMobile.textContent='로그인';
    logoutMobile.classList.add('hidden');
    adminBtn.classList.add('hidden');
    adminMobile.classList.add('hidden');
    coinBadge.classList.add('hidden');
    setUnreadBadge(0);
    messageBaselineReady=false;
  }
  [requestsBtn,requestsMobile,profileBtn,profileMobile,myApplicationsBtn,myApplicationsMobile,messagesBtn,messagesMobile,coinsBtn,coinsMobile,supportBtn,supportMobile].forEach(el=>el.classList.toggle('hidden',!loggedIn));
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
    membersCache.sort((a,b)=>matchScore(b)-matchScore(a));
    if(!membersCache.length){
      companionTarget.innerHTML='<option value="">신청 가능한 회원이 아직 없어요</option>';
    }else{
      companionTarget.innerHTML=membersCache.map(m=>`<option value="${m.id}">${matchScore(m)>0?'🎯 ':''}${esc(m.name)}${m.interest?` · ${esc(m.interest)}`:''}</option>`).join('');
      updateCompanionHint();
    }
  }catch(err){companionError.textContent=err.message}
}));

// 내 프로필(관심분야/지역/골프구력/연령대)과 겹치는 항목이 많을수록 추천 우선순위를 높인다.
function matchScore(m){
  if(!currentUser) return 0;
  let score=0;
  if(currentUser.interest&&m.interest===currentUser.interest)score+=2;
  if(currentUser.region&&m.region===currentUser.region)score+=1;
  if(currentUser.golfExperience&&m.golf_experience===currentUser.golfExperience)score+=1;
  if(currentUser.ageGroup&&m.age_group===currentUser.ageGroup)score+=1;
  return score;
}

companionTarget.addEventListener('change',updateCompanionHint);
function updateCompanionHint(){
  const m=membersCache.find(x=>String(x.id)===companionTarget.value);
  if(!m){companionTargetHint.innerHTML='';return}
  const parts=[m.age_group,m.region,m.interest].filter(Boolean);
  const introText=(parts.length?parts.join(' · ')+' — ':'')+(m.intro||'자기소개가 아직 없어요');
  companionTargetHint.innerHTML=`
    <div class="hint-row">
      ${avatarHtml(m.photo_url,m.name,44)}
      <div class="hint-body">
        ${matchScore(m)>0?'<span class="recommend-tag">🎯 추천</span>':''}${verifyBadgesHtml(m)}
        <p>${esc(introText)}</p>
      </div>
    </div>`;
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

function renderProfilePhotoAndBadges(){
  document.querySelector('#profilePhotoPreview').innerHTML=avatarHtml(currentUser.photoUrl,currentUser.name,64);
  const v=currentUser.verified||{};
  const badges=[
    v.identity?`<span class="verify-badge">✓ ${VERIFY_BADGE_LABEL.identity}</span>`:`<span class="verify-badge pending">${VERIFY_BADGE_LABEL.identity} 미인증</span>`,
    v.employment?`<span class="verify-badge">✓ ${VERIFY_BADGE_LABEL.employment}</span>`:`<span class="verify-badge pending">${VERIFY_BADGE_LABEL.employment} 미인증</span>`,
    v.golf?`<span class="verify-badge">✓ ${VERIFY_BADGE_LABEL.golf}</span>`:`<span class="verify-badge pending">${VERIFY_BADGE_LABEL.golf} 미인증</span>`,
  ];
  document.querySelector('#profileBadges').innerHTML=badges.join('');
}

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
  renderProfilePhotoAndBadges();
  profileDialog.showModal();
  loadIdentitySection();
}
profileBtn.onclick=openProfile;profileMobile.onclick=openProfile;

const profilePhotoBtn=document.querySelector('#profilePhotoBtn'),profilePhotoInput=document.querySelector('#profilePhotoInput');
const profilePhotoHint=document.querySelector('#profilePhotoHint');
profilePhotoBtn.onclick=()=>profilePhotoInput.click();
profilePhotoInput.onchange=async()=>{
  const file=profilePhotoInput.files[0];
  if(!file) return;
  if(file.size>5*1024*1024){profilePhotoHint.textContent='사진은 5MB 이하만 올릴 수 있어요';profilePhotoInput.value='';return}
  const fd=new FormData();
  fd.append('photo',file);
  try{
    const {photoUrl}=await api('/api/auth/photo',{method:'POST',body:fd});
    currentUser.photoUrl=photoUrl;
    renderProfilePhotoAndBadges();
    profilePhotoHint.textContent='동행 신청 시 다른 회원에게 보여지는 사진이에요';
    showToast('프로필 사진을 변경했어요');
  }catch(err){profilePhotoHint.textContent=err.message}
  profilePhotoInput.value='';
};

/* ── 본인 인증 (신분증 업로드) ────────────────────────────── */
const identitySection=document.querySelector('#identitySection');

function renderIdentitySection(latest){
  if(currentUser.verified?.identity){
    identitySection.innerHTML='<p class="member-hint">✓ 본인 인증이 완료됐어요.</p>';
    return;
  }
  if(latest&&latest.status==='pending'){
    identitySection.innerHTML=`<p class="member-hint">신분증 심사가 진행 중이에요. 결과가 나오면 안내드릴게요. (${new Date(latest.created_at).toLocaleString('ko-KR')} 접수)</p>`;
    return;
  }
  const rejectedNote=latest&&latest.status==='rejected'
    ?`<p class="member-hint">지난 신청이 반려됐어요.${latest.admin_note?` (사유: ${esc(latest.admin_note)})`:''} 다시 올려주세요.</p>`:'';
  identitySection.innerHTML=`
    ${rejectedNote}
    <p class="member-hint">주민등록증/운전면허증 등 신분증 사진을 올려주세요. 본인 확인 목적으로만 사용되며 관리자만 열람할 수 있어요.</p>
    <button type="button" class="ghost small" id="identityUploadBtn">신분증 업로드</button>
    <input type="file" id="identityUploadInput" class="hidden" accept="image/jpeg,image/png,image/webp">
    <p class="auth-error" id="identityError"></p>`;
  document.querySelector('#identityUploadBtn').onclick=()=>document.querySelector('#identityUploadInput').click();
  document.querySelector('#identityUploadInput').onchange=async()=>{
    const input=document.querySelector('#identityUploadInput');
    const errorEl=document.querySelector('#identityError');
    const file=input.files[0];
    if(!file) return;
    if(file.size>8*1024*1024){errorEl.textContent='사진은 8MB 이하만 올릴 수 있어요';input.value='';return}
    const fd=new FormData();
    fd.append('document',file);
    try{
      await api('/api/identity',{method:'POST',body:fd});
      showToast('신분증을 제출했어요. 확인 후 안내드릴게요');
      loadIdentitySection();
    }catch(err){errorEl.textContent=err.message}
  };
}

async function loadIdentitySection(){
  identitySection.innerHTML='<p class="member-hint">불러오는 중...</p>';
  try{
    const list=await api('/api/identity/me');
    renderIdentitySection(list[0]);
  }catch(err){identitySection.innerHTML=`<p class="member-hint">${esc(err.message)}</p>`}
}

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

/* ── 고객센터 (클레임/환불/신고/기타 문의) ───────────────── */
const supportDialog=document.querySelector('#supportDialog'),supportForm=document.querySelector('#supportForm');
const supportError=document.querySelector('#supportError'),supportList=document.querySelector('#supportList');
const supportCategory=document.querySelector('#supportCategory');
const supportTargetField=document.querySelector('#supportTargetField'),supportTarget=document.querySelector('#supportTarget');
const supportChargeField=document.querySelector('#supportChargeField'),supportCharge=document.querySelector('#supportCharge');

const TICKET_CATEGORY_LABEL={complaint:'클레임/불만',refund:'환불 요청',report:'회원 신고',other:'기타 요청'};
const TICKET_STATUS_LABEL={pending:'접수됨',in_progress:'처리중',resolved:'처리완료',rejected:'반려됨'};

function updateSupportFields(){
  const cat=supportCategory.value;
  supportTargetField.classList.toggle('hidden',cat!=='report');
  supportChargeField.classList.toggle('hidden',cat!=='refund');
}
supportCategory.addEventListener('change',updateSupportFields);

function openSupport(){
  mobileMenu.classList.remove('show');authMenu.classList.remove('show');
  supportError.textContent='';supportForm.reset();
  updateSupportFields();
  supportDialog.showModal();
  loadSupportOptions();
  loadMyTickets();
}
supportBtn.onclick=openSupport;supportMobile.onclick=openSupport;

async function loadSupportOptions(){
  try{
    const members=await api('/api/tickets/target-members');
    supportTarget.innerHTML=members.length?members.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join(''):'<option value="">신고할 수 있는 회원이 없어요</option>';
  }catch{supportTarget.innerHTML='<option value="">불러오지 못했어요</option>'}
  try{
    const charges=await api('/api/coins/charge-requests/me');
    supportCharge.innerHTML='<option value="">선택 안 함</option>'+charges.map(c=>`<option value="${c.id}">${new Date(c.created_at).toLocaleDateString('ko-KR')} · ${c.amount_krw.toLocaleString()}원 (${c.coins.toLocaleString()}코인)</option>`).join('');
  }catch{}
}

async function loadMyTickets(){
  supportList.innerHTML='<p class="request-empty">불러오는 중...</p>';
  try{
    const list=await api('/api/tickets/me');
    supportList.innerHTML=list.length?list.map(t=>`
      <div class="request-card">
        <h4>${esc(TICKET_CATEGORY_LABEL[t.category]||t.category)} · ${esc(t.subject)}<span class="req-status ${t.status}">${TICKET_STATUS_LABEL[t.status]}</span></h4>
        <p>${esc(t.body)}</p>
        ${t.target_name?`<p>신고 대상: ${esc(t.target_name)}</p>`:''}
        ${t.refund_coins?`<p>환불된 코인: ${t.refund_coins.toLocaleString()}코인</p>`:''}
        ${t.admin_note?`<p>운영진 메모: ${esc(t.admin_note)}</p>`:''}
        <div class="req-meta">${new Date(t.created_at).toLocaleString('ko-KR')}</div>
      </div>`).join(''):'<p class="request-empty">아직 접수한 문의가 없어요</p>';
  }catch(err){supportList.innerHTML=`<p class="request-empty">${esc(err.message)}</p>`}
}

supportForm.onsubmit=async e=>{
  e.preventDefault();
  const category=supportCategory.value;
  const subject=document.querySelector('#supportSubject').value.trim();
  const body=document.querySelector('#supportBody').value.trim();
  if(!subject||!body){supportError.textContent='제목과 내용을 입력해주세요';return}
  const payload={category,subject,body};
  if(category==='report')payload.targetUserId=Number(supportTarget.value);
  if(category==='refund'&&supportCharge.value)payload.coinChargeId=Number(supportCharge.value);
  try{
    await api('/api/tickets',{method:'POST',body:payload});
    supportForm.reset();
    updateSupportFields();
    showToast('문의가 접수됐어요. 처리 결과를 안내드릴게요');
    loadMyTickets();
  }catch(err){supportError.textContent=err.message}
};

/* ── 쪽지 (채팅) ───────────────────────────────────────── */
const messagesDialog=document.querySelector('#messagesDialog');
const conversationList=document.querySelector('#conversationList');
const newChatDialog=document.querySelector('#newChatDialog'),newChatMembers=document.querySelector('#newChatMembers');
const chatDialog=document.querySelector('#chatDialog'),chatThread=document.querySelector('#chatThread');
const chatForm=document.querySelector('#chatForm'),chatInput=document.querySelector('#chatInput'),chatError=document.querySelector('#chatError');
const chatPartnerName=document.querySelector('#chatPartnerName');
const chatFileInput=document.querySelector('#chatFileInput'),chatAttachHint=document.querySelector('#chatAttachHint');
const emojiBtn=document.querySelector('#emojiBtn'),emojiPopover=document.querySelector('#emojiPopover');
const chatCharCount=document.querySelector('#chatCharCount');
const MAX_MESSAGE_LENGTH=200;
chatInput.addEventListener('input',()=>{chatCharCount.textContent=`${chatInput.value.length}/${MAX_MESSAGE_LENGTH}`});

let currentChatPartnerId=null;
let pendingAttachment=null;

function openMessages(){
  mobileMenu.classList.remove('show');authMenu.classList.remove('show');
  messagesDialog.showModal();
  loadConversations();
}
messagesBtn.onclick=openMessages;messagesMobile.onclick=openMessages;

function fmtChatDate(dt){return new Date(dt.replace(' ','T')+'Z').toLocaleString('ko-KR')}
function fmtConvDate(dt){return dt?new Date(dt.replace(' ','T')+'Z').toLocaleDateString('ko-KR'):''}

async function loadConversations(){
  conversationList.innerHTML='<p class="request-empty">불러오는 중...</p>';
  try{
    const list=await api('/api/messages/conversations');
    conversationList.innerHTML=list.length?list.map(c=>`
      <button type="button" class="conversation-card" data-user-id="${c.userId}">
        ${avatarHtml(c.photoUrl,c.name,40)}
        <div class="conv-main">
          <h4>${esc(c.name)}</h4>
          <p>${c.lastMine?'나: ':''}${esc(c.lastPreview)}</p>
        </div>
        <span class="conv-time">${fmtConvDate(c.lastAt)}</span>
        ${c.unread?`<span class="unread-count">${c.unread>99?'99+':c.unread}</span>`:''}
      </button>`).join(''):'<p class="request-empty">아직 대화가 없어요. "새 대화 시작"을 눌러보세요</p>';
  }catch(err){conversationList.innerHTML=`<p class="request-empty">${esc(err.message)}</p>`}
}

conversationList.addEventListener('click',e=>{
  const card=e.target.closest('.conversation-card');
  if(!card) return;
  openChat(Number(card.dataset.userId),card.querySelector('h4').textContent);
});

document.querySelector('#newChatBtn').onclick=async()=>{
  messagesDialog.close();
  newChatMembers.innerHTML='<p class="request-empty">불러오는 중...</p>';
  newChatDialog.showModal();
  try{
    const members=await api('/api/messages/members');
    newChatMembers.innerHTML=members.length?members.map(m=>`
      <button type="button" class="conversation-card" data-user-id="${m.id}" data-name="${esc(m.name)}">
        ${avatarHtml(m.photo_url,m.name,40)}
        <div class="conv-main"><h4>${esc(m.name)}</h4><p>${esc([m.age_group,m.region,m.interest].filter(Boolean).join(' · ')||'프로필 미등록')}</p></div>
      </button>`).join(''):'<p class="request-empty">대화할 수 있는 회원이 없어요</p>';
  }catch(err){newChatMembers.innerHTML=`<p class="request-empty">${esc(err.message)}</p>`}
};

newChatMembers.addEventListener('click',e=>{
  const card=e.target.closest('.conversation-card');
  if(!card) return;
  newChatDialog.close();
  openChat(Number(card.dataset.userId),card.dataset.name);
});

function renderAttachment(m){
  if(m.attachment_type==='image') return `<a href="${m.attachment_url}" target="_blank" rel="noopener"><img src="${m.attachment_url}" alt="사진"></a>`;
  if(m.attachment_type==='file') return `<a class="chat-file-link" href="${m.attachment_url}" target="_blank" rel="noopener">📎 ${esc(m.attachment_name||'파일')}</a>`;
  if(m.attachment_type==='call') return `<button type="button" class="chat-call-link" data-room-url="${esc(m.attachment_url)}" data-call-type="${m.attachment_name}">${m.attachment_name==='video'?'🎥':'🎙'} 통화 참여하기</button>`;
  return '';
}

let lastThreadMessageId=-1;

async function openChat(userId,name){
  currentChatPartnerId=userId;
  chatPartnerName.textContent=name;
  chatError.textContent='';
  chatInput.value='';chatCharCount.textContent=`0/${MAX_MESSAGE_LENGTH}`;pendingAttachment=null;chatAttachHint.textContent='';chatFileInput.value='';
  emojiPopover.classList.add('hidden');
  chatThread.innerHTML='<p class="request-empty">불러오는 중...</p>';
  lastThreadMessageId=-1;
  chatDialog.showModal();
  await loadChatThread();
}

async function loadChatThread(force){
  try{
    const {messages}=await api(`/api/messages/conversations/${currentChatPartnerId}`);
    const newestId=messages.length?messages[messages.length-1].id:0;
    if(!force && newestId===lastThreadMessageId) { refreshUnreadBadge(); return }
    lastThreadMessageId=newestId;
    chatThread.innerHTML=messages.length?messages.map(m=>{
      const mine=m.sender_id!==currentChatPartnerId;
      return `<div class="chat-bubble ${mine?'mine':'theirs'}">
        ${m.body?esc(m.body):''}
        ${renderAttachment(m)}
        <span class="chat-time">${fmtChatDate(m.created_at)}</span>
      </div>`;
    }).join(''):'<p class="request-empty">아직 대화가 없어요. 첫 메시지를 보내보세요</p>';
    chatThread.scrollTop=chatThread.scrollHeight;
    refreshUnreadBadge();
  }catch(err){chatThread.innerHTML=`<p class="request-empty">${esc(err.message)}</p>`}
}

// 대화창을 열어둔 동안, 상대가 보낸 새 메시지가 직접 보내지 않아도 자동으로 보이도록 주기적으로 갱신.
setInterval(()=>{
  if(chatDialog.open && currentChatPartnerId) loadChatThread();
},4000);

document.querySelector('#chatBackBtn').onclick=()=>{chatDialog.close();openMessages()};

chatForm.onsubmit=async e=>{
  e.preventDefault();
  const body=chatInput.value.trim();
  if(!body&&!pendingAttachment){chatError.textContent='메시지를 입력하거나 파일을 첨부해주세요';return}
  if(body.length>MAX_MESSAGE_LENGTH){chatError.textContent=`메시지는 ${MAX_MESSAGE_LENGTH}자 이하로 입력해주세요`;return}
  chatError.textContent='';
  try{
    let res;
    if(pendingAttachment){
      const fd=new FormData();
      fd.append('recipientUserId',currentChatPartnerId);
      fd.append('body',body);
      fd.append('file',pendingAttachment);
      res=await api('/api/messages',{method:'POST',body:fd});
    }else{
      res=await api('/api/messages',{method:'POST',body:{recipientUserId:currentChatPartnerId,body}});
    }
    chatInput.value='';chatCharCount.textContent=`0/${MAX_MESSAGE_LENGTH}`;pendingAttachment=null;chatAttachHint.textContent='';chatFileInput.value='';
    refreshCoinBadge();
    await loadChatThread(true);
  }catch(err){chatError.textContent=err.message}
};

document.querySelector('#attachBtn').onclick=()=>chatFileInput.click();
chatFileInput.onchange=()=>{
  const file=chatFileInput.files[0];
  if(!file) return;
  if(file.size>15*1024*1024){chatError.textContent='파일은 15MB 이하만 첨부할 수 있어요';chatFileInput.value='';return}
  pendingAttachment=file;
  chatAttachHint.textContent=`첨부됨: ${file.name}`;
};

/* ── 보이스톡/페이스톡 (초당 과금, 화면 내 통화) ─────────── */
const callDialog=document.querySelector('#callDialog'),callFrameContainer=document.querySelector('#callFrameContainer');
const callPartnerName=document.querySelector('#callPartnerName'),callCostHint=document.querySelector('#callCostHint'),callError=document.querySelector('#callError');
const CALL_COST_PER_SEC={voice:10,video:100};
let dailyCallFrame=null,callTickTimer=null,activeCallType=null;

async function canEnterCall(){
  try{
    const info=await api('/api/calls/can-enter');
    if(!info.allowed){
      showToast(`코인이 ${info.entryMin.toLocaleString()}개 이하면 통화를 시작할 수 없어요. 충전 후 다시 시도해주세요`);
      openCoins();
      return false;
    }
    return true;
  }catch(err){showToast(err.message);return false}
}

async function joinCall(roomUrl,callType,partnerName){
  if(!(await canEnterCall())) return;
  if(!window.DailyIframe){showToast('통화 모듈을 불러오지 못했어요. 새로고침 후 다시 시도해주세요');return}
  activeCallType=callType;
  callError.textContent='';
  callPartnerName.textContent=`${partnerName||chatPartnerName.textContent} — ${callType==='video'?'페이스톡':'보이스톡'}`;
  callCostHint.textContent=`초당 ${CALL_COST_PER_SEC[callType]}코인 사용 중`;
  callFrameContainer.innerHTML='';
  callDialog.showModal();
  try{
    dailyCallFrame=window.DailyIframe.createFrame(callFrameContainer,{iframeStyle:{width:'100%',height:'100%',border:'0'}});
    dailyCallFrame.on('left-meeting',()=>endCall(false));
    // 상대방이 통화를 끊어 방에 나(local) 혼자 남으면, 내 쪽도 자동으로 통화를 종료한다.
    dailyCallFrame.on('participant-left',()=>{
      if(!callTickTimer) return;
      const remaining=Object.keys(dailyCallFrame.participants()).filter(id=>id!=='local');
      if(remaining.length===0){
        showToast('상대방이 통화를 종료했어요');
        endCall(true);
      }
    });
    const joinTimeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error('통화 연결이 지연되고 있어요. 네트워크 상태를 확인하고 다시 시도해주세요')),20000));
    await Promise.race([dailyCallFrame.join({url:roomUrl}),joinTimeout]);
    startCallBilling();
  }catch(err){
    showToast(err.message||'통화방에 접속하지 못했어요');
    endCall(false);
  }
}

function startCallBilling(){
  clearInterval(callTickTimer);
  callTickTimer=setInterval(async()=>{
    try{
      const res=await api('/api/calls/tick',{method:'POST',body:{callType:activeCallType}});
      refreshCoinBadge();
      if(res.shouldEnd){
        showToast(`코인이 ${res.continueMin.toLocaleString()}개 이하로 떨어져 통화를 종료해요. 충전 후 다시 이용해주세요`);
        endCall(true);
        openCoins();
      }
    }catch(err){
      showToast(err.message||'코인이 부족해 통화를 종료해요');
      endCall(true);
      openCoins();
    }
  },1000);
}

function endCall(leaveFrame){
  clearInterval(callTickTimer);callTickTimer=null;
  if(leaveFrame&&dailyCallFrame){try{dailyCallFrame.leave()}catch{}}
  if(dailyCallFrame){try{dailyCallFrame.destroy()}catch{}dailyCallFrame=null}
  callDialog.close();
}

chatThread.addEventListener('click',e=>{
  const btn=e.target.closest('.chat-call-link');
  if(!btn) return;
  joinCall(btn.dataset.roomUrl,btn.dataset.callType,chatPartnerName.textContent);
});

// X 버튼/Esc 등 어떤 방식으로 통화창이 닫혀도 과금 타이머와 통화 세션이 함께 정리되도록.
callDialog.addEventListener('close',()=>{ if(callTickTimer) endCall(true) });

['voiceCallBtn','videoCallBtn'].forEach(id=>{
  document.querySelector(`#${id}`).onclick=async()=>{
    const callType=id==='voiceCallBtn'?'voice':'video';
    chatError.textContent='';
    if(!(await canEnterCall())) return;
    try{
      const fd=new FormData();
      fd.append('recipientUserId',currentChatPartnerId);
      fd.append('kind','call');
      fd.append('callType',callType);
      const res=await api('/api/messages',{method:'POST',body:fd});
      await loadChatThread(true);
      if(res.attachmentUrl) joinCall(res.attachmentUrl,callType,chatPartnerName.textContent);
    }catch(err){chatError.textContent=err.message}
  };
});

/* 이모티콘 (감정 표현 위주) */
const EMOJI_LIST=['😀','😂','🥰','😍','😘','😊','🙂','😉','😎','🤔','😐','😑','😒','🙄','😢','😭','😡','😱','😴','🥳','👍','👎','❤️','💔','🙏','👏','🎉','💪','😅','🤗'];
emojiPopover.innerHTML=EMOJI_LIST.map(em=>`<button type="button">${em}</button>`).join('');
emojiBtn.onclick=()=>emojiPopover.classList.toggle('hidden');
emojiPopover.addEventListener('click',e=>{
  const btn=e.target.closest('button');
  if(!btn) return;
  chatInput.value=(chatInput.value+btn.textContent).slice(0,MAX_MESSAGE_LENGTH);
  chatCharCount.textContent=`${chatInput.value.length}/${MAX_MESSAGE_LENGTH}`;
  chatInput.focus();
});
document.addEventListener('click',e=>{
  if(!emojiPopover.classList.contains('hidden')&&!emojiPopover.contains(e.target)&&e.target!==emojiBtn){
    emojiPopover.classList.add('hidden');
  }
});

/* ── 새 쪽지 알림 (폴링 + 소리 + 읽지 않은 개수) ──────────── */
let lastUnreadCount=0;
let messageBaselineReady=false;

function setUnreadBadge(count){
  authBtn.dataset.unread=String(count);
  const label=count>0?`쪽지함 (${count})`:'쪽지함';
  messagesBtn.textContent=label;
  messagesMobile.textContent=label;
}

async function refreshUnreadBadge(){
  try{
    const {count}=await api('/api/messages/unread-count');
    lastUnreadCount=count;
    setUnreadBadge(count);
  }catch{}
}

async function establishMessageBaseline(){
  messageBaselineReady=false;
  await refreshUnreadBadge();
  messageBaselineReady=true;
}

function playAlertSound(){
  try{
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(!AudioCtx) return;
    const ctx=new AudioCtx();
    const chime=(freq,start,dur)=>{
      const o=ctx.createOscillator(),g=ctx.createGain();
      o.type='sine';o.frequency.value=freq;
      g.gain.value=0.0001;
      o.connect(g);g.connect(ctx.destination);
      const t=ctx.currentTime+start;
      g.gain.exponentialRampToValueAtTime(0.16,t+0.01);
      g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
      o.start(t);o.stop(t+dur+0.02);
    };
    chime(880,0,0.32);
    chime(1175,0.16,0.35);
    setTimeout(()=>ctx.close().catch(()=>{}),800);
  }catch{}
}

async function pollNewMessages(){
  if(!currentUser||!messageBaselineReady) return;
  try{
    const {count}=await api('/api/messages/unread-count');
    if(count>lastUnreadCount){
      playAlertSound();
      showToast('✉ 새 쪽지가 도착했어요');
    }
    lastUnreadCount=count;
    setUnreadBadge(count);
  }catch{}
}
setInterval(pollNewMessages,15000);
