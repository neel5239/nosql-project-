/* ================= ANUMAAN — UI =================
   All data comes from the server (MongoDB). The browser stores nothing:
   no localStorage, no sessionStorage — the session is an httpOnly cookie. */
const ENG=window.ANUMAAN_ENGINE;
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const pc=x=>Math.round(x*100)+'%';
const ABCD='ABCD';
const topicName=id=>ENG.TOPICS.find(t=>t.id===id).name;
/* every string that did not originate in our own static code is escaped:
   typed input, uploaded files, YouTube titles/channels */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
let E=null, BR=null, ME=null, ROLE=null;

/* ---------- action delegation (no inline handlers → strict CSP) ---------- */
const ACT={};
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-act],[data-sign-out],[data-close-modal],[data-theme-toggle]');
  if(!el) return;
  if(el.hasAttribute('data-sign-out')) return signOut();
  if(el.hasAttribute('data-close-modal')) return closeModal();
  if(el.hasAttribute('data-theme-toggle')) return toggleTheme();
  const fn=ACT[el.dataset.act];
  if(fn){e.preventDefault();fn(el.dataset.arg,el,e)}
});
document.addEventListener('keydown',e=>{
  const el=e.target;
  if((e.key==='Enter'||e.key===' ')&&el.matches&&el.matches('tr[data-act]')){e.preventDefault();el.click()}
});

/* ---------- theme: OS preference until signed in, then the user's saved choice (MongoDB) ---------- */
const sysDark=matchMedia('(prefers-color-scheme: dark)');
/* pref is 'light' | 'dark' | 'system'; the page always shows a resolved light or dark */
let THEME_PREF='system';
function applyTheme(pref){
  THEME_PREF=pref||'system';
  const t=THEME_PREF==='system'?(sysDark.matches?'dark':'light'):THEME_PREF;
  document.documentElement.dataset.theme=t;
  $$('[data-theme-toggle]').forEach(b=>{
    if(b.classList.contains('side-link')) return;
    b.innerHTML=IC(t==='dark'?'sun':'moon');
    b.setAttribute('aria-label',t==='dark'?'Switch to light theme':'Switch to dark theme');
  });
  const ic=$('#themeIc'), lb=$('#themeLbl');
  if(ic){ ic.innerHTML=IC(t==='dark'?'sun':'moon'); lb.textContent=t==='dark'?'Light theme':'Dark theme' }
}
sysDark.addEventListener?.('change',()=>{ if(THEME_PREF==='system') applyTheme('system') });
async function toggleTheme(){
  const t=document.documentElement.dataset.theme==='dark'?'light':'dark';
  applyTheme(t);
  if(ME){ try{ await API.patch('/api/me/prefs',{theme:t}); ME.prefs.theme=t; if(VIEW==='settings') renderSettings() }catch(e){ toast(esc(e.message)) } }
}
applyTheme('system');

/* ---------- toast + loading ---------- */
let toastT;
function toast(msg){const t=$('#toast');t.innerHTML=msg;t.classList.add('on');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('on'),3600)}
function loading(on){$('#loading').hidden=!on}
function failBox(pane,err){
  $('#pane-'+pane).innerHTML=`<div class="card empty-state">${IC('alert')}<h2>Could not load this view</h2><p>${esc(err.message)}</p>
    <button type="button" class="btn p" data-act="reload">Try again</button></div>`;
}
ACT.reload=()=>show();

/* ================= LOGIN ================= */
const ROOT_DOMAIN='allen.edu.in';
const BRANCH_DOMAINS={kota:'Kota — Centre 3',jaipur:'Jaipur — Malviya',patna:'Patna — Boring Rd',nagpur:'Nagpur — Dharampeth',indore:'Indore — Vijay Nagar'};
const ROLE_LABEL={student:'Student portal',teacher:'Teacher console',branch:'Branch dashboard',company:'Company console'};
const EMAIL_RE=/^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,120}$/;
/* client-side hint only — the server repeats this check and owns the decision */
function routeFor(email){
  email=(email||'').trim().toLowerCase();
  if(!EMAIL_RE.test(email)) return {err:'Enter a full institute e-mail address, e.g. name@student.allen.edu.in.'};
  const dom=email.slice(email.lastIndexOf('@')+1);
  if(dom!==ROOT_DOMAIN&&!dom.endsWith('.'+ROOT_DOMAIN)) return {err:`“${dom}” is not registered to any institute on Anumaan.`};
  if(dom==='student.'+ROOT_DOMAIN) return {role:'student'};
  if(dom==='faculty.'+ROOT_DOMAIN) return {role:'teacher'};
  if(dom===ROOT_DOMAIN) return {role:'company'};
  const sub=dom.slice(0,dom.length-ROOT_DOMAIN.length-1);
  if(Object.hasOwn(BRANCH_DOMAINS,sub)) return {role:'branch',branch:BRANCH_DOMAINS[sub]};
  return {err:`“${sub}” is not a registered branch domain for this institute.`};
}
const DEMO_ACCOUNTS=[
  {ic:'student',name:'Aarav Sharma',email:'aarav.sharma@student.'+ROOT_DOMAIN,role:'student'},
  {ic:'teacher',name:'R. Menon',email:'r.menon@faculty.'+ROOT_DOMAIN,role:'teacher'},
  {ic:'branch',name:'Branch Head · Kota',email:'head@kota.'+ROOT_DOMAIN,role:'branch'},
  {ic:'company',name:'Company Admin',email:'admin@'+ROOT_DOMAIN,role:'company'}
];
(function initLogin(){
  $('#lgAccList').innerHTML=DEMO_ACCOUNTS.map((a,i)=>`
    <div role="listitem"><button type="button" class="acc" data-act="pickAcc" data-arg="${i}" data-role="${a.role}" aria-label="Sign in as ${a.name}, ${ROLE_LABEL[a.role]}">
      <span class="acc-ic">${IC(a.ic)}</span>
      <span class="acc-txt"><span class="nm">${a.name}</span><span class="em">${a.email}</span></span>
      <span class="acc-role">${ROLE_LABEL[a.role].split(' ')[0]}</span>
    </button></div>`).join('');
  $('#lgEmail').addEventListener('input',previewRoute);
  $('#lgForm').addEventListener('submit',e=>{e.preventDefault();doLogin()});
  $('#lgEye').addEventListener('click',()=>{
    const p=$('#lgPass'),show=p.type==='password';
    p.type=show?'text':'password';
    $('#lgEye').setAttribute('aria-pressed',show);
    $('#lgEye').setAttribute('aria-label',show?'Hide password':'Show password');
  });
})();
ACT.pickAcc=i=>{
  const a=DEMO_ACCOUNTS[+i]; if(!a) return;
  $('#lgEmail').value=a.email; $('#lgPass').value='anumaan';
  previewRoute(); doLogin();
};
function previewRoute(){
  const v=$('#lgEmail').value.trim(), rt=$('#lgRoute');
  $('#lgErr').className='err'; $('#lgErr').textContent=''; $('#lgEmail').removeAttribute('aria-invalid');
  const r=v?routeFor(v):{err:1};
  if(r.err){rt.className='route';rt.textContent='';return}
  rt.className='route on';
  rt.textContent=`✓ Domain recognised — routes to ${ROLE_LABEL[r.role]}${r.branch?' · '+r.branch:''}`;
}
function fail(msg,field){
  $('#lgRoute').className='route'; $('#lgRoute').textContent='';
  const err=$('#lgErr'); err.className='err on'; err.textContent=msg;
  if(field){const f=$(field); f.setAttribute('aria-invalid','true'); f.focus()}
}
let busy=false;
async function doLogin(){
  if(busy) return;
  const email=$('#lgEmail').value.trim().toLowerCase(), password=$('#lgPass').value;
  const r=routeFor(email);
  if(r.err) return fail(r.err,'#lgEmail');
  if(!password) return fail('Enter your password.','#lgPass');
  busy=true; const b=$('#lgBtn'); b.disabled=true; b.innerHTML='<span class="spin" aria-hidden="true"></span>Signing in…';
  try{
    await API.post('/api/auth/login',{email,password});
    $('#lgPass').value='';
    await boot(true);
  }catch(e){
    fail(e.message, e.status===401&&/password/i.test(e.message)?'#lgPass':'#lgEmail');
  }finally{ busy=false; b.disabled=false; b.textContent='Sign in' }
}
async function signOut(){
  try{ await API.post('/api/auth/logout') }catch(e){}
  ME=null; E=null; BR=null; ROLE=null; REP_EXAM=null; T_EXAM=null; SV_EXAM=null; SURVEY=null; RECO=null; SVIEW='report'; VIEW='dash'; PROFILE=null; NOTIF={items:[],unread:0,pending:0}; paintBell();
  document.documentElement.classList.remove('rm'); closeSide();
  clearInterval(liveTimer);
  $('#appShell').classList.remove('on'); $('#loginScreen').classList.add('on');
  document.title='Sign in — ANUMAAN';
  applyTheme('system');
  previewRoute(); $('#lgEmail').focus();
  toast('Signed out.');
}

/* ---------- boot: is there a valid session cookie? ---------- */
async function boot(focus){
  try{
    const {user}=await API.get('/api/session');
    if(!user){ $('#loginScreen').classList.add('on'); $('#appShell').classList.remove('on'); return }
    ME=user; ROLE=user.role; VIEW='dash'; applyTheme(user.prefs?.theme||user.theme);
    applyPrefs();
    $('#loginScreen').classList.remove('on'); $('#appShell').classList.add('on');
    $('#abContext').textContent=user.scope;
    renderSide();
    document.title=`${ROLE_LABEL[ROLE]} — ANUMAAN`;
    window.scrollTo(0,0);
    await show();
    if(focus) $('#appMain').focus({preventScroll:true});
  }catch(e){
    $('#loginScreen').classList.add('on'); $('#appShell').classList.remove('on');
    if(e.status && e.status!==401) fail(e.message);
  }
}

