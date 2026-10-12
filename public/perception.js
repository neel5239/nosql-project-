/* ============================================================
   ANUMAAN v4 — PERCEPTION ENGINE (no marks, one tap)
   Inputs per exam:
     teacher difficulty  T(q) ∈ L1..L4   (set by the teacher at upload)
     student rating      self(s,q) ∈ 1..4  (Normal … Very Hard) — one tap per question
   The batch's view of a question is simply the average of its students' own taps.
   Everything here is computed from those two things only.

   comfortable(s,q)  = the student rated it Normal or Medium
   comfort ceiling   = highest teacher band where the student found
                       ≥ 60% of that band's questions comfortable (needs ≥ 2 items)
   vs batch          = self(s,q) − batch average felt(q)   (+ = harder for me)
   vs teacher        = self(s,q) − T(q)                     (+ = harder than the teacher expects)
   This measures how hard the paper FELT, not whether answers were right.
   ============================================================ */
(function(root){
const ENG=root.ANUMAAN_ENGINE;
const TOPICS=ENG.TOPICS, BANDS=ENG.BANDS, RATING=ENG.RATING, bandIdx=ENG.bandIdx;
const COMFORT=2, MIN_ITEMS=2, CLEAR=0.6;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
function pearson(a,b){
  if(a.length<3) return 0;
  const ma=avg(a),mb=avg(b); let n=0,da=0,db=0;
  for(let i=0;i<a.length;i++){n+=(a[i]-ma)*(b[i]-mb);da+=(a[i]-ma)**2;db+=(b[i]-mb)**2}
  return (da&&db)?n/Math.sqrt(da*db):0;
}

function analyzeFelt(data){
  const Q=data.questions, S=data.students, R=data.R, NS=S.length;
  const T=q=>bandIdx(q.teacherBand)+1;

  /* per question: what the batch felt vs what the teacher said */
  const QF={};
  Q.forEach(q=>{
    const rows=S.map(s=>R[s.id][q.id]);
    const felt=avg(rows.map(r=>r.self));
    const dist=[0,0,0,0]; rows.forEach(r=>dist[r.self-1]++);
    const gap=felt-T(q);
    QF[q.id]={felt,gap,t:T(q),dist,comfort:rows.filter(r=>r.self<=COMFORT).length/(NS||1),
      flag: gap>=1?'harder':gap<=-1?'easier':'aligned'};
  });

  /* comfort ceilings */
  function bandComfort(sid,topic,bid){
    const qs=Q.filter(q=>q.topic===topic&&q.teacherBand===bid);
    if(!qs.length) return null;
    return {acc:qs.filter(q=>R[sid][q.id].self<=COMFORT).length/qs.length, n:qs.length};
  }
  function ceilingOf(sid,topic){
    let c=null;
    BANDS.forEach(b=>{const r=bandComfort(sid,topic,b.id); if(r&&r.n>=MIN_ITEMS&&r.acc>=CLEAR) c=b.id});
    return c||'—';
  }
  const CEIL={}; S.forEach(s=>{CEIL[s.id]={}; TOPICS.forEach(t=>CEIL[s.id][t.id]=ceilingOf(s.id,t.id))});
  const BATCH_CEIL={};
  TOPICS.forEach(t=>{
    const idx=S.map(s=>CEIL[s.id][t.id]==='—'?-1:bandIdx(CEIL[s.id][t.id])).sort((a,b)=>a-b);
    const m=idx.length?idx[Math.floor(idx.length/2)]:-1;
    BATCH_CEIL[t.id]=m<0?'—':BANDS[m].id;
  });

  /* batch heatmap: share of comfortable ratings in each topic × teacher band */
  const HEAT={};
  TOPICS.forEach(t=>{ HEAT[t.id]={};
    BANDS.forEach(b=>{
      const qs=Q.filter(q=>q.topic===t.id&&q.teacherBand===b.id);
      if(!qs.length||!NS){HEAT[t.id][b.id]=null;return}
      let c=0; qs.forEach(q=>S.forEach(s=>{if(R[s.id][q.id].self<=COMFORT)c++}));
      HEAT[t.id][b.id]={acc:c/(qs.length*NS),n:qs.length};
    });
  });

  const tArr=Q.map(T), feltArr=Q.map(q=>QF[q.id].felt);
  // how closely a student's feeling about the paper follows the class average (0–100)
  const matchOf=sid=>Math.round(clamp(pearson(Q.map(q=>R[sid][q.id].self),feltArr),0,1)*100);
  const calibOf=sid=>Math.round(clamp(pearson(Q.map(q=>R[sid][q.id].self),tArr),0,1)*100);
  const matchAll=S.map(s=>matchOf(s.id)), calibAll=S.map(s=>calibOf(s.id));

  function studentReport(sid){
    const s=S.find(x=>x.id===sid);
    const rows=Q.map(q=>{const r=R[sid][q.id];return {q,self:r.self,felt:QF[q.id].felt,t:QF[q.id].t,
      vsBatch:r.self-QF[q.id].felt, vsTeacher:r.self-QF[q.id].t}});
    const harderThanBatch=rows.filter(d=>d.vsBatch>=1.2).sort((a,b)=>b.vsBatch-a.vsBatch);
    const easierThanBatch=rows.filter(d=>d.vsBatch<=-1.2).sort((a,b)=>a.vsBatch-b.vsBatch);
    const harderThanTeacher=rows.filter(d=>d.vsTeacher>=2).sort((a,b)=>b.vsTeacher-a.vsTeacher);
    const confidentOnHard=rows.filter(d=>d.t>=3&&d.self===1);   // called an L3/L4 question "Normal" — double-check it
    const topics=TOPICS.map(t=>{
      const my=CEIL[sid][t.id], bt=BATCH_CEIL[t.id];
      const mi=my==='—'?-1:bandIdx(my), bi=bt==='—'?-1:bandIdx(bt);
      const peers=S.map(o=>CEIL[o.id][t.id]==='—'?-1:bandIdx(CEIL[o.id][t.id]));
      const tr=rows.filter(d=>d.q.topic===t.id);
      return {t,my,bt,delta:mi-bi,pct:Math.round(peers.filter(v=>v<mi).length/(peers.length||1)*100),
        bands:BANDS.map(b=>({b,r:bandComfort(sid,t.id,b.id)})),
        vsBatch:tr.length?avg(tr.map(d=>d.vsBatch)):0, nHard:harderThanBatch.filter(d=>d.q.topic===t.id).length, n:tr.length};
    });
    const focus=topics.filter(o=>o.n).map(o=>({...o,
      score:Math.max(0,-o.delta)*3+Math.max(0,o.vsBatch)*2.5+o.nHard*0.8+(o.my==='—'?2:0)-(o.delta>0?1.5:0)}))
      .sort((a,b)=>b.score-a.score);
    return {s,topics,focus,harderThanBatch,easierThanBatch,harderThanTeacher,confidentOnHard,
      calib:calibOf(sid), calibBatch:Math.round(avg(calibAll)), match:matchOf(sid), matchBatch:Math.round(avg(matchAll)),
      comfortPct:Math.round(rows.filter(d=>d.self<=COMFORT).length/(rows.length||1)*100), rated:rows.length};
  }

  function batchReport(){
    const prio=TOPICS.map(t=>{
      const h=HEAT[t.id], has=Q.some(q=>q.topic===t.id);
      if(!has) return null;
      const l1=h.L1?h.L1.acc:null, l2=h.L2?h.L2.acc:null, l3=h.L3?h.L3.acc:null;
      const below=S.filter(s=>{const c=CEIL[s.id][t.id];return c==='—'||bandIdx(c)<bandIdx('L2')}).length;
      let verdict,action;
      if(l1!=null&&l1<0.7){verdict='Foundation gap';action='Even Basic questions feel hard to many students. Re-teach the concept before adding practice.'}
      else if(l2!=null&&l2<0.5){verdict='Foundation gap';action='Basics feel fine, Moderate ones do not. Re-teach the idea at the Moderate level.'}
      else if(l3!=null&&l3<0.4){verdict='Stretch gap';action='Foundation feels solid. Add Advanced practice sets — no re-teach needed.'}
      else{verdict='Healthy';action='The batch feels comfortable here. Move on, revisit in revision.'}
      return {t,l1,l2,l3,below,verdict,action,score:(l1==null?0:(1-l1)*6)+(l2==null?0:(1-l2)*4)+below*0.05};
    }).filter(Boolean).sort((a,b)=>b.score-a.score);
    const harder=Q.filter(q=>QF[q.id].flag==='harder').sort((a,b)=>QF[b.id].gap-QF[a.id].gap);
    const easier=Q.filter(q=>QF[q.id].flag==='easier').sort((a,b)=>QF[a.id].gap-QF[b.id].gap);
    const all=[]; S.forEach(s=>Q.forEach(q=>all.push(R[s.id][q.id].self)));
    return {prio,harder,easier,rTeacher:pearson(feltArr,tArr),
      comfort:all.length?all.filter(v=>v<=COMFORT).length/all.length:0,
      avgMatch:Math.round(avg(matchAll)), avgCalib:Math.round(avg(calibAll))};
  }

  return {TOPICS,BANDS,RATING,QUESTIONS:Q,STUDENTS:S,R,QF,CEIL,BATCH_CEIL,HEAT,NS,studentReport,batchReport,bandIdx,pearson};
}

root.ANUMAAN_FELT={analyzeFelt,COMFORT,MIN_ITEMS,CLEAR};
})(typeof window!=='undefined'?window:globalThis);
