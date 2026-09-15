const hamburger=document.querySelector('#hamburger'),mobileMenu=document.querySelector('#mobileMenu');
hamburger.onclick=()=>mobileMenu.classList.toggle('show');
document.addEventListener('click',e=>{
  const btn=e.target.closest('[data-scroll]');
  if(btn){document.getElementById(btn.dataset.scroll).scrollIntoView({behavior:'smooth'});mobileMenu.classList.remove('show')}
  if(e.target.classList.contains('join')){
    const name=e.target.dataset.name;
    showToast(`${name} 문의가 접수되었어요. 담당자가 곧 연락드립니다.`);
    e.target.textContent='문의 접수됨 ✓';
    e.target.disabled=true;
  }
});

document.querySelector('#moreGolf').onclick=()=>showToast('이번 시즌 골프 모임 일정 6건을 모두 불러왔어요');
document.querySelector('#moreTravel').onclick=()=>showToast('이번 시즌 여행 프로그램 5건을 모두 불러왔어요');

const applyDialog=document.querySelector('#applyDialog'),doneDialog=document.querySelector('#doneDialog');
const applyForm=document.querySelector('#applyForm'),applyError=document.querySelector('#applyError');

function openApply(){applyError.textContent='';applyForm.reset();applyDialog.showModal()}
['#applyTop','#applyHero','#applyBottom','#applyMobile'].forEach(sel=>{
  document.querySelector(sel).onclick=()=>{mobileMenu.classList.remove('show');openApply()};
});

document.querySelectorAll('.dialog-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());

applyForm.onsubmit=e=>{
  e.preventDefault();
  const name=document.querySelector('#applyName').value.trim();
  const phone=document.querySelector('#applyPhone').value.trim();
  const interest=document.querySelector('#applyInterest').value;
  if(!name||!phone){applyError.textContent='성함과 연락처를 입력해주세요';return}
  applyDialog.close();
  document.querySelector('#doneText').textContent=`${name}님, ${interest} 분야 지원서가 접수되었습니다. 영업일 기준 3일 이내 연락드릴게요.`;
  doneDialog.showModal();
};

document.querySelector('#doneClose').onclick=()=>doneDialog.close();

let timer;
function showToast(msg){
  const t=document.querySelector('#toast');
  t.textContent=msg;
  t.classList.add('show');
  clearTimeout(timer);
  timer=setTimeout(()=>t.classList.remove('show'),2600);
}

// 회원가입 / 로그인
const USERS_KEY='fc_users',SESSION_KEY='fc_session';
const ADMIN_EMAIL='admin@forestclub.kr',ADMIN_PASSWORD='admin1234!';
function getUsers(){try{return JSON.parse(localStorage.getItem(USERS_KEY))||[]}catch{return[]}}
function saveUsers(list){localStorage.setItem(USERS_KEY,JSON.stringify(list))}
function getSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY))}catch{return null}}
function setSession(user){user?localStorage.setItem(SESSION_KEY,JSON.stringify(user)):localStorage.removeItem(SESSION_KEY)}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function ensureAdminSeed(){const users=getUsers();if(!users.some(u=>u.role==='admin')){users.push({name:'관리자',email:ADMIN_EMAIL,password:ADMIN_PASSWORD,role:'admin'});saveUsers(users)}}
ensureAdminSeed();

const authBtn=document.querySelector('#authBtn'),authMobile=document.querySelector('#authMobile');
const authMenu=document.querySelector('#authMenu'),authDialog=document.querySelector('#authDialog');
const loginForm=document.querySelector('#loginForm'),signupForm=document.querySelector('#signupForm');
const loginError=document.querySelector('#loginError'),signupError=document.querySelector('#signupError');
const adminBtn=document.querySelector('#adminBtn'),adminMobile=document.querySelector('#adminMobile');
const logoutBtn=document.querySelector('#logoutBtn'),logoutMobile=document.querySelector('#logoutMobile');
const adminDialog=document.querySelector('#adminDialog');

function renderAuth(){
  const user=getSession();
  if(user){
    authBtn.textContent=user.name;authBtn.dataset.state='in';
    adminBtn.classList.toggle('hidden',user.role!=='admin');
    authMobile.classList.add('hidden');
    logoutMobile.classList.remove('hidden');
    adminMobile.classList.toggle('hidden',user.role!=='admin');
  }else{
    authBtn.textContent='로그인';authBtn.dataset.state='out';
    authMobile.classList.remove('hidden');authMobile.textContent='로그인';
    logoutMobile.classList.add('hidden');
    adminMobile.classList.add('hidden');
  }
}
renderAuth();

function openAuthDialog(){loginError.textContent='';signupError.textContent='';loginForm.reset();signupForm.reset();mobileMenu.classList.remove('show');authDialog.showModal()}
authBtn.onclick=()=>{if(authBtn.dataset.state==='in'){authMenu.classList.toggle('show')}else{openAuthDialog()}};
authMobile.onclick=openAuthDialog;

document.querySelectorAll('.auth-tab').forEach(t=>t.onclick=()=>{document.querySelectorAll('.auth-tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');const isLogin=t.dataset.tab==='login';loginForm.classList.toggle('hidden',!isLogin);signupForm.classList.toggle('hidden',isLogin)});

signupForm.onsubmit=e=>{e.preventDefault();const name=document.querySelector('#signupName').value.trim();const email=document.querySelector('#signupEmail').value.trim().toLowerCase();const password=document.querySelector('#signupPassword').value;if(!name||!email||password.length<8){signupError.textContent='이름, 이메일, 8자 이상 비밀번호를 확인해주세요';return}const users=getUsers();if(users.some(u=>u.email===email)){signupError.textContent='이미 가입된 이메일이에요';return}users.push({name,email,password});saveUsers(users);setSession({name,email});authDialog.close();renderAuth();showToast(`${name}님, 포레스트클럽 가입을 환영합니다`)};

loginForm.onsubmit=e=>{e.preventDefault();const email=document.querySelector('#loginEmail').value.trim().toLowerCase();const password=document.querySelector('#loginPassword').value;const user=getUsers().find(u=>u.email===email&&u.password===password);if(!user){loginError.textContent='이메일 또는 비밀번호가 올바르지 않아요';return}setSession({name:user.name,email:user.email,role:user.role});authDialog.close();renderAuth();showToast(`${user.name}님, 환영합니다`)};

function logout(){setSession(null);authMenu.classList.remove('show');mobileMenu.classList.remove('show');renderAuth();showToast('로그아웃 되었어요')}
logoutBtn.onclick=logout;logoutMobile.onclick=logout;

function openAdmin(){authMenu.classList.remove('show');mobileMenu.classList.remove('show');const users=getUsers().filter(u=>u.role!=='admin');document.querySelector('#adminCount').textContent=`전체 회원 ${users.length}명`;document.querySelector('#adminUserList').innerHTML=users.length?users.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td></tr>`).join(''):'<tr><td colspan="2">가입한 회원이 없어요</td></tr>';adminDialog.showModal()}
adminBtn.onclick=openAdmin;adminMobile.onclick=openAdmin;

document.addEventListener('click',e=>{if(authMenu.classList.contains('show')&&!authMenu.contains(e.target)&&e.target!==authBtn)authMenu.classList.remove('show')});
