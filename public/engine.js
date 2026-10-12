/* ============================================================
   ANUMAAN ENGINE  (isomorphic: browser + Node)
   generateSample()  — deterministic synthetic batch (used once, to seed MongoDB)
   analyze(data)     — the real computation pipeline, run on whatever
                       questions / students / responses the database holds.
   ============================================================ */
(function(root){
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const sig=x=>1/(1+Math.exp(-x));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function avg(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:NaN}
function std(a){const m=avg(a);return Math.sqrt(avg(a.map(x=>(x-m)**2)))}
function pearson(a,b){
  const ma=avg(a),mb=avg(b);
  let n=0,da=0,db=0;
  for(let i=0;i<a.length;i++){n+=(a[i]-ma)*(b[i]-mb);da+=(a[i]-ma)**2;db+=(b[i]-mb)**2}
  return (da&&db)? n/Math.sqrt(da*db) : 0;
}

/* ---------- taxonomy ---------- */
const TOPICS=[
  {id:'kin', name:'Kinematics',        chapter:'Motion in a Plane'},
  {id:'nlm', name:"Newton's Laws",     chapter:'Laws of Motion'},
  {id:'rot', name:'Rotational Motion', chapter:'System of Particles'},
  {id:'thm', name:'Thermodynamics',    chapter:'Heat & Thermo'}
];
const BANDS=[
  {id:'L1',name:'L1 Basic',    color:'#3DD68C', lo:0.75, hi:1.01},
  {id:'L2',name:'L2 Moderate', color:'#4A9EFF', lo:0.50, hi:0.75},
  {id:'L3',name:'L3 Advanced', color:'#FFB020', lo:0.25, hi:0.50},
  {id:'L4',name:'L4 Elite',    color:'#FF5A5F', lo:-0.01,hi:0.25}
];
const bandOf=p=>BANDS.find(b=>p>b.lo&&p<=b.hi)||BANDS[3];
const bandIdx=id=>BANDS.findIndex(b=>b.id===id);
const RATING=['Normal','Medium','Hard','Very Hard'];

/* ---------- item bank : 48 items, 12 per topic, 3 per target band ----------
   illusion:  -1 = looks easy but is hard (trap)   +1 = looks hard but is easy (scare)
------------------------------------------------------------------------- */
const RAW=[
/* --- KINEMATICS --- */
['kin',1,'A ball is thrown vertically up with 20 m/s. Time to return to thrower?',['2 s','4 s','1 s','8 s'],1,0],
['kin',1,'A body moves 40 m east then 30 m north. Magnitude of displacement?',['70 m','50 m','10 m','35 m'],1,0],
['kin',1,'Slope of a position–time graph represents:',['Acceleration','Velocity','Force','Displacement'],1,0],
['kin',2,'Two balls dropped 1 s apart. Separation after the second has fallen 2 s?',['15 m','25 m','5 m','20 m'],1,0],
['kin',2,'A projectile at 45° has range 100 m. Maximum height reached?',['50 m','25 m','100 m','12.5 m'],1,0],
['kin',2,'River 200 m wide flows at 3 m/s. Swimmer 5 m/s aims straight across. Drift?',['100 m','120 m','60 m','150 m'],1,1],
['kin',3,'Particle: x = 3t² − 2t³. Time at which acceleration is zero?',['0.5 s','1 s','0.25 s','2 s'],0,-1],
['kin',3,'A lift accelerates up at 2 m/s². Stone dropped inside hits floor 2 m below in:',['0.58 s','0.64 s','0.45 s','0.71 s'],0,0],
['kin',3,'Relative velocity of rain w.r.t. a man walking at 4 m/s if rain falls at 3 m/s vertically:',['5 m/s at 53° from vertical','5 m/s at 37° from vertical','7 m/s','1 m/s'],1,-1],
['kin',4,'A particle moves with v = k√x. Displacement in time t is proportional to:',['t²','t','t^1.5','t^0.5'],0,0],
['kin',4,'Two projectiles same range, angles θ and 90−θ. Ratio of maximum heights:',['tan²θ','tanθ','1','cot²θ'],0,0],
['kin',4,'A wheel rolls without slipping. Speed of the topmost point w.r.t. ground:',['2v','v','0','1.5v'],0,0],

/* --- NEWTON'S LAWS --- */
['nlm',1,'Action and reaction forces act on:',['The same body','Different bodies','Nothing','The ground'],1,0],
['nlm',1,'A 5 kg block on a frictionless floor pushed with 10 N. Acceleration?',['2 m/s²','5 m/s²','50 m/s²','0.5 m/s²'],0,0],
['nlm',1,'Weight of a body in a freely falling lift appears:',['Doubled','Zero','Unchanged','Halved'],1,0],
['nlm',2,'Block on incline 30°, μ = 0.2. Does it slide?',['Yes','No','Only if pushed','Cannot say'],0,0],
['nlm',2,'Two blocks 3 kg and 2 kg connected, pulled with 10 N. Tension in string?',['4 N','6 N','10 N','2 N'],0,0],
['nlm',2,'Minimum force to just move a 10 kg block, μs = 0.5:',['50 N','25 N','100 N','5 N'],0,1],
['nlm',3,'Monkey climbs a rope with acceleration a. Tension in rope is:',['m(g+a)','m(g−a)','mg','ma'],0,0],
['nlm',3,'Block on accelerating wedge, no relative slipping. Required acceleration:',['g tanθ','g sinθ','g cosθ','g cotθ'],0,-1],
['nlm',3,'Man of 60 kg in lift accelerating down at 2 m/s². Reading of weighing machine:',['48 kg','60 kg','72 kg','0 kg'],0,0],
['nlm',4,'Chain of length L on a table, fraction hanging just about to slip, μ:',['μ/(1+μ)','μ','1/μ','μ/(1−μ)'],0,0],
['nlm',4,'Pulley system: 3 kg and 5 kg over a massless pulley. Acceleration:',['2.5 m/s²','1.25 m/s²','5 m/s²','10 m/s²'],0,0],
['nlm',4,'Friction acts on a rolling wheel driven by torque. Its direction is:',['Forward','Backward','Zero','Upward'],0,-1],

/* --- ROTATIONAL MOTION --- */
['rot',1,'SI unit of moment of inertia:',['kg m²','kg m','N m','kg/m²'],0,0],
['rot',1,'Angular velocity of the second hand of a clock:',['π/30 rad/s','2π rad/s','π rad/s','π/60 rad/s'],0,0],
['rot',1,'Torque is maximum when force and radius vector are at:',['0°','90°','45°','180°'],1,0],
['rot',2,'Moment of inertia of a ring about its central axis:',['MR²','MR²/2','2MR²/5','MR²/12'],0,0],
['rot',2,'A disc and a ring of same mass and radius roll down. Which reaches first?',['Disc','Ring','Together','Depends on incline'],0,0],
['rot',2,'Angular momentum is conserved when:',['Net external torque is zero','Net force is zero','Energy is zero','Always'],0,0],
['rot',3,'Direction of torque when a wheel is speeding up clockwise (viewed from front):',['Into the page','Out of the page','Along radius','Tangential'],0,-1],
['rot',3,'Rolling without slipping: friction on the body does work equal to:',['Zero','Negative','Positive','mgh'],0,-1],
['rot',3,'A rod pivoted at one end released from horizontal. Angular acceleration initially:',['3g/2L','g/L','2g/3L','g/2L'],0,0],
['rot',4,'Ratio of KE of rolling to sliding for a solid sphere at same v:',['7/5','5/7','1','2'],0,0],
['rot',4,'A person on a rotating stool pulls arms in. Kinetic energy:',['Increases','Decreases','Unchanged','Becomes zero'],0,-1],
['rot',4,'Minimum speed at the top of a vertical loop for a rolling solid sphere:',['√(gR)','√(2gR)','√(5gR)','√(gR/2)'],0,0],

/* --- THERMODYNAMICS --- */
['thm',1,'First law of thermodynamics is a statement of:',['Momentum conservation','Energy conservation','Charge conservation','Mass conservation'],1,0],
['thm',1,'In an isothermal process, change in internal energy of an ideal gas is:',['Zero','Positive','Negative','nRT'],0,0],
['thm',1,'Unit of entropy:',['J/K','J','J·K','K/J'],0,0],
['thm',2,'Work done in an isobaric expansion from V to 2V at pressure P:',['PV','2PV','PV/2','0'],0,0],
['thm',2,'Efficiency of a Carnot engine between 400 K and 300 K:',['25%','33%','75%','100%'],0,0],
['thm',2,'For an adiabatic process, PVʸ is:',['Constant','Zero','Increasing','Decreasing'],0,1],
['thm',3,'Two moles of gas expand adiabatically, T falls 300→200 K. Work done by gas (Cv=3R/2):',['2493 J','1246 J','4986 J','831 J'],0,0],
['thm',3,'In a cyclic process, net change in internal energy over one full cycle:',['Zero','Equal to work','Equal to heat','Negative'],0,0],
['thm',3,'Slope of adiabatic curve compared to isothermal at the same point:',['Steeper','Flatter','Same','Zero'],0,0],
['thm',4,'Mixture: 1 mol monatomic + 1 mol diatomic. Effective γ:',['1.5','1.4','1.67','1.33'],0,0],
['thm',4,'Free expansion of an ideal gas into vacuum: which is true?',['ΔU=0, W=0, Q=0','ΔU>0','W>0','Q>0'],0,-1],
['thm',4,'Entropy change of the universe in any real irreversible process:',['Increases','Decreases','Zero','Undefined'],0,0]
];

/* deliberately faulty items — correctness independent of ability (discrimination ≈ 0) */
const BROKEN_IDS=['Q23','Q44'];


function generateSample(seed){
const rnd = mulberry32(seed||20260825);
const gauss=()=>{let u=0,v=0;while(!u)u=rnd();while(!v)v=rnd();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)};
const QUESTIONS = RAW.map((r,i)=>({
  id:'Q'+(i+1), n:i+1, topic:r[0], targetBand:r[1], text:r[2],
  options:r[3], answer:r[4], illusion:r[5],
  latent: {1:-1.55, 2:-0.25, 3:0.95, 4:2.15}[r[1]] + gauss()*0.16,
  /* item-level perception bias: the whole batch mis-reads this item the same way.
     This is what keeps felt-difficulty from being a perfect copy of real difficulty. */
  pbias: gauss()*0.92,
  broken: BROKEN_IDS.includes('Q'+(i+1)),
  lure: (()=>{let k=(r[4]+1)%4; return k;})()
}));

/* batch-level topic strengths — this cohort is genuinely weak in rotation */
const TOPIC_OFFSET={kin:0.30, nlm:0.00, rot:-0.62, thm:0.12};

/* ---------- students ---------- */
const FIRST=['Aarav','Diya','Rohan','Ananya','Kabir','Ishita','Vivaan','Meera','Arjun','Sneha','Rudra','Tanvi','Yash','Nikita','Aditya','Priya','Karan','Riya','Sahil','Pooja','Manav','Aisha','Dev','Kritika','Harsh','Simran','Ayush','Neha','Om','Bhavya','Raghav','Anika','Naman','Jiya','Parth','Shreya','Tejas','Ira','Veer','Kavya'];
const LAST=['Sharma','Verma','Patel','Reddy','Nair','Iyer','Singh','Gupta','Joshi','Mehta','Rao','Das','Kapoor','Bose','Malhotra','Chauhan','Pillai','Sinha','Bhat','Kulkarni'];

const STUDENTS = Array.from({length:40},(_,i)=>{
  const base = gauss()*0.95 + (i===0? 0.15 : 0);
  const ability={};
  TOPICS.forEach((t,ti)=>{
    let a = base + gauss()*0.55 + TOPIC_OFFSET[t.id];
    if(i===0){ // Aarav — deliberate profile: strong kinematics, wall in rotation
      a = {kin:2.25, nlm:0.45, rot:-0.70, thm:0.30}[t.id];
    }
    ability[t.id]=a;
  });
  // self-awareness trait: how well he judges difficulty (0.3 poor .. 1 sharp)
  const sense = clamp(0.55 + gauss()*0.22 + (i===0?-0.05:0), .2, .98);
  return {
    id:'S'+(i+1), roll:'A27-'+String(i+1).padStart(3,'0'),
    name: FIRST[i]+' '+LAST[i%LAST.length],
    ability, sense
  };
});

/* ---------- reference pool ----------
   Bands are NOT self-normalised on this one batch. They come from the calibrated
   pool (past-year anchor items link every batch onto the same scale), so a batch
   can genuinely be weaker or stronger than the pool inside a given band. */
const POOL=Array.from({length:320},()=>{
  const base=gauss()*1.0, ab={};
  TOPICS.forEach(t=>ab[t.id]=base+gauss()*0.6);
  return ab;
});
const POOL_P={};
QUESTIONS.forEach(q=>{
  if(q.broken){POOL_P[q.id]=0.34;return}
  POOL_P[q.id]=avg0(POOL.map(ab=>sig(1.25*(ab[q.topic]-q.latent))));
});
function avg0(a){return a.reduce((x,y)=>x+y,0)/a.length}

/* ---------- response matrix ---------- */
const R = {}; // R[studentId][qid] = {chosen, correct, selfR, batchR}
STUDENTS.forEach(s=>{
  R[s.id]={};
  QUESTIONS.forEach(q=>{
    const a=s.ability[q.topic];
    // broken item: outcome unrelated to ability → discrimination collapses
    const p = q.broken ? 0.34 : sig(1.25*(a-q.latent));
    const correct = rnd()<p;
    let chosen;
    if(correct) chosen=q.answer;
    else {
      // shared misconception: lure option pulls most wrong answers
      if(rnd()< (q.illusion<0?0.72:0.55)) chosen=q.lure;
      else{ do{chosen=Math.floor(rnd()*4)}while(chosen===q.answer) }
    }
    // ---- FELT difficulty (self) ----
    // personal hardness, shifted by the item's shared misreading + personal noise
    let felt = (q.latent - a)*0.80 + q.illusion*(-1.25) + q.pbias + gauss()*(1.15 - s.sense*0.7);
    const selfR = felt<-0.85?1 : felt<0.05?2 : felt<0.95?3 : 4;
    // ---- BATCH prediction ----
    let bp = q.latent*0.85 + q.illusion*(-1.15) + q.pbias*1.05 + gauss()*(1.25-s.sense) + (a*-0.18);
    const batchR = bp<-0.85?1 : bp<0.05?2 : bp<0.95?3 : 4;
    R[s.id][q.id]={chosen, correct, selfR, batchR};
  });
});


QUESTIONS.forEach(q=>q.poolP=POOL_P[q.id]);
return {questions:QUESTIONS, students:STUDENTS, R};
}

function analyze(data){
const QUESTIONS=data.questions, STUDENTS=data.students, R=data.R;
/* blind spot = rated it easy (Normal/Medium) and got it wrong; a skipped answer (chosen<0) is not a misconception */
const isBlind=r=>!r.correct && r.chosen>=0 && r.selfR!=null && r.selfR<=2;
const ratedPearson=(xs,ys)=>{const a=[],b=[];xs.forEach((x,i)=>{if(x!=null){a.push(x);b.push(ys[i])}});return a.length>=3?pearson(a,b):0};
const NS=STUDENTS.length;
const POOL_P={}; QUESTIONS.forEach(q=>POOL_P[q.id]=q.poolP);
/* ============================================================
   PIPELINE
   ============================================================ */

/* --- total scores (for discrimination) --- */
const TOTAL={}; STUDENTS.forEach(s=>TOTAL[s.id]=QUESTIONS.filter(q=>R[s.id][q.id].correct).length);

/* --- item statistics --- */
const QSTAT={};
QUESTIONS.forEach(q=>{
  const rows=STUDENTS.map(s=>R[s.id][q.id]);
  const nC=rows.filter(r=>r.correct).length;
  const p=nC/rows.length;              // this batch's correct rate
  const band=bandOf(POOL_P[q.id]);     // calibrated band from the anchored pool
  const poolP=POOL_P[q.id];
  // ratings can be missing (student skipped the survey) — average over the ones we have
  const rated=rows.filter(r=>r.selfR!=null), bRated=rows.filter(r=>r.batchR!=null);
  const felt = rated.length? rated.reduce((a,r)=>a+r.selfR,0)/rated.length : null;
  const batch= bRated.length? bRated.reduce((a,r)=>a+r.batchR,0)/bRated.length : null;
  const dist=[0,0,0,0]; rows.forEach(r=>dist[r.chosen]++);
  // wrong answers only
  const wrong=rows.filter(r=>!r.correct);
  const wdist=[0,0,0,0]; wrong.forEach(r=>wdist[r.chosen]++);
  const topLure=wdist.indexOf(Math.max(...wdist));
  // discrimination : point-biserial
  const m1=avg(rows.map((r,i)=>r.correct?TOTAL[STUDENTS[i].id]:null).filter(x=>x!==null));
  const m0=avg(rows.map((r,i)=>!r.correct?TOTAL[STUDENTS[i].id]:null).filter(x=>x!==null));
  const sd =std(STUDENTS.map(s=>TOTAL[s.id]));
  const disc = (isFinite(m1)&&isFinite(m0)&&sd>0) ? ((m1-m0)/sd)*Math.sqrt(p*(1-p)) : 0;
  // illusion index : felt (norm 0..1) minus real hardness (0..1)
  const realN=1-p;
  const ill = felt==null ? 0 : (felt-1)/3-realN;
  let flag='aligned';
  if(ill<-0.18 && p<0.58) flag='trap';
  else if(ill>0.18 && p>0.55) flag='scare';
  if(disc<0.10) flag='broken';
  // blind-spot count : rated ≤ Medium and wrong
  const blind=rows.filter(r=>isBlind(r)).length;
  const fear =rows.filter(r=> r.correct && r.selfR===4).length;
  QSTAT[q.id]={p,poolP,nC,band,felt,batch,dist,wdist,topLure,disc,ill,flag,blind,fear};
});

/* --- per-student : per-topic per-band accuracy + ceiling --- */
function bandAccuracy(sid, topic, bandId){
  const qs=QUESTIONS.filter(q=>q.topic===topic && QSTAT[q.id].band.id===bandId);
  if(!qs.length) return null;
  let w=0, got=0;
  qs.forEach(q=>{
    const r=R[sid][q.id];
    // guess-discount: called it Very Hard and got it right → weight 0.4
    const weight = (r.correct && r.selfR===4) ? 0.75 : 1;
    w+=1; got += r.correct? weight : 0;
  });
  return {acc:got/w, n:qs.length};
}
function ceilingOf(sid, topic){
  let ceil=null;
  BANDS.forEach(b=>{
    const r=bandAccuracy(sid,topic,b.id);
    if(r && r.n>=2 && r.acc>=0.55) ceil=b.id;
  });
  return ceil||'—';
}
const CEIL={};
STUDENTS.forEach(s=>{CEIL[s.id]={};TOPICS.forEach(t=>CEIL[s.id][t.id]=ceilingOf(s.id,t.id))});

/* --- batch median ceiling per topic --- */
const BATCH_CEIL={};
TOPICS.forEach(t=>{
  const idx=STUDENTS.map(s=>CEIL[s.id][t.id]==='—'?-1:bandIdx(CEIL[s.id][t.id])).sort((a,b)=>a-b);
  const m=idx[Math.floor(idx.length/2)];
  BATCH_CEIL[t.id]= m<0?'—':BANDS[m].id;
});

/* --- batch heatmap : topic × band accuracy --- */
const HEAT={};
TOPICS.forEach(t=>{
  HEAT[t.id]={};
  BANDS.forEach(b=>{
    const qs=QUESTIONS.filter(q=>q.topic===t.id && QSTAT[q.id].band.id===b.id);
    if(!qs.length){HEAT[t.id][b.id]=null;return}
    let tot=0,c=0;
    qs.forEach(q=>STUDENTS.forEach(s=>{tot++;if(R[s.id][q.id].correct)c++}));
    HEAT[t.id][b.id]={acc:c/tot, n:qs.length};
  });
});

/* --- per-student diagnostics --- */
function studentReport(sid){
  const s=STUDENTS.find(x=>x.id===sid);
  const blind=[], fear=[];
  QUESTIONS.forEach(q=>{
    const r=R[sid][q.id];
    if(isBlind(r)) blind.push({q, r, shared: QSTAT[q.id].wdist[r.chosen]/Math.max(1,NS-QSTAT[q.id].nC)});
    if(r.correct && r.selfR===4)  fear.push({q,r});
  });
  // batch sense : correlation between his batchR and true hardness
  const ys=QUESTIONS.map(q=>1-QSTAT[q.id].p);
  const sense=Math.round(clamp(ratedPearson(QUESTIONS.map(q=>R[sid][q.id].batchR),ys),0,1)*100);
  const senseBatch=Math.round(avg(STUDENTS.map(o=>{
    return clamp(ratedPearson(QUESTIONS.map(q=>R[o.id][q.id].batchR),ys),0,1)*100;
  })));
  // self-predicted score from own ratings vs actual
  const ratedQ=QUESTIONS.filter(q=>R[sid][q.id].selfR!=null);
  const predicted=ratedQ.length? Math.round(ratedQ.filter(q=>R[sid][q.id].selfR<=2).length/ratedQ.length*100) : null;
  const actual=Math.round(TOTAL[sid]/QUESTIONS.length*100);
  // topic positions
  const topics=TOPICS.map(t=>{
    const my=CEIL[sid][t.id], bt=BATCH_CEIL[t.id];
    const mi=my==='—'?-1:bandIdx(my), bi=bt==='—'?-1:bandIdx(bt);
    const peers=STUDENTS.map(o=>CEIL[o.id][t.id]==='—'?-1:bandIdx(CEIL[o.id][t.id]));
    const pct=Math.round(peers.filter(v=>v<mi).length/peers.length*100);
    const bands=BANDS.map(b=>({b, r:bandAccuracy(sid,t.id,b.id)}));
    const nblind=blind.filter(x=>x.q.topic===t.id).length;
    return {t, my, bt, delta: mi-bi, pct, bands, nblind};
  });
  // focus ranking
  const focus=[...topics].map(o=>({
    ...o, score: Math.max(0,-o.delta)*3 + o.nblind*1.6 + (o.my==='—'?3:0) - (o.delta>0?1.5:0)
  })).sort((a,b)=>b.score-a.score);
  return {s, blind, fear, sense, senseBatch, predicted, actual, topics, focus, score:TOTAL[sid]};
}


/* --- batch-level diagnostics --- */
function batchReport(){
  // shared blind spots: trap flag, sorted by how many students share the same wrong option
  const shared=QUESTIONS.map(q=>{
    const st=QSTAT[q.id];
    const nWrong=NS-st.nC;
    const share= nWrong? st.wdist[st.topLure]/nWrong : 0;
    const unaware=STUDENTS.filter(s=>isBlind(R[s.id][q.id])).length;
    return {q, st, nShare:st.wdist[st.topLure], share, unaware};
  }).filter(x=>x.nShare>=11 && x.st.p<0.52 && x.unaware>=6)
    .sort((a,b)=>(b.unaware*2+b.nShare)-(a.unaware*2+a.nShare));

  const traps =QUESTIONS.filter(q=>QSTAT[q.id].flag==='trap');
  const scares=QUESTIONS.filter(q=>QSTAT[q.id].flag==='scare');
  const broken=QUESTIONS.filter(q=>QSTAT[q.id].flag==='broken');

  // topic priority
  const prio=TOPICS.map(t=>{
    // students who cannot yet hold L2 — the working band for this cohort
    const below=STUDENTS.filter(s=>{
      const c=CEIL[s.id][t.id];
      return c==='—' || bandIdx(c) < bandIdx('L2');
    }).length;
    const h=HEAT[t.id];
    const l1=h.L1?h.L1.acc:1, l2=h.L2?h.L2.acc:1, l3=h.L3?h.L3.acc:1;
    let verdict, action;
    if(l1<0.80){verdict='Foundation gap';action='The batch is dropping through the BASIC band. Re-teach the concept — do not drill harder problems, it will not help.'}
    else if(l2<0.50){verdict='Foundation gap';action='Basics hold but the batch collapses at Moderate. This is the concept, not the difficulty. Re-teach.'}
    else if(l3<0.42){verdict='Stretch gap';action='Foundation is solid. Add Advanced problem sets only — no need to re-teach.'}
    else{verdict='Healthy';action='Move on. Revisit in the revision cycle.'}
    const blindT=QUESTIONS.filter(q=>q.topic===t.id).reduce((a,q)=>a+QSTAT[q.id].blind,0);
    return {t, below, l1,l2,l3, verdict, action, blindT,
            score:(1-l2)*4 + (1-l1)*6 + below*0.05};
  }).sort((a,b)=>b.score-a.score);

  const avgSense=Math.round(avg(STUDENTS.map(s=>{
    return clamp(ratedPearson(QUESTIONS.map(q=>R[s.id][q.id].batchR),QUESTIONS.map(q=>1-QSTAT[q.id].p)),0,1)*100;
  })));
  const totalBlind=QUESTIONS.reduce((a,q)=>a+QSTAT[q.id].blind,0);
  const totalFear =QUESTIONS.reduce((a,q)=>a+QSTAT[q.id].fear,0);

  // FELT vs REAL correlation across items — the headline validation number
  const feltArr=QUESTIONS.map(q=>QSTAT[q.id].felt);
  const realArr=QUESTIONS.map(q=>1-QSTAT[q.id].p);
  const rFelt=ratedPearson(feltArr,realArr);
  const batchArr=QUESTIONS.map(q=>QSTAT[q.id].batch);
  const rBatch=ratedPearson(batchArr,realArr);

  return {shared, traps, scares, broken, prio, avgSense, totalBlind, totalFear, rFelt, rBatch};
}

/* --- branch / company synthetic rollups (deterministic) --- */
const BR_RND=mulberry32(77021);
const BATCHES=[
  {id:'b1',name:'JEE-2027-Alpha',teacher:'R. Menon',n:40,live:true},
  {id:'b2',name:'JEE-2027-Beta', teacher:'S. Kulkarni',n:38},
  {id:'b3',name:'JEE-2027-Gamma',teacher:'A. Bhatt',n:42},
  {id:'b4',name:'JEE-2028-Alpha',teacher:'R. Menon',n:36},
  {id:'b5',name:'NEET-2027-A',   teacher:'P. Deshmukh',n:44},
  {id:'b6',name:'JEE-2027-Delta',teacher:'V. Rathi',n:39}
].map(b=>{
  const ceil={}; const growth={};
  TOPICS.forEach(t=>{
    let base = b.live? bandIdx(BATCH_CEIL[t.id]) : clamp(Math.round(bandIdx(BATCH_CEIL[t.id])+ (BR_RND()*2-1)),0,3);
    ceil[t.id]=BANDS[clamp(base,0,3)].id;
    growth[t.id]= b.live? (t.id==='rot'?0:t.id==='thm'?1:0) : (BR_RND()<0.34?1:BR_RND()<0.2?-1:0);
  });
  const sense = b.live? null : Math.round(44+BR_RND()*26);
  const part  = b.live? 100 : Math.round(72+BR_RND()*28);
  return {...b, ceil, growth, sense, part};
});

const BRANCHES=[
  {id:'br1',name:'Kota — Centre 3',city:'Kota',batches:6,students:239,live:true},
  {id:'br2',name:'Jaipur — Malviya',city:'Jaipur',batches:5,students:204},
  {id:'br3',name:'Patna — Boring Rd',city:'Patna',batches:4,students:161},
  {id:'br4',name:'Nagpur — Dharampeth',city:'Nagpur',batches:5,students:188},
  {id:'br5',name:'Indore — Vijay Nagar',city:'Indore',batches:6,students:243}
].map((b,i)=>{
  const g=[0.41,0.29,0.18,0.34,0.23][i];
  return {...b, growth:g, sense:Math.round(48+g*60), part:Math.round(70+g*68),
    weak: ['Rotational Motion','Rotational Motion','Newton\'s Laws','Rotational Motion','Thermodynamics'][i]};
});

/* item bank health across company */
const BANK={
  items: 12480, calibrated: 8912,
  broken: 214, traps: 641, scares: 388,
  worst:[
    {id:'Q4412',topic:'Rotational Motion',used:38,disc:0.04,note:'Toppers and weak students equally wrong'},
    {id:'Q7719',topic:'Thermodynamics',   used:26,disc:0.06,note:'Two options defensible — ambiguous stem'},
    {id:'Q1188',topic:'Kinematics',       used:31,disc:0.08,note:'Answer key disputed in 4 branches'}
  ]
};


return {TOPICS,BANDS,RATING,QUESTIONS,STUDENTS,R,QSTAT,CEIL,BATCH_CEIL,HEAT,TOTAL,NS,
  bandOf,bandIdx,studentReport,batchReport,BATCHES,BRANCHES,BANK,pearson};
}

root.ANUMAAN_ENGINE={generateSample,analyze,TOPICS,BANDS,RATING,bandOf,bandIdx};
})(typeof window!=='undefined'?window:globalThis);