/* ---------- modal ---------- */
let modalOpener=null;
function openModal(title,sub,html){
  modalOpener=document.activeElement;
  $('#modalBody').innerHTML=`<h3 id="modalTitle">${title}</h3>${sub?`<div class="msub">${sub}</div>`:''}${html}`;
  const m=$('#modal'); m.hidden=false; m.classList.add('on');
  document.body.classList.add('modal-open'); $('.modal-in').scrollTop=0; $('.modal-x').focus();
}
function closeModal(){
  const m=$('#modal'); if(m.hidden) return;
  m.classList.remove('on'); m.hidden=true; document.body.classList.remove('modal-open');
  if(modalOpener&&document.contains(modalOpener)) modalOpener.focus();
}
$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});
document.addEventListener('keydown',e=>{
  const m=$('#modal'); if(m.hidden) return;
  if(e.key==='Escape'){e.preventDefault();closeModal();return}
  if(e.key==='Tab'){
    const f=$$('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',m).filter(x=>!x.disabled&&x.offsetParent!==null);
    if(!f.length) return;
    const first=f[0],last=f[f.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  }
});

/* ---------- role routing (role comes from the server session) ---------- */
const FELT=window.ANUMAAN_FELT;
async function show(){
  if(!ME) return;
  $$('.pane').forEach(p=>p.classList.remove('on'));
  renderSide();
  if(VIEW==='profile'||VIEW==='settings'){
    const pane=$('#pane-'+VIEW); pane.classList.add('on'); pane.innerHTML='';
    loading(true);
    try{ if(VIEW==='profile') await renderProfile(); else await renderSettings() }
    catch(e){ if(e.status===401) return signOut(); failBox(VIEW,e) }
    finally{ loading(false) }
    return;
  }
  const pane=$('#pane-'+ROLE); pane.classList.add('on'); pane.innerHTML='';
  loading(true);
  try{
    if(ROLE==='student') await loadStudent(REP_EXAM?.id);
    else if(ROLE==='teacher') await loadTeacher();
    else if(ROLE==='branch') BRANCH=await API.get('/api/branch/summary');
    else COMPANY=await API.get('/api/company/overview');
    ({student:renderStudent,teacher:renderTeacher,branch:renderBranch,company:renderCompany})[ROLE]();
  }catch(e){
    if(e.status===401) return signOut();
    failBox(ROLE,e);
  }finally{ loading(false) }
}

/* ================= helpers ================= */
function heatColor(a){
  // muted ramp — dark numbers stay ≥6.8:1 on every stop
  const stops=[[0,[226,138,141]],[.45,[235,163,110]],[.65,[231,196,106]],[.82,[169,211,174]],[1,[124,201,162]]];
  for(let i=0;i<stops.length-1;i++){
    const [p0,c0]=stops[i],[p1,c1]=stops[i+1];
    if(a>=p0&&a<=p1){const t=(a-p0)/(p1-p0);return `rgb(${c0.map((c,j)=>Math.round(c+(c1[j]-c)*t)).join(',')})`}
  }
  return 'rgb(124,201,162)';
}
const pill=id=>id==='—'?`<span class="pill bad">none</span>`:`<span class="pill ${id.toLowerCase()}">${id}</span>`;
const sdot=c=>`<span class="sdot ${c}" aria-hidden="true"></span>`;
const FELTFLAG={harder:`<span class="pill trap">${sdot('r')}felt harder</span>`,easier:`<span class="pill l2">${sdot('k')}felt easier</span>`,aligned:'<span class="pill ok">as rated</span>'};
const feltWord=v=>v==null?'—':ENG.RATING[Math.max(0,Math.min(3,Math.round(v)-1))];
const feltNum=v=>v==null?'—':v.toFixed(1);
const sgn=v=>(v>0?'+':'')+v.toFixed(1);
function csvCell(v){let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function downloadCSV(name,rows){
  const blob=new Blob(['﻿'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  toast(`${IC('download')} Downloaded <b>${esc(name)}</b>`);
}
const nS=()=>E.STUDENTS.length;
const fmtDate=d=>d?new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'';
const NOTE_FELT=`<div class="banner">${IC('alert')}<span><b>Comfort report.</b> Built from how hard each question <i>felt</i> to you — one tap per question — compared with your teacher's difficulty rating and your batch. It shows comfort, not marks.</span></div>`;

/* ================= STUDENT ================= */
let SVIEW='report', REPORT=null, REP_EXAM=null, REP_STATE=null, S_EXAMS=[], NOTIF={items:[],unread:0,pending:0}, SHOW_ALL={hb:false,ht:false};
async function loadStudent(examId){
  const [d,ex]=await Promise.all([API.get('/api/student/report'+(examId?`?exam=${encodeURIComponent(examId)}`:'')),API.get('/api/student/exams')]);
  S_EXAMS=ex.exams; REP_EXAM=d.exam; REPORT=d.rep||null; REP_STATE={locked:d.locked||null,waiting:d.waiting||null,batchSize:d.batchSize||0};
  E={STUDENT:d.student||{name:ME.name,roll:''}};
  await loadNotifs();
}
async function loadNotifs(){ try{ NOTIF=await API.get('/api/student/notifications') }catch(e){} paintBell() }
function paintBell(){
  if(ME&&$('#sideNav')?.innerHTML) renderSide();
  const b=$('#bell'); if(!b) return;
  b.hidden=ROLE!=='student';
  b.innerHTML=`${IC('bell')}${NOTIF.unread?`<span class="dotcount">${NOTIF.unread}</span>`:''}`;
  b.setAttribute('aria-label',`Notifications${NOTIF.unread?`, ${NOTIF.unread} unread`:''}`);
}
ACT.bell=async()=>{
  const items=NOTIF.items;
  openModal('Notifications','SURVEYS FROM YOUR TEACHER',items.length?items.map(n=>`
    <div class="notif ${n.readAt?'':'unread'}">
      <span class="notif-ic">${IC(n.doneAt?'checkCircle':n.surveyOpen?'clock':'lock')}</span>
      <span class="notif-t"><b>${esc(n.title)}</b><span class="muted small">${n.doneAt?`Rated ${fmtDate(n.doneAt)}`:n.surveyOpen?`New survey · ${+n.count} questions · one-time`:'Closed'}</span></span>
      ${!n.doneAt&&n.surveyOpen?`<button type="button" class="btn sm p" data-act="openSurvey" data-arg="${esc(n.examId)}">Rate now</button>`:''}
    </div>`).join(''):'<p class="empty">No notifications yet.</p>');
  if(NOTIF.unread){ try{ await API.post('/api/student/notifications/read'); NOTIF.unread=0; NOTIF.items.forEach(n=>n.readAt=n.readAt||new Date()); paintBell() }catch(e){} }
};
ACT.openSurvey=examId=>{ closeModal(); SVIEW='surveys'; SV_EXAM=examId; SURVEY=null; renderStudent() };

function renderStudent(){
  const p=$('#pane-student'), me=E.STUDENT, pend=NOTIF.pending;
  p.innerHTML=`
   <div class="h-row">
     <div><h1 class="h1">${{report:'My report',learn:'Courses for you',surveys:'Surveys',history:'History'}[SVIEW]}</h1><div class="sub">${esc(ME.name)}${me.roll?` · Roll ${esc(me.roll)}`:''} · you only ever see your own data.</div></div>
   </div>
   ${pend&&SVIEW!=='surveys'&&ME.prefs?.surveyBanner!==false?`<div class="banner hot">${IC('bell')}<span><b>${pend} new survey${pend===1?'':'s'}</b> from your teacher — one tap per question, one time only.</span><button type="button" class="btn sm p" data-act="sview" data-arg="surveys">Open</button></div>`:''}
   <div id="sBody" role="tabpanel"></div>`;
  ({report:renderStudentReport,learn:renderLearn,surveys:renderSurveys,history:renderHistory})[SVIEW]();
}
ACT.sview=v=>{ SVIEW=v; VIEW='dash'; if(v==='surveys'){SV_EXAM=null;SURVEY=null}
  if(!$('#pane-student').classList.contains('on')||!E?.STUDENT) return show();
  renderSide(); renderStudent(); $('#appMain').focus({preventScroll:true}) };
const examPicker=(cur,act)=>{
  const list=S_EXAMS.filter(x=>x.surveyed);
  return list.length>1?`<label class="picker"><span class="sr">Exam</span><select data-change="${act}">${list.map(x=>`<option value="${esc(x.id)}" ${x.id===cur?'selected':''}>${esc(x.title)} · ${fmtDate(x.examDate)}</option>`).join('')}</select></label>`:'';
};
document.addEventListener('change',async e=>{
  const s=e.target.closest('select[data-change]'); if(!s) return;
  if(s.dataset.change==='repExam'){ loading(true); try{ await loadStudent(s.value); RECO=null; renderStudent() }catch(err){ toast(esc(err.message)) } finally{ loading(false) } }
});
function lockedBox(){
  const st=REP_STATE||{};
  if(st.locked==='survey') return `<div class="card empty-state">${IC('lock')}<h2>Rate the paper first</h2><p>Your comfort report for ${esc(REP_EXAM.title)} is built from your own ratings, so it appears right after you submit.</p><button type="button" class="btn p" data-act="openSurvey" data-arg="${esc(REP_EXAM.id)}">Take the survey</button></div>`;
  if(st.locked==='missed') return `<div class="card empty-state">${IC('lock')}<h2>No report for this exam</h2><p>You did not rate ${esc(REP_EXAM.title)} before it closed, so there is nothing to compare.</p></div>`;
  if(st.waiting) return `<div class="card empty-state">${IC('clock')}<h2>Waiting for your batch</h2><p>${+st.waiting.have} of ${+st.waiting.need} classmates have rated this paper. Your comparison with the batch appears once ${+st.waiting.need} have.</p></div>`;
  return `<div class="card empty-state">${IC('clock')}<h2>No report yet</h2><p>Rate an exam to see your comfort report.</p></div>`;
}

/* ---- recommended courses (YouTube, cached in MongoDB) ---- */
let RECO=null;
const vidCard=v=>`<a class="vid" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">
      <span class="thumb">${v.thumb?`<img src="${esc(v.thumb)}" alt="" loading="lazy" width="320" height="180">`:IC('play')}${v.kind==='course'?`<span class="badge">${IC('book')} COURSE${v.lessons?` · ${esc(v.lessons)}`:''}</span>`:(v.length?`<span class="badge">${esc(v.length)}</span>`:'')}</span>
      <span class="vid-t">${esc(v.title)}</span><span class="vid-c">${esc(v.channel)}${v.views?` · ${esc(v.views)}`:''}</span><span class="sr"> (opens YouTube in a new tab)</span></a>`;
async function renderLearn(){
  const body=$('#sBody');
  if(!REP_EXAM||!REPORT){ body.innerHTML=REP_EXAM?lockedBox():lockedBox(); return }
  if(!RECO){
    body.innerHTML=`<div class="card loading-card"><span class="spin" aria-hidden="true"></span>Finding courses for your weak topics…</div>`;
    try{ RECO=(await API.get('/api/student/recommendations?exam='+encodeURIComponent(REP_EXAM.id))).items }
    catch(e){ body.innerHTML=`<div class="card empty-state">${IC('alert')}<h2>Could not load recommendations</h2><p>${esc(e.message)}</p><button type="button" class="btn p" data-act="recoRetry">Try again</button></div>`; return }
    if(SVIEW!=='learn') return;
  }
  if(!RECO.length){ body.innerHTML=`<div class="card empty-state">${IC('checkCircle')}<h2>No weak topics on this paper</h2><p>You felt at least as comfortable as your batch everywhere in ${esc(REP_EXAM.title)}.</p></div>`; return }
  body.innerHTML=`<div class="banner">${IC('book')}<span>For the topics that felt hardest to you in <b>${esc(REP_EXAM.title)}</b>, one level above your comfort ceiling. Fetched from YouTube and saved in our database.</span></div>
  ${RECO.map(r=>`<section class="card reco" aria-labelledby="rc-${r.topic}">
     <div class="reco-h"><h2 id="rc-${r.topic}">${esc(r.topicName)}</h2><span class="pill ${r.urgency==='urgent'?'trap':'scare'}">${esc(r.urgency)}</span>
       <span class="muted small">comfortable up to ${esc(r.ceiling)} → aim for ${esc(r.target)}</span></div>
     ${r.error?`<p class="note">${esc(r.error)}</p>`:''}
     ${r.courses.length?`<h3 class="sub-t">Courses</h3><div class="vid-grid">${r.courses.map(vidCard).join('')}</div>`:''}
     ${r.videos.length?`<h3 class="sub-t">Videos for this level</h3><div class="vid-grid">${r.videos.map(vidCard).join('')}</div>`:''}
   </section>`).join('')}`;
}
ACT.recoRetry=()=>{RECO=null;renderLearn()};

/* ---- surveys: one per exam, one time only, drafts in MongoDB ---- */
let SV_EXAM=null, SURVEY=null, svI=0, svAns={}, SV_Q=[], svStart=0, saveT=null;
async function renderSurveys(){
  const body=$('#sBody');
  if(SV_EXAM) return renderSurveyRun();
  try{ S_EXAMS=(await API.get('/api/student/exams')).exams }catch(e){}
  if(SVIEW!=='surveys') return;
  body.innerHTML=`<p class="note" style="margin:0 0 16px">Each survey can be submitted <b>once</b>. Your report comes from these ratings — no marks are used.</p>`+(S_EXAMS.map(x=>{
    const st=x.surveyed?['done','Rated','checkCircle']:x.surveyOpen?['open','Open — one time','clock']:['closed','Closed','lock'];
    return `<div class="card sv-row ${st[0]}"><span class="sv-ic">${IC(st[2])}</span>
      <span class="sv-txt"><b>${esc(x.title)}</b><span class="muted small">${fmtDate(x.examDate)} · ${x.surveyCount} questions · ${st[1]}</span></span>
      ${!x.surveyed&&x.surveyOpen?`<button type="button" class="btn p sm" data-act="openSurvey" data-arg="${esc(x.id)}">Start survey</button>`:x.surveyed?'<span class="pill ok">done</span>':'<span class="pill bad">closed</span>'}</div>`}).join('')||'<p class="empty">No surveys yet.</p>');
}
async function renderSurveyRun(){
  const body=$('#sBody');
  if(!SURVEY){
    body.innerHTML=`<div class="card loading-card"><span class="spin" aria-hidden="true"></span>Loading survey…</div>`;
    try{ SURVEY=await API.get('/api/student/survey?exam='+encodeURIComponent(SV_EXAM)); SV_Q=SURVEY.questions; svAns=SURVEY.answers||{}; svI=0; svStart=0; loadNotifs() }
    catch(e){ body.innerHTML=`<div class="card empty-state">${IC('alert')}<h2>Could not load the survey</h2><p>${esc(e.message)}</p></div>`; return }
    if(SVIEW!=='surveys') return;
  }
  const back=`<button type="button" class="linkbtn" data-act="svBack">← All surveys</button>`;
  if(SURVEY.done){
    const d=SURVEY.done;
    body.innerHTML=`${back}<div class="card sv-done mt12"><div class="big">${IC('checkCircle')}</div><h2>${esc(SURVEY.exam.title)} — rated</h2>
      <p>Submitted ${fmtDate(d.at)}${d.secs?` in ${Math.floor(d.secs/60)} min ${d.secs%60} s`:''}. Surveys are one-time, so this cannot be changed.</p>
      <div class="btn-row center"><button type="button" class="btn p" data-act="histReport" data-arg="${esc(SURVEY.exam.id)}">See my comfort report</button></div></div>`;
    return;
  }
  if(!SURVEY.open){ body.innerHTML=`${back}<div class="card empty-state mt12">${IC('lock')}<h2>Survey closed</h2><p>Your teacher has closed ${esc(SURVEY.exam.title)}.</p></div>`; return }
  const q=SV_Q[svI], a=svAns[q.id]||{};
  const answered=SV_Q.filter(x=>svAns[x.id]?.self).length;
  const ok=!!a.self, last=svI===SV_Q.length-1, all=answered===SV_Q.length;
  const opts=(k,label)=>`<fieldset class="sv-set"><legend class="sv-ask">${label}</legend>
      <div class="sv-opts" role="radiogroup">${ENG.RATING.map((r,i)=>`<button type="button" role="radio" aria-checked="${a[k]===i+1}" class="sv-o ${a[k]===i+1?'sel':''}" data-act="svSet" data-arg="${k}:${i+1}">${r}</button>`).join('')}</div></fieldset>`;
  body.innerHTML=`${back}<div class="survey mt12">
    <div class="sv-prog" role="progressbar" aria-label="Survey progress" aria-valuemin="0" aria-valuemax="${SV_Q.length}" aria-valuenow="${answered}"><i style="width:${answered/SV_Q.length*100}%"></i></div>
    <div class="card sv-card">
      <div class="sv-meta"><span>${esc(SURVEY.exam.title)} · Q ${svI+1} OF ${SV_Q.length}</span><span id="svSaved" class="muted">${answered?'Draft saved':''}</span></div>
      <div class="sv-topic">${topicName(q.topic)}</div>
      <div class="sv-q">${esc(q.text)}</div>
      ${opts('self','How hard was it <b>for you</b>?')}
      <div class="sv-nav"><button type="button" class="btn" data-act="svPrev" ${svI===0?'disabled':''}>Back</button>
        <button type="button" class="btn p" ${ok&&(!last||all)?'':'disabled'} data-act="svNext">${!ok?'Pick one to continue':last?(all?'Review & submit':`Answer all ${SV_Q.length} first`):'Next question'}</button></div>
    </div>
    <p class="note center">Be honest — there is no right answer, and nobody sees your individual taps.<span class="kbd-hint"> Keys <kbd>1</kbd>–<kbd>4</kbd> pick an answer.</span></p>
  </div>`;
  if(!svStart) svStart=Date.now();
}
ACT.svBack=()=>{ SV_EXAM=null; SURVEY=null; renderSurveys() };
function saveDraft(){ clearTimeout(saveT); saveT=setTimeout(async()=>{
  try{ await API.put('/api/student/survey/draft',{exam:SV_EXAM,answers:svAns}); const s=$('#svSaved'); if(s) s.textContent='Draft saved' }
  catch(e){ const s=$('#svSaved'); if(s) s.textContent='Not saved — '+e.message } },350) }
ACT.svSet=arg=>{ const [k,v]=arg.split(':'); const q=SV_Q[svI]; svAns[q.id]={...svAns[q.id],[k]:+v}; renderSurveyRun(); saveDraft(); $(`.sv-o[data-arg="${k}:${v}"]`)?.focus() };
ACT.svPrev=()=>{ if(svI>0){svI--;renderSurveyRun()} };
ACT.svNext=()=>{
  const a=svAns[SV_Q[svI].id]; if(!a?.self) return;
  if(svI<SV_Q.length-1){ svI++; renderSurveyRun(); $('.sv-o')?.focus(); return }
  openModal('Submit your ratings?','ONE-TIME SUBMISSION',`<p class="note">You rated all ${SV_Q.length} questions of <b>${esc(SURVEY.exam.title)}</b>. After you submit, this survey cannot be taken again or changed.</p>
    <div class="btn-row mt18"><button type="button" class="btn p" data-act="svSubmit">Submit — one time</button><button type="button" class="btn" data-close-modal>Keep reviewing</button></div>`);
};
ACT.svSubmit=async(_,btn)=>{
  btn.disabled=true; btn.innerHTML='<span class="spin" aria-hidden="true"></span>Submitting…';
  try{
    clearTimeout(saveT);
    const r=await API.post('/api/student/survey/submit',{exam:SV_EXAM,answers:svAns,secs:Math.max(1,Math.round((Date.now()-svStart)/1000))});
    closeModal(); const id=SV_EXAM; SURVEY.done=r.survey; RECO=null;
    await loadStudent(id); SVIEW='report'; renderStudent();
    toast(r.ready?`${IC('check')} Saved — your comfort report is ready`:`${IC('check')} Saved — report appears when ${r.need} classmates have rated`);
  }catch(e){ closeModal(); toast(esc(e.message)); SURVEY=null; renderSurveyRun() }
};
document.addEventListener('keydown',e=>{
  if(!ME||ROLE!=='student'||SVIEW!=='surveys'||!SV_EXAM||!SURVEY||SURVEY.done||!SURVEY.open||!$('#modal').hidden) return;
  if(e.target.matches('input,textarea,select')) return;
  const n={Digit1:1,Digit2:2,Digit3:3,Digit4:4}[e.code];
  if(n){ e.preventDefault(); ACT.svSet('self:'+n) }
});

/* ---- history ---- */
async function renderHistory(){
  const body=$('#sBody');
  body.innerHTML=`<div class="card loading-card"><span class="spin" aria-hidden="true"></span>Loading your history…</div>`;
  let items;
  try{ items=(await API.get('/api/student/history')).items }
  catch(e){ body.innerHTML=`<div class="card empty-state">${IC('alert')}<h2>Could not load history</h2><p>${esc(e.message)}</p></div>`; return }
  if(SVIEW!=='history') return;
  const rated=items.filter(i=>i.history);
  const trend=rated.length>1?`<div class="card trend"><h2 class="panel-t">Comfort over time <small>share of questions that felt Normal or Medium</small></h2><div class="spark">${[...rated].reverse().map(i=>
      `<div class="sp"><span class="sp-v">${+i.history.comfortPct}%</span><span class="sp-b"><i style="height:${Math.max(6,+i.history.comfortPct)}%"></i></span><span class="sp-l">${esc(i.exam.title.split('·')[0].trim())}</span></div>`).join('')}</div></div>`:'';
  body.innerHTML=trend+(items.length?items.map(({exam:x,history:h,survey:s})=>`
    <article class="card hist" aria-labelledby="h-${esc(x.id)}">
      <div class="hist-h"><div><h2 id="h-${esc(x.id)}">${esc(x.title)}</h2><span class="muted small">${fmtDate(x.examDate)}${h?` · compared with ${+h.batchSize} classmates${h.final?'':' so far'}`:''}</span></div>
        <div class="hist-score">${h?`<b>${+h.comfortPct}%</b><span>comfort</span>`:s?'<span class="muted small">waiting for the batch</span>':x.surveyOpen?'<span class="muted small">not rated yet</span>':'<span class="muted small">not rated</span>'}</div></div>
      <div class="hist-meta">
        <span class="pill ${s?'ok':x.surveyOpen?'scare':'bad'}">${s?`rated ${fmtDate(s.at)}`:x.surveyOpen?'survey pending':'missed'}</span>
        ${h?`<span class="pill trap">${+h.harderThanBatch} harder than batch</span><span class="pill scare">${+h.harderThanTeacher} harder than teacher said</span><span class="pill l2">reads like teacher ${+h.calib}</span>`:''}
      </div>
      ${h?`<div class="ceil-row">${ENG.TOPICS.map(t=>`<span class="ceil"><span class="muted small">${t.name}</span><span>${pill(h.ceilings[t.id]||'—')} <span class="muted small">batch ${esc(h.batchCeilings?.[t.id]||'—')}</span></span></span>`).join('')}</div>`:''}
      ${h&&h.recommendations.length?`<details class="hist-reco"><summary>Recommended then · ${h.recommendations.length} topic${h.recommendations.length===1?'':'s'}</summary>
        ${h.recommendations.map(r=>`<div class="hr-t"><b>${esc(r.topicName)}</b> <span class="muted small">comfortable up to ${esc(r.ceiling)} → ${esc(r.target)}</span></div>
          <ul class="hr-list">${r.items.slice(0,6).map(v=>`<li><a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">${v.kind==='course'?'<span class="pill l2">course</span> ':''}${esc(v.title)}</a><span class="muted small"> · ${esc(v.channel)}</span></li>`).join('')}</ul>`).join('')}</details>`:h?'<p class="note">No weak topics on this paper.</p>':''}
      <div class="btn-row mt12">${h?`<button type="button" class="btn sm" data-act="histReport" data-arg="${esc(x.id)}">Open full report</button>`:''}
        ${!s&&x.surveyOpen?`<button type="button" class="btn sm p" data-act="openSurvey" data-arg="${esc(x.id)}">Rate this paper</button>`:''}</div>
    </article>`).join(''):'<p class="empty">No exams yet.</p>');
}
ACT.histReport=async id=>{ loading(true); try{ await loadStudent(id); SVIEW='report'; RECO=null; renderStudent() }catch(e){ toast(esc(e.message)) } finally{ loading(false) } };

/* ---- comfort report (one exam) ---- */
function qRow(d,mode){
  return `<div class="alert ${mode==='t'?'a':'r'}"><div class="alert-h">${esc(d.q.id)} · ${topicName(d.q.topic)}</div><p>${esc(d.q.text)}</p>
    <div class="cmp"><span><span class="muted small">you</span><b>${ENG.RATING[d.self-1]}</b></span><span><span class="muted small">your batch</span><b>${feltWord(d.felt)} <span class="muted small">(${feltNum(d.felt)})</span></b></span><span><span class="muted small">teacher</span><b>${pill(ENG.BANDS[d.t-1].id)}</b></span></div></div>`;
}
function renderStudentReport(){
  const body=$('#sBody'), rep=REPORT;
  if(!REP_EXAM){ body.innerHTML=lockedBox(); return }
  if(!rep){ body.innerHTML=`${examPicker(REP_EXAM.id,'repExam')}${lockedBox()}`; return }
  const list=(arr,k,n)=>SHOW_ALL[k]?arr:arr.slice(0,n);
  const more=(arr,k,n)=>arr.length>n?`<button type="button" class="btn sm" data-act="toggleAll" data-arg="${k}" aria-expanded="${SHOW_ALL[k]}">${SHOW_ALL[k]?'Show fewer':`Show all ${arr.length}`}</button>`:'';
  const weak=rep.focus.filter(o=>o.score>1.2).length;
  const thin=rep.topics.filter(o=>o.n).every(o=>o.bands.filter(b=>b.r&&b.r.n>=2).length<2);
  body.innerHTML=`
  <div class="rep-top"><div><h2 class="h2">${esc(REP_EXAM.title)}</h2><span class="muted small">${fmtDate(REP_EXAM.examDate)} · compared with ${+REP_STATE.batchSize} classmates${REP_EXAM.surveyOpen?' so far':''}</span></div>${examPicker(REP_EXAM.id,'repExam')}</div>
  ${NOTE_FELT}
  ${thin?`<div class="banner">${IC('alert')}<span>Short paper — too few questions per topic and level to place a comfort ceiling. The question-by-question comparison below is still exact.</span></div>`:''}
  ${weak?`<div class="banner">${IC('book')}<span><b>${weak} topic${weak===1?'':'s'}</b> felt harder to you than to your batch — free courses picked for each.</span><button type="button" class="btn sm" data-act="sview" data-arg="learn">See courses</button></div>`:''}
  <div class="g3">
    <div class="card stat"><div class="k">Comfort</div><div class="v">${rep.comfortPct}<small>%</small></div><div class="c">Questions that felt Normal or Medium to you</div></div>
    <div class="card stat"><div class="k">Reads difficulty like your teacher</div><div class="v">${rep.calib}<small>/100</small></div><div class="c">How closely your ratings follow the teacher's levels · batch avg ${rep.calibBatch}</div></div>
    <div class="card stat"><div class="k">In step with batch</div><div class="v">${rep.match}<small>/100</small></div><div class="c">How closely your feeling follows the class average · avg ${rep.matchBatch}</div></div>
  </div>
  <section class="card panel" aria-labelledby="st-stand">
    <h2 class="panel-t" id="st-stand">Comfort ceiling by topic <small>highest teacher level where ≥60% of questions felt Normal/Medium to you</small></h2>
    <div class="tbl-wrap"><table><thead><tr><th scope="col">Topic</th><th scope="col">You</th><th scope="col">Batch median</th><th scope="col">Position</th><th scope="col">Felt vs batch</th></tr></thead><tbody>
    ${rep.topics.filter(o=>o.n).map(o=>`<tr class="click" tabindex="0" data-act="topicDetail" data-arg="${o.t.id}" aria-label="${o.t.name} — open level detail">
      <td class="w">${o.t.name}</td><td>${pill(o.my)}</td><td>${pill(o.bt)}</td>
      <td><div class="pos"><div class="bar" style="width:90px"><i style="width:${o.pct}%;background:${o.delta<0?'var(--red)':o.delta>0?'var(--green)':'var(--blue)'}"></i></div><span class="mono">${o.pct}%ile</span></div></td>
      <td>${o.vsBatch>0.3?`<span class="t-r">harder for you ${sgn(o.vsBatch)}</span>`:o.vsBatch<-0.3?`<span class="t-g">easier for you ${sgn(o.vsBatch)}</span>`:'<span class="muted">about the same</span>'}</td></tr>`).join('')}
    </tbody></table></div>
  </section>
  <div class="g2">
    <section class="card panel" aria-labelledby="st-hb">
      <h2 class="panel-t t-r" id="st-hb">${sdot('r')}Harder for you than for your batch <small>you rated it ≥1 step harder than the batch average</small></h2>
      ${rep.harderThanBatch.length?list(rep.harderThanBatch,'hb',3).map(d=>qRow(d,'b')).join(''):'<p class="empty">Nothing felt much harder to you than to your classmates.</p>'}
      <div class="panel-foot"><span class="note">${rep.harderThanBatch.length} question${rep.harderThanBatch.length===1?'':'s'}.</span>${more(rep.harderThanBatch,'hb',3)}</div>
    </section>
    <section class="card panel" aria-labelledby="st-ht">
      <h2 class="panel-t t-a" id="st-ht">${sdot('a')}Harder than your teacher expects <small>2+ steps above the teacher's level</small></h2>
      ${rep.harderThanTeacher.length?list(rep.harderThanTeacher,'ht',3).map(d=>qRow(d,'t')).join(''):'<p class="empty">Every question felt about as hard as your teacher rated it, or easier.</p>'}
      <div class="panel-foot"><span class="note">${rep.confidentOnHard.length?`You called ${rep.confidentOnHard.length} Advanced/Elite question${rep.confidentOnHard.length===1?'':'s'} “Normal” — worth double-checking you really own ${rep.confidentOnHard.length===1?'it':'them'}.`:''}</span>${more(rep.harderThanTeacher,'ht',3)}</div>
    </section>
  </div>
  <section class="card panel" aria-labelledby="st-focus">
    <h2 class="panel-t" id="st-focus">Focus this week <small>ranked automatically</small></h2>
    ${rep.focus.map((o,i)=>`<div class="alert ${o.score>3?'r':o.score>1.2?'a':'g'}">
        <div class="alert-h">${i+1}. ${o.t.name} ${o.score>3?'— urgent':o.score>1.2?'— work on it':'— you are comfortable here'}</div>
        <p>${o.score>1.2?`Comfortable up to ${o.my}, batch at ${o.bt}. ${o.nHard} question${o.nHard===1?'':'s'} felt much harder to you than to the batch.
          <button type="button" class="linkbtn" data-act="sview" data-arg="learn">Courses for this →</button>`
          :`You feel at least as comfortable as your batch (${o.pct}%ile). Keep it ticking over.`}</p></div>`).join('')}
  </section>`;
}
ACT.toggleAll=k=>{ SHOW_ALL[k]=!SHOW_ALL[k]; renderStudentReport(); $(`[data-act="toggleAll"][data-arg="${k}"]`)?.focus() };
ACT.topicDetail=tid=>{
  const o=REPORT.topics.find(x=>x.t.id===tid); if(!o) return;
  openModal(o.t.name,'COMFORT BY TEACHER LEVEL',`<div class="ladder">${o.bands.map(b=>{
      const a=b.r?b.r.acc:0, ok=b.r&&b.r.n>=2&&b.r.acc>=0.6;
      return `<div class="rung"><span class="rl">${b.b.name}</span><div class="bar"><i style="width:${Math.round(a*100)}%;background:${b.b.color}"></i></div>
        <span class="rv">${b.r?Math.round(a*100)+'%':'—'}</span><span class="rf ${ok?'t-g':'t-r'}">${b.r?(b.r.n<2?'1 item':ok?'COMFORTABLE':'NOT YET'):'no items'}</span></div>`}).join('')}</div>
    <p class="note mt18">Comfortable up to <b>${o.my}</b> · batch median <b>${o.bt}</b> · ${o.pct}th percentile · felt ${o.vsBatch>0?'harder':'easier'} than the batch by ${Math.abs(o.vsBatch).toFixed(1)} steps on average.</p>`);
};

/* ================= TEACHER ================= */
let liveTimer=null, PM_FILTER='flagged', ST_Q='', ST_ALL=false, LIVE=null, T_EXAM=null, T_EXAMS=[], T_CUR=null, T_DRAFT=null, T_NSTU=40, T_NEED=5;
const STATUS={draft:['Draft — rate difficulty','bad'],published:['Survey open','scare'],closed:['Closed','ok']};
async function loadTeacher(){
  const d=await API.get('/api/exams'); T_EXAMS=d.exams; T_NSTU=d.students; T_NEED=d.minReady||5;
  if(!T_EXAM||!T_EXAMS.some(x=>x.id===T_EXAM)) T_EXAM=(T_EXAMS.find(x=>x.ready)||T_EXAMS[0])?.id;
  T_CUR=T_EXAMS.find(x=>x.id===T_EXAM); T_DRAFT=null; E=null; LIVE=null;
  if(!T_CUR) return;
  if(T_CUR.status==='draft'){ T_DRAFT=await API.get('/api/teacher/exams/'+encodeURIComponent(T_EXAM)); return }
  const data=await API.get('/api/batch?exam='+encodeURIComponent(T_EXAM));
  if(data.ready){ E=FELT.analyzeFelt(data); BR=E.batchReport() }
  LIVE=await API.get('/api/teacher/survey-status?exam='+encodeURIComponent(T_EXAM));
}
function examBar(){
  return `<div class="exam-bar">
    <div class="exam-chips" role="tablist" aria-label="Exams">${T_EXAMS.map(x=>`<button type="button" role="tab" aria-selected="${x.id===T_EXAM}" class="exam-chip ${x.id===T_EXAM?'on':''}" data-act="pickExam" data-arg="${esc(x.id)}">
      <b>${esc(x.title)}</b><span><span class="pill ${STATUS[x.status][1]}">${STATUS[x.status][0]}</span> ${x.status!=='draft'?`${x.surveys}/${T_NSTU} rated`:`${x.questions} questions`}</span></button>`).join('')}</div>
    <button type="button" class="btn p" data-act="newExam">${IC('upload')} New exam</button></div>`;
}
ACT.pickExam=id=>{ T_EXAM=id; show() };
function renderTeacher(){
  const p=$('#pane-teacher');
  if(!T_CUR){ p.innerHTML=`${examBar()}<div class="card empty-state">${IC('book')}<h2>No exams yet</h2><p>Create one from your question paper.</p></div>`; return }
  if(T_CUR.status==='draft') return renderDifficulty(p);
  if(!E) return renderExamStatus(p);
  renderTeacherDash(p);
}

/* new exam: questions CSV (answer column optional — v3 never uses it) */
const Q_TEMPLATE='topic,question,A,B,C,D,answer\nRotational Motion,"A solid sphere rolls without slipping. Fraction of its KE that is rotational?",2/7,2/5,5/7,1/2,\nKinematics,"A ball is dropped from 20 m. Time to reach the ground (g=10)?",1 s,2 s,4 s,√2 s,\nNewton\'s Laws,"Action and reaction forces act on:",The same body,Different bodies,Nothing,The ground,\nThermodynamics,"In an isothermal process, change in internal energy of an ideal gas is:",Zero,Positive,Negative,nRT,\n';
let NX_CSV=null;
ACT.newExam=()=>{
  openModal('New exam','STEP 1 OF 3 · QUESTIONS',`
    <label class="lbl" for="nxTitle">Exam title</label><input id="nxTitle" class="in" maxlength="80" placeholder="e.g. Chapter test · Laws of Motion" autocomplete="off">
    <label class="lbl" for="nxFile">Questions CSV <span class="muted small">— topic, question, A, B, C, D, answer (answer optional). 4–60 rows.</span></label>
    <label class="drop" id="nxDrop"><input type="file" id="nxFile" accept=".csv,text/csv" class="sr">${IC('upload')}<span id="nxName"><b>Choose the question file</b></span><small>Topics: ${ENG.TOPICS.map(t=>t.name).join(', ')}</small></label>
    <div id="nxErr" class="err" role="alert"></div>
    <div class="btn-row mt18"><button type="button" class="btn p" data-act="createExam">Create &amp; rate difficulty</button>
      <button type="button" class="btn sm" data-act="qTemplate">${IC('download')} Question template</button></div>
    <p class="note">Next you rate how hard each question really is (L1–L4). Students then rate how hard it felt — no marks needed.</p>`);
  NX_CSV=null;
  $('#nxFile').addEventListener('change',e=>{const f=e.target.files[0]; if(!f) return;
    if(f.size>200*1024||!/\.csv$/i.test(f.name)){ $('#nxErr').className='err on'; $('#nxErr').textContent='Choose a .csv file under 200 KB.'; return }
    const fr=new FileReader(); fr.onload=()=>{NX_CSV=String(fr.result); $('#nxName').innerHTML=`<b>${esc(f.name)}</b> ready`}; fr.readAsText(f)});
  $('#nxTitle').focus();
};
ACT.qTemplate=()=>{ const b=new Blob(['﻿'+Q_TEMPLATE],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='anumaan-questions-template.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000) };
ACT.createExam=async(_,btn)=>{
  const err=$('#nxErr'), title=$('#nxTitle').value.trim();
  if(title.length<3){ err.className='err on'; err.textContent='Give the exam a title.'; $('#nxTitle').focus(); return }
  if(!NX_CSV){ err.className='err on'; err.textContent='Choose the questions CSV.'; return }
  btn.disabled=true;
  try{ const {exam}=await API.post('/api/teacher/exams',{title,csv:NX_CSV}); closeModal(); T_EXAM=exam.id; await show(); toast(`${IC('check')} ${exam.questions} questions saved — now rate their difficulty`) }
  catch(e){ err.className='err on'; err.textContent=e.message; btn.disabled=false }
};
let BANDS_SEL={}, bandT=null;
function renderDifficulty(p){
  const qs=T_DRAFT.questions; BANDS_SEL=Object.fromEntries(qs.filter(q=>q.teacherBand).map(q=>[q.id,q.teacherBand]));
  p.innerHTML=`${examBar()}
  <div class="h-row"><div><h1 class="h1">${esc(T_DRAFT.exam.title)}</h1><div class="sub">Step 2 of 3 · rate how hard each question really is. This is the reference every student's “felt” rating is compared against.</div></div>
    <div class="btn-row"><button type="button" class="btn" data-act="deleteDraft">Delete draft</button>
      <button type="button" class="btn p" id="approveBtn" data-act="approveExam">${IC('bell')} Approve &amp; notify students</button></div></div>
  <div class="banner" id="diffLeft"></div>
  <section class="card panel"><div class="tbl-wrap"><table class="diff"><thead><tr><th scope="col">#</th><th scope="col">Question</th><th scope="col">Topic</th><th scope="col">Real difficulty (your rating)</th></tr></thead><tbody>
  ${qs.map(q=>`<tr><td class="mono">${esc(q.id)}</td><td class="w">${esc(q.text)}</td><td>${topicName(q.topic)}</td>
    <td><div class="band-seg" role="radiogroup" aria-label="Difficulty of ${esc(q.id)}">${ENG.BANDS.map(b=>`<button type="button" role="radio" class="bs ${b.id.toLowerCase()} ${BANDS_SEL[q.id]===b.id?'on':''}" aria-checked="${BANDS_SEL[q.id]===b.id}" data-act="markBand" data-arg="${esc(q.id)}:${b.id}" title="${b.name}">${b.id}</button>`).join('')}</div></td></tr>`).join('')}
  </tbody></table></div></section>`;
  paintLeft();
}
function paintLeft(){
  const left=T_DRAFT.questions.filter(q=>!BANDS_SEL[q.id]).length;
  $('#diffLeft').innerHTML=left?`${IC('clock')}<span><b>${left}</b> of ${T_DRAFT.questions.length} questions still need your rating. Saved automatically.</span>`:`${IC('checkCircle')}<span>All rated. Approve to open the survey — every student gets a one-time notification.</span>`;
  $('#approveBtn').disabled=!!left;
}
ACT.markBand=arg=>{
  const i=arg.lastIndexOf(':'), qid=arg.slice(0,i), b=arg.slice(i+1); BANDS_SEL[qid]=b;
  $$(`[data-act="markBand"]`).filter(x=>x.dataset.arg.startsWith(qid+':')).forEach(x=>{const on=x.dataset.arg===arg;x.classList.toggle('on',on);x.setAttribute('aria-checked',on)});
  paintLeft();
  clearTimeout(bandT); bandT=setTimeout(async()=>{ try{ await API.put(`/api/teacher/exams/${encodeURIComponent(T_EXAM)}/difficulty`,{bands:BANDS_SEL}) }catch(e){ toast(esc(e.message)) } },300);
};
ACT.approveExam=async(_,btn)=>{
  btn.disabled=true;
  try{ clearTimeout(bandT); await API.put(`/api/teacher/exams/${encodeURIComponent(T_EXAM)}/difficulty`,{bands:BANDS_SEL});
    const r=await API.post(`/api/teacher/exams/${encodeURIComponent(T_EXAM)}/approve`); await show(); toast(`${IC('bell')} Approved — ${r.notified} students notified`) }
  catch(e){ toast(esc(e.message)); btn.disabled=false }
};
ACT.deleteDraft=()=>openModal('Delete this draft?','CANNOT BE UNDONE',`<p class="note">The draft and its questions are removed. Published exams cannot be deleted.</p>
  <div class="btn-row mt18"><button type="button" class="btn p" data-act="deleteDraftYes">Delete draft</button><button type="button" class="btn" data-close-modal>Cancel</button></div>`);
ACT.deleteDraftYes=async()=>{ try{ await API.del('/api/teacher/exams/'+encodeURIComponent(T_EXAM)); closeModal(); T_EXAM=null; await show(); toast('Draft deleted') }catch(e){ toast(esc(e.message)) } };

function liveCard(){
  if(!LIVE) return '';
  return `<div class="card panel live-panel" id="liveBox"><h2 class="panel-t">Survey · ${esc(LIVE.exam.title)} <small>${LIVE.open?sdot('g')+'open':IC('lock')+' closed · final'}</small></h2>
    <div class="live"><div class="live-n">${LIVE.submitted}<small> / ${LIVE.total} rated</small></div>
      <div class="live-bar"><div class="bar" style="height:10px"><i style="width:${LIVE.total?LIVE.submitted/LIVE.total*100:0}%;background:var(--acc)"></i></div>
      <p class="note mt8">Live from the database. Results appear at ${T_NEED} ratings and update with every new one. Closing makes them final.</p></div>
      ${LIVE.open?`<button type="button" class="btn" data-act="surveyClose">${IC('lock')} Close &amp; finalise</button>`:''}</div></div>`;
}
function renderExamStatus(p){
  p.innerHTML=`${examBar()}
  <div class="h-row"><div><h1 class="h1">${esc(T_CUR.title)}</h1><div class="sub">${T_CUR.questions} questions · approved ${fmtDate(T_CUR.examDate)}</div></div></div>
  ${liveCard()}
  <div class="card empty-state">${IC('clock')}<h2>Waiting for ratings</h2><p>${LIVE?.submitted||0} of ${T_NEED} needed. The batch comfort map and every student's report appear as soon as ${T_NEED} students have rated — no marks to upload.</p></div>`;
  startLive();
}
function startLive(){ clearInterval(liveTimer); liveTimer=setInterval(async()=>{ if(ROLE!=='teacher'||!$('#liveBox')) return clearInterval(liveTimer);
  try{ const prev=LIVE?.submitted; LIVE=await API.get('/api/teacher/survey-status?exam='+encodeURIComponent(T_EXAM));
    const n=$('#liveBox .live-n'); if(n) n.innerHTML=`${LIVE.submitted}<small> / ${LIVE.total} rated</small>`;
    if(!E&&LIVE.submitted>=T_NEED&&prev<T_NEED) show() }catch(e){} },5000) }
ACT.surveyClose=()=>openModal('Close the survey?','FINAL — CANNOT RE-OPEN',`<p class="note">${LIVE.total-LIVE.submitted} students have not rated yet. Closing freezes everyone's report and history as final.</p>
  <div class="btn-row mt18"><button type="button" class="btn p" data-act="surveyCloseYes">Close &amp; finalise</button><button type="button" class="btn" data-close-modal>Cancel</button></div>`);
ACT.surveyCloseYes=async()=>{ try{ await API.post(`/api/teacher/exams/${encodeURIComponent(T_EXAM)}/survey/close`); closeModal(); await show(); toast(`${IC('lock')} Survey closed — reports are final`) }catch(e){ toast(esc(e.message)) } };

const SECTIONS=[['t-over','Overview'],['t-heat','Comfort map'],['t-gap','You vs batch'],['t-focus','Focus'],['t-map','Paper map'],['t-stu','Students']];
function coverageBanner(){
  let ok=0; ENG.TOPICS.forEach(t=>ENG.BANDS.forEach(b=>{ if((E.HEAT[t.id][b.id]?.n||0)>=2) ok++ }));
  return ok>=6?'':`<div class="banner">${IC('alert')}<span><b>Paper coverage:</b> only ${ok} topic × level cells have 2 or more questions, so comfort ceilings are rough. Question-level results are exact.</span></div>`;
}
function renderTeacherDash(p){
  const prio=BR.prio, w=prio[0];
  p.innerHTML=`${examBar()}
  <div class="h-row" id="t-over"><div><h1 class="h1">${esc(T_CUR.title)}</h1><div class="sub">${E.QUESTIONS.length} questions · ${nS()} of ${T_NSTU} students rated${LIVE?.open?' so far':' · final'}</div></div>
    <div class="btn-row"><button type="button" class="btn sm" data-act="exportMap">${IC('download')} Export CSV</button></div></div>
  <nav class="subnav" aria-label="Dashboard sections">${SECTIONS.map(s=>`<button type="button" class="chip" data-act="jump" data-arg="${s[0]}">${s[1]}</button>`).join('')}</nav>
  ${LIVE?.open?liveCard():''}
  <div class="banner">${IC('alert')}<span><b>No marks used.</b> Every number here compares how hard questions <i>felt</i> to students with <i>your</i> difficulty rating.</span></div>
  ${coverageBanner()}
  <div class="g3">
    <div class="card stat"><div class="k">Batch comfort</div><div class="v">${Math.round(BR.comfort*100)}<small>%</small></div><div class="c">Ratings of Normal or Medium across the paper</div></div>
    <div class="card stat"><div class="k">Batch agrees with your ratings</div><div class="v">r = ${BR.rTeacher.toFixed(2)}</div><div class="c">${BR.rTeacher>=0.6?'Students feel difficulty much like you rated it':BR.rTeacher>=0.3?'Partly — see the paper map for where you differ':'Students and you read this paper very differently'}</div></div>
    <div class="card stat"><div class="k">Weakest topic</div><div class="v">${w?esc(w.t.name.split(' ')[0]):'—'}</div><div class="c">${w?`${w.verdict}. ${w.below} of ${nS()} are not comfortable at L2.`:''}</div></div>
  </div>
  <section class="card panel" id="t-heat" aria-labelledby="t-heat-h">
    <h2 class="panel-t" id="t-heat-h">Comfort map — topic × your difficulty level <small>% of ratings that were Normal or Medium · select a cell</small></h2>
    <div class="tbl-wrap"><table class="hm"><caption class="sr">Share of comfortable ratings by topic and teacher level</caption>
    <thead><tr><th class="rowh" scope="col"><span class="sr">Topic</span></th>${ENG.BANDS.map(b=>`<th scope="col"><span class="hm-full">${b.name}</span><span class="hm-short">${b.id}</span></th>`).join('')}</tr></thead>
    <tbody>${ENG.TOPICS.filter(t=>E.QUESTIONS.some(q=>q.topic===t.id)).map(t=>`<tr><th scope="row" class="rl">${t.name}</th>${ENG.BANDS.map(b=>{
      const h=E.HEAT[t.id][b.id];
      if(!h) return `<td><div class="cell empty-cell">—</div></td>`;
      return `<td><button type="button" class="cell" style="--hc:${heatColor(h.acc)}" data-act="cellDetail" data-arg="${t.id}:${b.id}" aria-label="${t.name}, ${b.name}: ${Math.round(h.acc*100)}% comfortable">${Math.round(h.acc*100)}%</button></td>`}).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="legend"><span><i class="sw-lo"></i>few comfortable</span><span><i class="sw-mid"></i>mixed</span><span><i class="sw-hi"></i>most comfortable</span></div>
  </section>
  <div class="g2" id="t-gap">
    <section class="card panel" aria-labelledby="t-hard-h">
      <h2 class="panel-t t-r" id="t-hard-h">${sdot('r')}Felt harder than you rated <small>batch average ≥1 step above your level</small></h2>
      ${BR.harder.slice(0,4).map(q=>gapRow(q)).join('')||'<p class="empty">Nothing felt much harder than you rated.</p>'}
      ${BR.harder.length>4?`<p class="note">+${BR.harder.length-4} more in the paper map.</p>`:''}
    </section>
    <section class="card panel" aria-labelledby="t-easy-h">
      <h2 class="panel-t" id="t-easy-h">${sdot('k')}Felt easier than you rated <small>batch average ≥1 step below your level</small></h2>
      ${BR.easier.slice(0,4).map(q=>gapRow(q)).join('')||'<p class="empty">Nothing felt much easier than you rated.</p>'}
      ${BR.easier.length>4?`<p class="note">+${BR.easier.length-4} more in the paper map.</p>`:''}
    </section>
  </div>
  <section class="card panel" id="t-focus" aria-labelledby="t-focus-h">
    <h2 class="panel-t" id="t-focus-h">Where the batch should focus</h2>
    ${prio.map((o,i)=>`<div class="alert ${o.verdict==='Foundation gap'?'r':o.verdict==='Stretch gap'?'a':'g'}"><div class="alert-h">${i+1}. ${o.t.name} — ${o.verdict}</div><p>${o.action}</p>
      <p class="mono mt8">comfortable at L1 ${o.l1==null?'—':Math.round(o.l1*100)+'%'} · L2 ${o.l2==null?'—':Math.round(o.l2*100)+'%'} · L3 ${o.l3==null?'—':Math.round(o.l3*100)+'%'} · ${o.below} below L2</p></div>`).join('')}
  </section>
  <section class="card panel" id="t-map" aria-labelledby="t-map-h">
    <div class="panel-top"><h2 class="panel-t" id="t-map-h">Paper map — your rating vs what the batch felt <small>select a row</small></h2></div>
    <div class="chips" role="group" aria-label="Filter questions" id="pmChips"></div>
    <div class="tbl-wrap" id="pmTable"></div>
  </section>
  <section class="card panel" id="t-stu" aria-labelledby="t-stu-h">
    <div class="panel-top"><h2 class="panel-t" id="t-stu-h">Students <small>comfort ceilings per topic</small></h2>
      <label class="search">${IC('search')}<span class="sr">Search students</span><input id="stSearch" type="search" placeholder="Search name or roll" value="${esc(ST_Q)}" maxlength="40" autocomplete="off"></label></div>
    <div class="tbl-wrap" id="stTable"></div>
  </section>`;
  renderPaperMap(); renderStudents();
  $('#stSearch').addEventListener('input',e=>{ST_Q=e.target.value;renderStudents()});
  if(LIVE?.open) startLive();
}
function gapRow(q){
  const f=E.QF[q.id];
  return `<div class="alert ${f.flag==='harder'?'r':'k'}"><div class="alert-h">${esc(q.id)} · ${topicName(q.topic)}</div><p>${esc(q.text)}</p>
    <div class="cmp"><span><span class="muted small">you rated</span><b>${pill(q.teacherBand)}</b></span><span><span class="muted small">batch felt</span><b>${feltWord(f.felt)} <span class="muted small">(${feltNum(f.felt)})</span></b></span><span><span class="muted small">comfortable</span><b>${Math.round(f.comfort*100)}%</b></span></div>
    <div class="btn-row mt8"><button type="button" class="btn sm" data-act="qDetail" data-arg="${esc(q.id)}">Open question</button></div></div>`;
}
ACT.jump=id=>{const el=document.getElementById(id); if(!el) return; el.scrollIntoView({behavior:reduceMotion.matches?'auto':'smooth',block:'start'}); el.setAttribute('tabindex','-1'); el.focus({preventScroll:true})};
const PM_FILTERS=[['flagged','Different from you',f=>f.flag!=='aligned'],['harder','Felt harder',f=>f.flag==='harder'],['easier','Felt easier',f=>f.flag==='easier'],['all','All',()=>true]];
function renderPaperMap(){
  if(PM_FILTER==='flagged'&&!E.QUESTIONS.some(q=>E.QF[q.id].flag!=='aligned')) PM_FILTER='all';
  $('#pmChips').innerHTML=PM_FILTERS.map(([k,l,f])=>`<button type="button" class="chip ${PM_FILTER===k?'on':''}" aria-pressed="${PM_FILTER===k}" data-act="pmFilter" data-arg="${k}">${l} <span>${E.QUESTIONS.filter(q=>f(E.QF[q.id])).length}</span></button>`).join('');
  const f=PM_FILTERS.find(x=>x[0]===PM_FILTER)[2], rows=E.QUESTIONS.filter(q=>f(E.QF[q.id]));
  $('#pmTable').innerHTML=rows.length?`<table><thead><tr><th scope="col">Q</th><th scope="col">Topic</th><th scope="col">You rated</th><th scope="col">Batch felt</th><th scope="col">Gap</th><th scope="col">Comfortable</th><th scope="col">Read</th></tr></thead><tbody>
    ${rows.map(q=>{const s=E.QF[q.id];return `<tr class="click" tabindex="0" data-act="qDetail" data-arg="${esc(q.id)}" aria-label="${esc(q.id)} — open question">
      <td class="w">${esc(q.id)}</td><td>${topicName(q.topic)}</td><td>${pill(q.teacherBand)}</td><td>${feltWord(s.felt)} <span class="muted small">${feltNum(s.felt)}</span></td>
      <td class="mono ${s.gap>=1?'t-r':''}">${sgn(s.gap)}</td><td class="mono">${Math.round(s.comfort*100)}%</td><td>${FELTFLAG[s.flag]}</td></tr>`}).join('')}
    </tbody></table>`:'<p class="empty">No questions in this filter.</p>';
}
ACT.pmFilter=k=>{PM_FILTER=k;renderPaperMap();$(`.chip[data-arg="${k}"]`)?.focus()};
ACT.exportMap=()=>downloadCSV(`anumaan-comfort-${T_EXAM}.csv`,[['question','topic','text','teacher_level','batch_felt','gap','comfortable_pct','read'],
  ...E.QUESTIONS.map(q=>{const s=E.QF[q.id];return [q.id,topicName(q.topic),q.text,q.teacherBand,s.felt.toFixed(2),s.gap.toFixed(2),Math.round(s.comfort*100),s.flag]})]);
function renderStudents(){
  const q=ST_Q.trim().toLowerCase();
  let rows=E.STUDENTS.map(s=>({s,r:E.studentReport(s.id)})).sort((a,b)=>b.r.comfortPct-a.r.comfortPct);
  if(q) rows=rows.filter(({s})=>s.name.toLowerCase().includes(q)||s.roll.toLowerCase().includes(q));
  const topics=ENG.TOPICS.filter(t=>E.QUESTIONS.some(x=>x.topic===t.id));
  const total=rows.length, shown=(q||ST_ALL)?rows:rows.slice(0,12);
  $('#stTable').innerHTML=total?`<table><thead><tr><th scope="col">Student</th><th scope="col">Comfort</th>${topics.map(t=>`<th scope="col">${t.name.split(' ')[0]}</th>`).join('')}<th scope="col">Harder than batch</th><th scope="col">Reads like you</th></tr></thead><tbody>
    ${shown.map(({s,r})=>`<tr class="click" tabindex="0" data-act="studentModal" data-arg="${esc(s.id)}" aria-label="${esc(s.name)} — open card">
      <td class="w">${esc(s.name)}<span class="roll">${esc(s.roll)}</span></td><td class="mono">${r.comfortPct}%</td>${topics.map(t=>`<td>${pill(E.CEIL[s.id][t.id])}</td>`).join('')}
      <td class="mono ${r.harderThanBatch.length>4?'t-r':''}">${r.harderThanBatch.length}</td><td class="mono">${r.calib}</td></tr>`).join('')}</tbody></table>
    <div class="panel-foot"><span class="note">${q?`${total} match${total===1?'':'es'} for “${esc(ST_Q)}”.`:`Showing ${shown.length} of ${total}, least comfortable last.`}</span>
      ${q?'':`<button type="button" class="btn sm" data-act="stAll" aria-expanded="${ST_ALL}">${ST_ALL?'Show top 12':`Show all ${total}`}</button>`}</div>`
    :`<p class="empty">No student matches “${esc(ST_Q)}”. <button type="button" class="linkbtn" data-act="stClear">Clear search</button></p>`;
}
ACT.stAll=()=>{ST_ALL=!ST_ALL;renderStudents();$('[data-act="stAll"]')?.focus()};
ACT.stClear=()=>{ST_Q='';$('#stSearch').value='';renderStudents();$('#stSearch').focus()};
ACT.studentModal=sid=>{
  const r=E.studentReport(sid), s=r.s;
  openModal(esc(s.name),`ROLL ${esc(s.roll)} · COMFORT ${r.comfortPct}%`,`
    <div class="panel-t">Comfort ceiling by topic</div>
    ${r.topics.filter(o=>o.n).map(o=>`<div class="kv"><span>${o.t.name}</span><b>${o.my} <span class="muted">· batch ${o.bt} · ${o.vsBatch>0?'harder':'easier'} by ${Math.abs(o.vsBatch).toFixed(1)}</span></b></div>`).join('')}
    <div class="panel-t t-r mt18">Felt much harder than the batch — ${r.harderThanBatch.length}</div>
    ${r.harderThanBatch.slice(0,4).map(d=>`<div class="kv"><span>${esc(d.q.id)} · ${topicName(d.q.topic)} — “${ENG.RATING[d.self-1]}” vs batch ${feltWord(d.felt)}</span><b>${pill(ENG.BANDS[d.t-1].id)}</b></div>`).join('')||'<p class="note">None.</p>'}
    <p class="note mt18">Reads difficulty like you ${r.calib}/100 · in step with batch ${r.match}/100. Priority: <b>${r.focus[0]?.t.name||'—'}</b>.</p>`);
};
ACT.cellDetail=arg=>{
  const [tid,bid]=arg.split(':'), t=ENG.TOPICS.find(x=>x.id===tid), b=ENG.BANDS[ENG.bandIdx(bid)], h=E.HEAT[tid][bid];
  const qs=E.QUESTIONS.filter(q=>q.topic===tid&&q.teacherBand===bid);
  const stuck=E.STUDENTS.filter(s=>{const r=E.CEIL[s.id][tid];return r==='—'||ENG.bandIdx(r)<ENG.bandIdx(bid)});
  openModal(`${t.name} · ${b.name}`,`${Math.round(h.acc*100)}% COMFORTABLE · ${h.n} QUESTION${h.n===1?'':'S'}`,`
    ${qs.map(q=>`<button type="button" class="kv kv-btn" data-act="qDetail" data-arg="${esc(q.id)}"><span>${esc(q.id)} — ${esc(q.text.length>58?q.text.slice(0,58)+'…':q.text)}</span><b>${Math.round(E.QF[q.id].comfort*100)}%</b></button>`).join('')}
    <div class="panel-t mt18">Not yet comfortable at this level — ${stuck.length}</div>
    <p class="note">${stuck.slice(0,14).map(s=>esc(s.name)).join(' · ')}${stuck.length>14?` … +${stuck.length-14} more`:''}</p>
    <div class="btn-row mt12"><button type="button" class="btn sm" data-act="previewReco" data-arg="${tid}:${bid}">${IC('book')} Courses students get for this</button></div>`);
};
ACT.previewReco=async arg=>{
  const [tid,bid]=arg.split(':');
  try{ const r=await API.get(`/api/recommendations/${encodeURIComponent(tid)}/${encodeURIComponent(bid)}`);
    openModal(`${esc(r.topicName)} · ${esc(r.band)}`,'WHAT STUDENTS ARE RECOMMENDED',[...r.courses,...r.videos].map(v=>`<a class="kv kv-btn" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer"><span>${v.kind==='course'?'Course · ':''}${esc(v.title)}</span><b>${esc(v.channel)}</b></a>`).join('')||`<p class="note">${esc(r.error||'Nothing saved yet.')}</p>`) }
  catch(e){ toast(esc(e.message)) }
};
ACT.qDetail=qid=>{
  const q=E.QUESTIONS.find(x=>x.id===qid), s=E.QF[qid]; if(!q) return;
  openModal(`${esc(q.id)} — ${topicName(q.topic)}`,`YOU RATED ${q.teacherBand} · BATCH FELT “${feltWord(s.felt).toUpperCase()}” (${feltNum(s.felt)})`,`
    <p class="q-text">${esc(q.text)}</p>
    <div class="panel-t">How hard it felt — ${nS()} students</div>
    ${ENG.RATING.map((r,i)=>`<div class="opt-row"><span class="ol">${r}</span><div><div class="bar"><i style="width:${s.dist[i]/nS()*100}%;background:${['var(--heat-hi)','var(--heat-mid)','var(--heat-lo)','var(--red)'][i]}"></i></div></div><span class="ov">${s.dist[i]}</span></div>`).join('')}
    <div class="mt18"><div class="kv"><span>Your level</span><b>${pill(q.teacherBand)}</b></div>
      <div class="kv"><span>Batch felt (1 Normal – 4 Very Hard)</span><b>${feltNum(s.felt)}</b></div>
      <div class="kv"><span>Gap vs your level</span><b class="${s.gap>=1?'t-r':''}">${sgn(s.gap)}</b></div></div>
    ${s.flag!=='aligned'?`<div class="alert ${s.flag==='harder'?'r':'k'} mt18"><div class="alert-h">${FELTFLAG[s.flag]}</div><p>${s.flag==='harder'?'The batch found this clearly harder than you rated it — worth a quick re-explain, or a re-think of where it sits in the chapter.':'The batch found this easier than you expected — either it is well taught, or it is lighter than you thought.'}</p></div>`:''}`);
};

/* ================= BRANCH (aggregates only) ================= */
let BRANCH=null, COMPANY=null;
function renderBranch(){
  const d=BRANCH, p=$('#pane-branch');
  p.innerHTML=`<div class="h-row"><div><h1 class="h1">${esc(d.branch||'Branch')}</h1><div class="sub">${+d.batches} batch${d.batches===1?'':'es'} · ${+d.students} students · aggregates only</div></div></div>
  ${NOTE_FELT.replace('to you — one tap','to students — one tap').replace('your teacher\'s','the teacher\'s').replace('your batch','the batch')}
  ${d.exams.length?d.exams.map(x=>`<section class="card panel" aria-label="${esc(x.exam.title)}">
    <div class="hist-h"><div><h2 class="h2">${esc(x.exam.title)}</h2><span class="muted small">${fmtDate(x.exam.examDate)} · ${+x.surveys} rated · ${x.exam.surveyOpen?'open':'final'}</span></div>
      <div class="hist-score">${x.comfort!=null?`<b>${Math.round(x.comfort*100)}%</b><span>comfort</span>`:'<span class="muted small">waiting for ratings</span>'}</div></div>
    ${x.ceilings?`<div class="ceil-row mt12">${ENG.TOPICS.map(t=>`<span class="ceil"><span class="muted small">${t.name}</span>${pill(x.ceilings[t.id]||'—')}</span>`).join('')}</div>
      ${x.prio.slice(0,2).map(o=>`<div class="alert ${o.verdict==='Foundation gap'?'r':o.verdict==='Stretch gap'?'a':'g'} mt12"><div class="alert-h">${esc(o.topic)} — ${esc(o.verdict)}</div><p>${+o.below} students not comfortable at L2.</p></div>`).join('')}
      <p class="note">Batch agrees with the teacher's ratings at r = ${x.rTeacher.toFixed(2)}.</p>`:''}
  </section>`).join(''):`<div class="card empty-state">${IC('book')}<h2>No exams in this branch yet</h2><p>Only Kota has a live batch in this build.</p></div>`}`;
}

/* ================= COMPANY ================= */
function renderCompany(){
  const d=COMPANY, p=$('#pane-company');
  p.innerHTML=`<div class="h-row"><div><h1 class="h1">Allen Career Institute</h1><div class="sub">${d.exams.length} exams · ${+d.students} students · question bank review</div></div></div>
  <section class="card panel" aria-labelledby="c-ex"><h2 class="panel-t" id="c-ex">Exams</h2>
    <div class="tbl-wrap"><table><thead><tr><th scope="col">Exam</th><th scope="col">Date</th><th scope="col">Rated</th><th scope="col">Comfort</th><th scope="col">Batch agrees with teacher</th><th scope="col">Students read like teacher</th></tr></thead><tbody>
    ${d.exams.map(x=>`<tr><td class="w">${esc(x.exam.title)}</td><td>${fmtDate(x.exam.examDate)}</td><td class="mono">${+x.surveys}</td><td class="mono">${x.comfort==null?'—':Math.round(x.comfort*100)+'%'}</td>
      <td class="mono">${x.rTeacher==null?'—':'r = '+x.rTeacher.toFixed(2)}</td><td class="mono">${x.avgCalib??'—'}</td></tr>`).join('')}</tbody></table></div></section>
  <section class="card panel" aria-labelledby="c-rev"><h2 class="panel-t" id="c-rev">Questions to review <small>batch felt ≥1 level away from the teacher's rating</small></h2>
    ${d.review.length?d.review.map(r=>`<div class="alert ${r.gap>0?'r':'k'} ${r.reviewed?'retired':''}"><div class="alert-h">${esc(r.exam)} · ${esc(r.qid)} · ${topicName(r.topic)} ${r.reviewed?'<span class="pill ok">reviewed</span>':''}</div>
      <p>${esc(r.text)}</p><div class="cmp"><span><span class="muted small">teacher</span><b>${pill(r.teacherBand)}</b></span><span><span class="muted small">batch felt</span><b>${feltWord(r.felt)} (${feltNum(r.felt)})</b></span><span><span class="muted small">gap</span><b class="${r.gap>0?'t-r':''}">${sgn(r.gap)}</b></span></div>
      <div class="btn-row mt8"><button type="button" class="btn sm" data-act="review" data-arg="${esc(r.examId)}|${esc(r.qid)}|${r.reviewed?'0':'1'}">${r.reviewed?IC('undo')+' Undo':'Mark reviewed'}</button></div></div>`).join('')
      :'<p class="empty">Every question felt about as hard as its teacher rated it.</p>'}
  </section>`;
}
ACT.review=async arg=>{
  const [exam,qid,on]=arg.split('|');
  try{ await API.post('/api/company/review',{exam,qid,done:on==='1'}); COMPANY=await API.get('/api/company/overview'); renderCompany(); toast(on==='1'?`${IC('check')} Marked reviewed`:'Review undone') }
  catch(e){ toast(esc(e.message)) }
};


/* ================= ACCOUNT SHELL: sidebar · profile · settings =================
   Everything a user changes here is saved to their MongoDB user document. */
let VIEW='dash', PROFILE=null;
const initials=n=>String(n||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase();
const NAV={
  student:[['report','My report','home'],['learn','Courses','book'],['surveys','Surveys','clock'],['history','History','ceiling']],
  teacher:[['dash','Exams & results','grid']], branch:[['dash','Branch overview','grid']], company:[['dash','Company overview','grid']]
};
function applyPrefs(){
  const pr=ME?.prefs||{};
  document.documentElement.classList.toggle('rm',!!pr.reduceMotion);
  const side=$('#side'); side.classList.toggle('mini',!!pr.sidebarCollapsed);
  const t=$('#sideToggle'); t.innerHTML=IC(pr.sidebarCollapsed?'chevR':'chevL');
  t.setAttribute('aria-label',pr.sidebarCollapsed?'Expand sidebar':'Collapse sidebar'); t.setAttribute('aria-expanded',String(!pr.sidebarCollapsed));
}
function renderSide(){
  if(!ME) return;
  $('#sideAcc').innerHTML=`<span class="av" aria-hidden="true">${esc(initials(ME.name))}</span>
    <span class="acc-meta"><span class="nm">${esc(ME.name)}</span><span class="rl">${ROLE_LABEL[ROLE]}</span></span>`;
  const cur=VIEW!=='dash'?VIEW:(ROLE==='student'?SVIEW:'dash');
  const item=([k,l,ic],badge)=>`<button type="button" class="side-link ${cur===k?'on':''}" data-act="nav" data-arg="${k}" ${cur===k?'aria-current="page"':''} title="${l}">
      <span class="si">${IC(ic)}</span><span class="sl">${l}</span>${badge?`<span class="cnt" aria-label="${badge} pending">${badge}</span>`:''}</button>`;
  $('#sideNav').innerHTML=`<div class="side-h">Dashboard</div>
    ${NAV[ROLE].map(x=>item(x,x[0]==='surveys'&&NOTIF.pending?NOTIF.pending:0)).join('')}
    <div class="side-h">Account</div>
    ${item(['profile','Profile','user'])}${item(['settings','Settings','gear'])}`;
  $('#burger').innerHTML=IC('menu');
  applyTheme(THEME_PREF);
}
ACT.nav=k=>{
  closeSide();
  if(k==='profile'||k==='settings'){ VIEW=k; return show().then(()=>$('#appMain').focus({preventScroll:true})) }
  if(ROLE==='student'&&k!=='dash') return ACT.sview(k);
  VIEW='dash'; show();
};
ACT.sideToggle=async()=>{
  ME.prefs.sidebarCollapsed=!ME.prefs.sidebarCollapsed; applyPrefs();
  try{ await API.patch('/api/me/prefs',{sidebarCollapsed:ME.prefs.sidebarCollapsed}) }catch(e){ toast(esc(e.message)) }
};
function openSide(){ $('#side').classList.add('open'); $('#sideScrim').hidden=false; $('#burger').setAttribute('aria-expanded','true'); $('#side .side-link.on, #side .side-link')?.focus() }
function closeSide(){ $('#side')?.classList.remove('open'); if($('#sideScrim')) $('#sideScrim').hidden=true; $('#burger')?.setAttribute('aria-expanded','false') }
ACT.sideOpen=()=>openSide(); ACT.sideClose=()=>closeSide();
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&$('#side')?.classList.contains('open')){ closeSide(); $('#burger').focus() } });

/* ---- profile ---- */
async function renderProfile(){
  const {profile:P}=await API.get('/api/me/profile'); PROFILE=P;
  const row=(k,v)=>v==null||v===''?'':`<div class="kv"><span>${k}</span><b>${v}</b></div>`;
  const when=d=>d?new Date(d).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
  $('#pane-profile').innerHTML=`
  <div class="h-row"><div><h1 class="h1">Profile</h1><div class="sub">Your account as the institute holds it.</div></div></div>
  <div class="g21">
    <section class="card panel prof" aria-labelledby="pf-h">
      <div class="prof-top"><span class="av big" aria-hidden="true">${esc(initials(P.name))}</span>
        <div><h2 class="h2" id="pf-h">${esc(P.name)}</h2><span class="muted">${esc(P.email)}</span><div class="mt8"><span class="pill l2">${ROLE_LABEL[P.role]}</span></div></div></div>
      <form id="pfForm" class="mt18" novalidate>
        <label class="lbl" for="pfName">Display name</label>
        <div class="inline-form"><input id="pfName" class="in" maxlength="60" value="${esc(P.name)}" autocomplete="name">
          <button type="submit" class="btn p">Save</button></div>
        <div id="pfMsg" class="err" role="status" aria-live="polite"></div>
        ${P.role==='student'?`<p class="note">This changes how your name appears in the app. Your official record — <b>${esc(P.officialName||'')}</b> — stays as the institute has it.</p>`:''}
      </form>
    </section>
    <section class="card panel" aria-labelledby="pf-d">
      <h2 class="panel-t" id="pf-d">Details</h2>
      ${row('E-mail',esc(P.email))}${row('Role',ROLE_LABEL[P.role])}
      ${row('Roll number',P.roll?esc(P.roll):'')}${row('Batch',P.batch?esc(P.batch):'')}${row('Batches',P.batches?esc(P.batches.join(', ')):'')}
      ${row('Branch',P.branchName?esc(P.branchName):'')}
      ${row('Surveys submitted',P.surveys!=null?+P.surveys:'')}${row('Exams in history',P.exams!=null&&P.role==='student'?+P.exams:'')}${row('Exams created',P.role==='teacher'?+P.exams:'')}
      ${row('Member since',when(P.createdAt))}${row('Last sign-in',when(P.lastLoginAt))}
      <div class="btn-row mt18"><button type="button" class="btn sm" data-act="nav" data-arg="settings">${IC('gear')} Settings &amp; security</button></div>
    </section>
  </div>`;
  $('#pfForm').addEventListener('submit',async e=>{
    e.preventDefault(); const v=$('#pfName').value.trim(), m=$('#pfMsg');
    if(v.length<2){ m.className='err on'; m.textContent='Name must be at least 2 characters.'; $('#pfName').setAttribute('aria-invalid','true'); return }
    try{ const r=await API.patch('/api/me/profile',{name:v}); ME.name=r.name; renderSide(); m.className='route on'; m.textContent='✓ Saved'; $('#pfName').removeAttribute('aria-invalid'); $('.prof-top .h2').textContent=r.name; $('.prof-top .av').textContent=initials(r.name) }
    catch(err){ m.className='err on'; m.textContent=err.message }
  });
}

/* ---- settings ---- */
async function renderSettings(){
  const pr=ME.prefs||{}, {sessions}=await API.get('/api/me/sessions');
  const seg=(name,val,opts)=>`<div class="seg" role="radiogroup" aria-label="${name}">${opts.map(([v,l,ic])=>`<button type="button" role="radio" class="seg-b ${val===v?'on':''}" aria-checked="${val===v}" data-act="pref" data-arg="${name}:${v}">${ic?IC(ic):''}${l}</button>`).join('')}</div>`;
  const tog=(k,label,help)=>`<div class="set-row"><div><b>${label}</b><span class="muted small">${help}</span></div>
      <button type="button" role="switch" class="switch ${pr[k]?'on':''}" aria-checked="${!!pr[k]}" data-act="pref" data-arg="${k}:${!pr[k]}" aria-label="${label}"><span></span></button></div>`;
  $('#pane-settings').innerHTML=`
  <div class="h-row"><div><h1 class="h1">Settings</h1><div class="sub">Saved to your account, so they follow you to any device.</div></div></div>
  <div class="g2">
    <section class="card panel" aria-labelledby="st-a">
      <h2 class="panel-t" id="st-a">${IC('monitor')} Appearance</h2>
      <div class="set-row"><div><b>Theme</b><span class="muted small">System follows your device</span></div>${seg('theme',pr.theme||'light',[['light','Light','sun'],['dark','Dark','moon'],['system','System','monitor']])}</div>
      ${tog('reduceMotion','Reduce motion','Turns off animations and smooth scrolling')}
      ${tog('sidebarCollapsed','Compact sidebar','Show icons only on wide screens')}
      ${ROLE==='student'?tog('surveyBanner','Survey reminder banner','Show the pending-survey banner on your pages'):''}
    </section>
    <section class="card panel" aria-labelledby="st-p">
      <h2 class="panel-t" id="st-p">${IC('lock')} Change password</h2>
      <form id="pwForm" novalidate>
        <label class="lbl" for="pwCur">Current password</label><input id="pwCur" class="in" type="password" autocomplete="current-password" maxlength="128">
        <label class="lbl" for="pwNew">New password</label><input id="pwNew" class="in" type="password" autocomplete="new-password" maxlength="128" aria-describedby="pwHelp">
        <p class="note" id="pwHelp">At least 8 characters, with a letter and a number. Every other device is signed out.</p>
        <label class="lbl" for="pwNew2">Confirm new password</label><input id="pwNew2" class="in" type="password" autocomplete="new-password" maxlength="128">
        <div id="pwMsg" class="err" role="status" aria-live="polite"></div>
        <button type="submit" class="btn p mt12">Update password</button>
      </form>
    </section>
  </div>
  <div class="g2">
    <section class="card panel" aria-labelledby="st-s">
      <h2 class="panel-t" id="st-s">${IC('shield')} Where you are signed in</h2>
      ${sessions.map(x=>`<div class="kv"><span>${esc(x.device)}${x.current?' <span class="pill ok">this device</span>':''}</span><b class="muted small">since ${new Date(x.createdAt).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</b></div>`).join('')}
      <div class="btn-row mt12">${sessions.length>1?`<button type="button" class="btn sm" data-act="endOthers">Sign out other devices (${sessions.length-1})</button>`:'<span class="note">Only this device is signed in.</span>'}</div>
    </section>
    <section class="card panel" aria-labelledby="st-d">
      <h2 class="panel-t" id="st-d">${IC('download')} Your data</h2>
      <p class="note">Download everything ANUMAAN stores about you — account, ${ROLE==='student'?'surveys, history, notifications, ':''}and your recent activity — as a JSON file.</p>
      <div class="btn-row mt12"><button type="button" class="btn sm" data-act="exportMe">${IC('download')} Download my data</button></div>
    </section>
  </div>`;
  $('#pwForm').addEventListener('submit',async e=>{
    e.preventDefault(); const m=$('#pwMsg'), cur=$('#pwCur').value, nw=$('#pwNew').value, nw2=$('#pwNew2').value;
    const bad=(msg,f)=>{ m.className='err on'; m.textContent=msg; $(f).setAttribute('aria-invalid','true'); $(f).focus() };
    $$('#pwForm .in').forEach(x=>x.removeAttribute('aria-invalid'));
    if(!cur) return bad('Enter your current password.','#pwCur');
    if(nw.length<8||!/[a-z]/i.test(nw)||!/\d/.test(nw)) return bad('New password needs at least 8 characters, with a letter and a number.','#pwNew');
    if(nw!==nw2) return bad('The two new passwords do not match.','#pwNew2');
    try{ const r=await API.post('/api/me/password',{current:cur,next:nw}); $('#pwForm').reset(); m.className='route on';
      m.textContent=`✓ Password updated${r.otherSessionsEnded?` · ${r.otherSessionsEnded} other device${r.otherSessionsEnded===1?'':'s'} signed out`:''}`; }
    catch(err){ bad(err.message,/current/i.test(err.message)?'#pwCur':'#pwNew') }
  });
}
ACT.pref=async arg=>{
  const [k,v]=arg.split(':'); const body={[k]:k==='theme'?v:v==='true'};
  try{ const r=await API.patch('/api/me/prefs',body); ME.prefs=r.prefs; applyTheme(r.prefs.theme); applyPrefs(); await renderSettings();
    $(`[data-act="pref"][data-arg^="${k}:"]`)?.focus(); toast(`${IC('check')} Saved`) }
  catch(e){ toast(esc(e.message)) }
};
ACT.endOthers=async()=>{ try{ const r=await API.del('/api/me/sessions/others'); await renderSettings(); toast(`${IC('check')} ${r.ended} other device${r.ended===1?'':'s'} signed out`) }catch(e){ toast(esc(e.message)) } };
ACT.exportMe=async()=>{
  try{ const data=await API.get('/api/me/export');
    const b=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='anumaan-my-data.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); toast(`${IC('download')} Your data was downloaded`) }
  catch(e){ toast(esc(e.message)) }
};

/* ---------- start ---------- */
boot(false);
