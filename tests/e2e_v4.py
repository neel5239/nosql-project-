"""ANUMAAN version 4 — end-to-end proof. NO MARKS, ONE TAP: teacher difficulty + one student rating per question,
plus the account sidebar (profile, settings, password, sessions, data export).

Seeds anumaan_v4_test, starts the real server on a free port, drives API + UI
(Chromium + WebKit iPhone). Exit code = number of failed checks.
    python tests/e2e_v4.py
"""
import json, os, socket, subprocess, sys, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "out"; OUT.mkdir(parents=True, exist_ok=True)
R = []
def check(name, ok, detail=""):
    R.append((name, bool(ok), str(detail)[:220]))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))
def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p
ENV = {**os.environ, "MONGO_DB": "anumaan_v4_test"}
def mongo(js):
    code = ("const {MongoClient}=require('mongodb');(async()=>{const c=await MongoClient.connect('mongodb://127.0.0.1:27017');"
            "const db=c.db('anumaan_v4_test');const out=await (async()=>{" + js + "})();console.log(JSON.stringify(out));await c.close()})()")
    r = subprocess.run(["node", "-e", code], cwd=ROOT, env=ENV, capture_output=True, text=True, timeout=60)
    try: return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception: return r.stderr[-300:]
count = lambda c, q="{}": mongo(f"return db.collection('{c}').countDocuments({q})")
def api(ctx, method, path, body=None, headers=None):
    r = ctx.request.fetch(BASE + path, method=method, data=json.dumps(body) if body is not None else None, headers={"Content-Type": "application/json", **(headers or {})})
    try: j = r.json()
    except Exception: j = None
    return r.status, j, r.headers
def session(b, email):
    c = b.new_context(); s, _, _ = api(c, "POST", "/api/auth/login", {"email": email, "password": "anumaan"}); assert s == 200, (email, s); return c
def login(page, email):
    page.fill("#lgEmail", email); page.fill("#lgPass", "anumaan"); page.click("#lgBtn")
SLUGS = None
def students(n, skip=0):
    """students in numeric id order (S1, S2, …); S1–S10 still have E3 pending; diya.verma (S2) is locked by the lockout test"""
    rows = mongo("return (await db.collection('users').find({role:'student'}).toArray()).map(u=>[+u.studentId.slice(1),u.email])")
    return [e for _, e in sorted(rows) if not e.startswith("diya.verma")][skip:skip + n]

QCSV = ("topic,question,A,B,C,D,answer\n"
        "Kinematics,\"A car goes 0 to 20 m/s in 4 s. Acceleration?\",5 m/s²,4 m/s²,80 m/s²,2 m/s²,\n"
        "Newton's Laws,\"Net force on a body at constant velocity is:\",Zero,mg,ma,Infinite,\n"
        "Rotational Motion,\"Moment of inertia of a disc about its axis:\",MR²/2,MR²,2MR²/5,MR²/12,A\n"
        "Thermodynamics,\"Work done in a cyclic process equals:\",Net heat absorbed,Zero,ΔU,PΔV only,\n"
        "Kinematics,\"Area under a velocity-time graph gives:\",Acceleration,Displacement,Jerk,Force,\n"
        "Rotational Motion,\"Torque = rate of change of:\",Angular momentum,Linear momentum,Energy,Power,\n")
ANS6 = lambda s, b=None: {f"Q{i}": {"self": s} for i in range(1, 7)}

def suite_contrast(b):
    print("\n[contrast] text tokens ≥ 4.5:1, mid-tone surfaces")
    js = r"""() => { const L=c=>{const m=c.match(/\d+(\.\d+)?/g).slice(0,3).map(v=>+v/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4);return .2126*m[0]+.7152*m[1]+.0722*m[2]};
      const cr=(a,b)=>{const x=L(a),y=L(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
      const probe=v=>{const d=document.createElement('i');d.style.color=`var(${v})`;document.body.appendChild(d);const c=getComputedStyle(d).color;d.remove();return c};
      const bg=probe('--bg'), out={}; for(const v of ['--text','--muted','--faint','--acc','--red','--amber','--green','--blue']) out[v]=+cr(probe(v),bg).toFixed(2);
      out.button=+cr(probe('--acc-text'),probe('--acc')).toFixed(2); return out }"""
    for theme in ["light", "dark"]:
        c = b.new_context(color_scheme=theme); p = c.new_page(); p.goto(BASE); p.wait_for_load_state("networkidle")
        r = p.evaluate(js); low = {k: v for k, v in r.items() if v < 4.5}
        check(f"{theme}: all text/status colours ≥ 4.5:1", not low, low or r); c.close()

def suite_api(b):
    print("\n[api] auth, roles, injection, no marks anywhere")
    ctx = b.new_context()
    s, _, h = api(ctx, "GET", "/")
    check("CSP frame-ancestors + nosniff + no X-Powered-By", "frame-ancestors 'none'" in h.get("content-security-policy", "") and h.get("x-content-type-options") == "nosniff" and "x-powered-by" not in h)
    s, _, _ = api(ctx, "POST", "/api/auth/login", {"email": {"$gt": ""}, "password": {"$gt": ""}}); check("NoSQL injection in login → 400", s == 400)
    r = ctx.request.get(BASE + "/api/me", headers={"Cookie": "sid=%E0%A4%A"})
    check("malformed cookie → 401, not a server error", r.status == 401, r.status)
    r = ctx.request.post(BASE + "/api/auth/login", data=json.dumps({"email": "x@byjus.com", "password": "a"}), headers={"Content-Type": "application/json"})
    check("login responses carry standard RateLimit headers", any(k.lower().startswith("ratelimit") for k in r.headers), list(r.headers)[:8])
    s, _, _ = api(ctx, "POST", "/api/auth/login", {"email": "admin@allen.edu.in", "password": "anumaan"}, {"Origin": "https://evil.example"}); check("cross-origin POST → 403", s == 403)
    codes = [api(ctx, "POST", "/api/auth/login", {"email": "diya.verma@student.allen.edu.in", "password": "x"})[0] for _ in range(6)]
    check("lockout after 5 wrong passwords", codes[5] == 429, codes)
    t = session(b, "r.menon@faculty.allen.edu.in")
    for path in ["/api/teacher/upload", "/api/teacher/exams/E3/sample-marks", "/api/company/retire"]:
        s, _, _ = api(t, "POST" if "upload" in path or "retire" in path else "GET", path, {} if "upload" in path or "retire" in path else None)
        check(f"marks/retire endpoint gone: {path} → 404", s == 404, s)
    check("MongoDB holds no marks: responses collection empty", count("responses") == 0)
    stu = session(b, "aarav.sharma@student.allen.edu.in")
    for path, m in [("/api/batch", "GET"), ("/api/exams", "GET"), ("/api/teacher/exams", "POST"), ("/api/company/overview", "GET"), ("/api/branch/summary", "GET")]:
        s, _, _ = api(stu, m, path, {} if m == "POST" else None); check(f"student → {path} 403", s == 403, s)
    s, j, _ = api(stu, "GET", "/api/student/report?exam=E3")
    check("E3 not rated yet → report locked ('survey')", s == 200 and j["rep"] is None and j["locked"] == "survey")
    _, hist, _ = api(stu, "GET", "/api/student/history")
    e3 = next(i for i in hist["items"] if i["exam"]["id"] == "E3")
    check("E3 history row hidden until Aarav rates", e3["history"] is None and e3["locked"])
    s, j, _ = api(stu, "GET", "/api/student/report?exam=E2")
    rep = j["rep"]
    check("E2 comfort report: comfort %, calib, sense, ceilings", s == 200 and 0 <= rep["comfortPct"] <= 100 and "calib" in rep and len(rep["topics"]) == 4)
    check("student payload never contains an answer key or the batch matrix", '"answer"' not in json.dumps(j) and "R" not in j)
    check("comparisons carry you / batch / teacher", all({"self", "felt", "t"} <= set(d) for d in rep["harderThanBatch"] + rep["harderThanTeacher"]))
    _, sv, _ = api(stu, "GET", "/api/student/survey?exam=E3")
    check("E3 survey: 12 questions, no answers/options", len(sv["questions"]) == 12 and all(set(q) == {"id", "topic", "text"} for q in sv["questions"]))
    full = {f"Q{i}": {"self": 2} for i in range(1, 13)}
    s1, j1, _ = api(stu, "POST", "/api/student/survey/submit", {"exam": "E3", "answers": full})
    s2, _, _ = api(stu, "POST", "/api/student/survey/submit", {"exam": "E3", "answers": full})
    check("one-time survey: 200 then 409", (s1, s2) == (200, 409))
    check("31 students rated → report ready immediately", j1["ready"] and j1["batchSize"] == 31)
    stored = mongo("return Object.values((await db.collection('surveys').findOne({studentId:'S1',examId:'E3'})).answers).map(a=>Object.keys(a).join(','))")
    check("one tap per question: stored ratings hold only 'self'", stored and all(k == "self" for k in stored), stored[:3])
    rep4 = api(stu, "GET", "/api/student/report?exam=E3")[1]["rep"]
    check("report has 'in step with batch' and no batch-guess score", "match" in rep4 and "sense" not in rep4)
    s, j, _ = api(stu, "GET", "/api/student/report?exam=E3")
    check("E3 report now available, compared with 31", j["rep"] and j["batchSize"] == 31)
    check("history row for E3 written on submit", count("student_history", "{studentId:'S1',examId:'E3'}") == 1)
    s, _, _ = api(stu, "GET", "/api/student/report?exam[$ne]=x"); check("operator in query → never reaches Mongo", s in (200, 404))
    _, j, _ = api(stu, "GET", "/api/student/report?exam=E2")
    vals = [d["felt"] for d in j["rep"]["harderThanBatch"] + j["rep"]["harderThanTeacher"]] + [o["vsBatch"] for o in j["rep"]["topics"]]
    check("batch figures shown to students are rounded to half steps (no differencing)", vals and all(abs(v * 2 - round(v * 2)) < 1e-9 for v in vals), vals[:5])
    # a student in ANOTHER batch must not see or rate this batch's exams
    mongo("""const u=await db.collection('users').findOne({email:'aarav.sharma@student.allen.edu.in'});
      await db.collection('batches').updateOne({_id:'b2'},{$set:{name:'JEE-2028-Beta',branch:'jaipur'}},{upsert:true});
      await db.collection('students').updateOne({_id:'S99'},{$set:{roll:'B28-099',name:'Zara Test',batchId:'b2'}},{upsert:true});
      await db.collection('users').updateOne({email:'zara.test@student.allen.edu.in'},{$set:{name:'Zara Test',role:'student',studentId:'S99',passHash:u.passHash,theme:'light'}},{upsert:true}); return 1""")
    other = session(b, "zara.test@student.allen.edu.in")
    _, xl, _ = api(other, "GET", "/api/student/exams")
    s1, _, _ = api(other, "GET", "/api/student/survey?exam=E3")
    s2, _, _ = api(other, "POST", "/api/student/survey/submit", {"exam": "E3", "answers": {f"Q{i}": {"self": 1, "batch": 1} for i in range(1, 13)}})
    s3, _, _ = api(other, "GET", "/api/student/report?exam=E2")
    check("other-batch student: sees no exams, cannot read/rate/report (404)", xl["exams"] == [] and (s1, s2, s3) == (404, 404, 404), (len(xl["exams"]), s1, s2, s3))
    s, _, _ = api(session(b, "admin@allen.edu.in"), "GET", "/api/batch?exam=E2")
    check("company cannot pull individual named ratings (/api/batch 403)", s == 403)
    s, _, _ = api(stu, "PUT", "/api/student/survey/draft", {"exam": {"$gt": ""}, "answers": {}}); check("operator as exam id → 404", s == 404)

def suite_lifecycle(b):
    print("\n[lifecycle] create → teacher rates difficulty → approve → students rate → ready at 5 → close")
    t = session(b, "r.menon@faculty.allen.edu.in")
    s, j, _ = api(t, "POST", "/api/teacher/exams", {"title": "Pulse · <i>Mixed</i>", "csv": QCSV})
    check("question CSV without answers accepted", s == 200 and j["exam"]["questions"] == 6, j)
    ex = j["exam"]["id"]
    s, j, _ = api(t, "POST", f"/api/teacher/exams/{ex}/approve", {}); check("approve blocked until every question is rated", s == 400)
    s, j, _ = api(t, "PUT", f"/api/teacher/exams/{ex}/difficulty", {"bands": {"Q1": "L1", "Q2": "L1", "Q3": "L2", "Q4": "L3", "Q5": "L2", "Q6": "L4", "Qx": "L1", "Q1 ": ["L2"]}})
    check("difficulty ratings saved, junk ignored", j["saved"] == 6 and j["missing"] == 0, j)
    s, j, _ = api(t, "POST", f"/api/teacher/exams/{ex}/approve", {}); check("approve → 40 notified", j["notified"] == 40)
    emails = students(6, skip=20)
    pattern = [(1, 2), (2, 2), (1, 1), (3, 3), (2, 3), (4, 3)]
    first = session(b, emails[0])
    s, j, _ = api(first, "POST", "/api/student/survey/submit", {"exam": ex, "answers": ANS6(2, 2)})
    check("first rating saved, not ready yet (needs 5)", s == 200 and not j["ready"] and j["need"] == 5)
    s, j, _ = api(first, "GET", f"/api/student/report?exam={ex}")
    check("report says waiting for the batch (1 of 5)", j["rep"] is None and j["waiting"] == {"have": 1, "need": 5})
    for e, (a, bb) in zip(emails[1:5], pattern[1:5]):
        c = session(b, e); api(c, "POST", "/api/student/survey/submit", {"exam": ex, "answers": {f"Q{i}": {"self": min(4, a + (i > 3))} for i in range(1, 7)}})
    check("5th rating flips the exam to ready", mongo(f"return (await db.collection('exams').findOne({{_id:'{ex}'}})).ready") is True)
    check("history written for all 5 raters", count("student_history", f"{{examId:'{ex}'}}") == 5)
    s, j, _ = api(first, "GET", f"/api/student/report?exam={ex}")
    check("first student's report now compares with 5", j["rep"] and j["batchSize"] == 5)
    s, bd, _ = api(t, "GET", f"/api/batch?exam={ex}")
    check("teacher data: 5×6 ratings, teacher levels, no answers", bd["ready"] and len(bd["students"]) == 5 and all(q["teacherBand"] for q in bd["questions"]) and '"answer"' not in json.dumps(bd))
    _, ov, _ = api(session(b, "admin@allen.edu.in"), "GET", "/api/company/overview")
    check("company overview lists the new exam with comfort", any(x["exam"]["id"] == ex and x["comfort"] is not None for x in ov["exams"]))
    adm = session(b, "admin@allen.edu.in")
    if ov["review"]:
        r0 = ov["review"][0]
        s, _, _ = api(adm, "POST", "/api/company/review", {"exam": r0["examId"], "qid": r0["qid"]})
        _, ov2, _ = api(adm, "GET", "/api/company/overview")
        check("company can mark a question reviewed (stored in MongoDB)", s == 200 and any(x["reviewed"] for x in ov2["review"]) and count("review_flags") == 1)
    s, _, _ = api(adm, "POST", "/api/company/review", {"exam": {"$gt": ""}, "qid": "Q1"}); check("review with operator → 404", s == 404)
    br = session(b, "head@kota.allen.edu.in")
    _, bs, _ = api(br, "GET", "/api/branch/summary")
    check("branch head: aggregates only (no ratings / names)", bs["exams"] and '"R":' not in json.dumps(bs) and "Aarav" not in json.dumps(bs))
    s, _, _ = api(t, "POST", f"/api/teacher/exams/{ex}/survey/close", {})
    late = session(b, emails[5])
    s2, _, _ = api(late, "POST", "/api/student/survey/submit", {"exam": ex, "answers": ANS6(1, 1)})
    s3, _, _ = api(t, "POST", f"/api/teacher/exams/{ex}/survey/open", {})
    check("close → late submit 423, cannot re-open (409)", (s, s2, s3) == (200, 423, 409), (s, s2, s3))
    _, j, _ = api(late, "GET", f"/api/student/report?exam={ex}")
    check("student who missed it gets 'missed', not someone else's data", j["rep"] is None and j["locked"] == "missed")
    check("history marked final after close", mongo(f"return await db.collection('student_history').countDocuments({{examId:'{ex}',final:true}})") == 5)
    return ex

def errs_of(page):
    e = []; page.on("console", lambda m: m.type == "error" and e.append(m.text)); page.on("pageerror", lambda x: e.append(str(x))); return e

def suite_ui(b, wk):
    print("\n[ui] student rates → comfort report, history; teacher wizard + comfort map")
    ctx = b.new_context(viewport={"width": 1280, "height": 860}); p = ctx.new_page(); errs = errs_of(p)
    dialogs = []; p.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    p.goto(BASE); p.wait_for_load_state("networkidle")
    login(p, students(1, skip=1)[0]); p.wait_for_selector("#pane-student.on .h1")
    check("bell + pending banner for E3", p.locator("#bell .dotcount").count() == 1 and p.is_visible(".banner.hot"))
    check("sidebar: dashboard items + Profile + Settings, Surveys badge", [t.split("\n")[0] for t in p.locator("#sideNav .side-link").all_inner_texts()][:6] == ["My report", "Courses", "Surveys", "History", "Profile", "Settings"] and p.locator("#sideNav .cnt").count() == 1)
    p.click("#bell"); p.wait_for_selector("#modal.on [data-act=openSurvey]")
    p.locator("#modal [data-act=openSurvey]").first.click(); p.wait_for_selector(".sv-card")
    n = int(p.text_content(".sv-meta").split("OF")[1].split()[0])
    for i in range(n):
        p.keyboard.press(str(1 + i % 4)); p.click("[data-act=svNext]"); p.wait_for_timeout(60)
    p.click("[data-act=svSubmit]"); p.wait_for_selector(".rep-top .h2", timeout=15000)
    check("after rating → comfort report or batch-wait screen opens", p.is_visible(".rep-top .h2") or "Waiting for your batch" in p.text_content("#sBody"))
    check("report explains it is comfort, not marks", "not marks" in p.text_content("#sBody"))
    check("you / batch / teacher comparison shown", p.locator(".cmp").count() >= 1 or "Nothing felt much harder" in p.text_content("#sBody"))
    p.screenshot(path=str(OUT / "v4_student_report.png"))
    p.click("[data-act=nav][data-arg=history]"); p.wait_for_selector(".hist")
    check("history: comfort % per exam + trend", p.locator(".hist-score b").count() >= 3 and p.is_visible(".spark"))
    p.click("[data-act=nav][data-arg=learn]"); p.wait_for_selector(".reco, .empty-state", timeout=30000)
    links = p.eval_on_selector_all(".vid", "els=>els.map(e=>[e.href,e.rel])")
    check("course links are YouTube + noopener", all(l[0].startswith("https://www.youtube.com/") and "noopener" in l[1] for l in links))
    check("browser storage untouched (MongoDB only)", p.evaluate("localStorage.length+sessionStorage.length") == 0)
    p.click("[data-sign-out]"); p.wait_for_selector("#lgForm")
    login(p, "r.menon@faculty.allen.edu.in"); p.wait_for_selector("#pane-teacher.on .exam-chip")
    p.click("[data-act=pickExam][data-arg=E2]"); p.wait_for_selector("#t-heat")
    check("E2 comfort map: 16 cells", p.locator(".hm .cell").count() == 16)
    check("teacher dashboard says no marks used", "No marks used" in p.text_content("#pane-teacher"))
    p.locator("#pmTable tbody tr").first.focus(); p.keyboard.press("Enter")
    check("question detail: felt distribution", p.is_visible("#modal.on") and p.locator("#modal .opt-row").count() == 4)
    p.keyboard.press("Escape")
    p.screenshot(path=str(OUT / "v4_teacher_dash.png"))
    p.click("[data-act=newExam]"); p.fill("#nxTitle", "UI · Mixed pulse")
    p.set_input_files("#nxFile", files=[{"name": "q.csv", "mimeType": "text/csv", "buffer": QCSV.encode()}]); p.wait_for_selector("text=ready")
    p.click("[data-act=createExam]"); p.wait_for_selector(".band-seg")
    for i, band in enumerate(["L1", "L2", "L2", "L3", "L1", "L4"], 1): p.click(f"[data-act=markBand][data-arg='Q{i}:{band}']")
    p.wait_for_timeout(600); p.click("#approveBtn"); p.wait_for_selector("#liveBox")
    check("approved → waiting for 5 ratings, no upload step", "Waiting for ratings" in p.text_content("#pane-teacher") and p.locator("[data-act=uploadModal]").count() == 0)
    check("no XSS dialogs", not dialogs, dialogs)
    check("no console / page errors", not errs, errs[:3])
    ctx.close()
    for w, h, theme in [(375, 812, "light"), (1280, 860, "dark")]:
        c = b.new_context(viewport={"width": w, "height": h}, color_scheme=theme); q = c.new_page(); q.goto(BASE)
        login(q, "aarav.sharma@student.allen.edu.in"); q.wait_for_selector("#pane-student.on .h1")
        check(f"student report @{w}px {theme}: no sideways scroll", q.evaluate("document.documentElement.scrollWidth-innerWidth") <= 0)
        q.screenshot(path=str(OUT / f"v4_report_{w}_{theme}.png")); c.close()
    c = wk.new_context(**PW.devices["iPhone 13"]); q = c.new_page(); e2 = errs_of(q)
    q.goto(BASE); q.tap("[data-act=pickAcc][data-arg='1']"); q.wait_for_selector(".exam-chip")
    check("iPhone (WebKit): teacher view fits", q.evaluate("document.documentElement.scrollWidth-innerWidth") <= 0)
    check("iPhone: no errors", not e2, e2[:2]); c.close()


def suite_account(b, wk):
    print("\n[account] sidebar, profile, settings, password, sessions, data export")
    email = students(1, skip=30)[0]
    c1 = session(b, email); c2 = session(b, email)
    _, pr, _ = api(c1, "GET", "/api/me/profile")
    check("profile: e-mail, roll, batch, official name, counts", pr["profile"]["email"] == email and pr["profile"]["roll"] and pr["profile"]["batch"] == "JEE-2027-Alpha" and pr["profile"]["surveys"] >= 1)
    check("profile never exposes the password hash", "passHash" not in json.dumps(pr) and "$2" not in json.dumps(pr))
    s, _, _ = api(c1, "PATCH", "/api/me/profile", {"name": "x"}); check("name shorter than 2 → 400", s == 400)
    s, j, _ = api(c1, "PATCH", "/api/me/profile", {"name": "<img src=x onerror=alert(1)>  Test\u0000 Name"})
    check("name is cleaned (no < >, no control chars)", s == 200 and "<" not in j["name"] and "\u0000" not in j["name"], j)
    s, _, _ = api(c1, "PATCH", "/api/me/profile", {"name": {"$gt": ""}}); check("object as name → 400", s == 400)
    s, j, _ = api(c1, "PATCH", "/api/me/prefs", {"theme": "system", "reduceMotion": True, "sidebarCollapsed": True})
    check("prefs saved: system theme, reduce motion, compact sidebar", s == 200 and j["prefs"] == {"theme": "system", "reduceMotion": True, "sidebarCollapsed": True, "surveyBanner": True})
    s, _, _ = api(c1, "PATCH", "/api/me/prefs", {"reduceMotion": "yes"}); check("non-boolean pref → 400", s == 400)
    s, _, _ = api(c1, "PATCH", "/api/me/prefs", {"theme": "neon"}); check("unknown theme → 400", s == 400)
    s, _, _ = api(c1, "PATCH", "/api/me/prefs", {"$set": {"role": "company"}}); check("operator body → 400, role untouched", s == 400 and mongo(f"return (await db.collection('users').findOne({{email:'{email}'}})).role") == "student")
    _, ss, _ = api(c1, "GET", "/api/me/sessions")
    check("sessions list shows 2 devices, one marked current", len(ss["sessions"]) == 2 and sum(x["current"] for x in ss["sessions"]) == 1 and "tokenHash" not in json.dumps(ss))
    s, _, _ = api(c1, "POST", "/api/me/password", {"current": "wrong", "next": "newpass123"}); check("wrong current password → 400", s == 400)
    s, _, _ = api(c1, "POST", "/api/me/password", {"current": "anumaan", "next": "short"}); check("weak new password → 400", s == 400)
    s, j, _ = api(c1, "POST", "/api/me/password", {"current": "anumaan", "next": "newpass123"})
    check("password changed, other device signed out", s == 200 and j["otherSessionsEnded"] == 1)
    check("the other device's session is now dead (401)", api(c2, "GET", "/api/me")[0] == 401)
    check("this device stays signed in", api(c1, "GET", "/api/me")[0] == 200)
    c3 = b.new_context()
    check("old password no longer works", api(c3, "POST", "/api/auth/login", {"email": email, "password": "anumaan"})[0] == 401)
    check("new password works", api(c3, "POST", "/api/auth/login", {"email": email, "password": "newpass123"})[0] == 200)
    s, j, _ = api(c1, "DELETE", "/api/me/sessions/others"); check("sign out other devices", s == 200 and j["ended"] == 1 and api(c3, "GET", "/api/me")[0] == 401)
    s, ex, h = api(c1, "GET", "/api/me/export")
    check("data export: account, surveys, history, activity; attachment", s == 200 and ex["surveys"] and ex["history"] and ex["activity"] and "attachment" in h.get("content-disposition", ""))
    check("data export has no password hash or session tokens", "passHash" not in json.dumps(ex) and "tokenHash" not in json.dumps(ex))
    t = session(b, "r.menon@faculty.allen.edu.in")
    _, te, _ = api(t, "GET", "/api/me/export")
    check("teacher export has no student surveys", "surveys" not in te)
    # UI: the sidebar, profile and settings in a real browser
    ctx = b.new_context(viewport={"width": 1280, "height": 860}); p = ctx.new_page(); errs = errs_of(p)
    p.goto(BASE); login(p, "r.menon@faculty.allen.edu.in"); p.wait_for_selector("#sideNav .side-link")
    p.click("[data-act=nav][data-arg=profile]"); p.wait_for_selector("#pfForm")
    p.fill("#pfName", "R. Menon (Physics)"); p.click("#pfForm button[type=submit]"); p.wait_for_selector("text=Saved")
    check("profile edit shows in the sidebar", "R. Menon (Physics)" in p.text_content("#sideAcc"))
    p.click("[data-act=nav][data-arg=settings]"); p.wait_for_selector("#pwForm")
    p.click("[data-act=pref][data-arg='theme:dark']"); p.wait_for_timeout(500)
    p.click("[data-act=pref][data-arg^='sidebarCollapsed:']"); p.wait_for_timeout(500)
    check("dark theme + compact sidebar applied", p.evaluate("document.documentElement.dataset.theme") == "dark" and p.evaluate("document.getElementById('side').classList.contains('mini')"))
    p.reload(); p.wait_for_selector("#sideNav .side-link")
    check("settings survive reload (stored in MongoDB)", p.evaluate("document.documentElement.dataset.theme") == "dark" and p.evaluate("document.getElementById('side').classList.contains('mini')"))
    p.click("[data-act=nav][data-arg=settings]"); p.wait_for_selector("#pwForm")
    p.fill("#pwCur", "anumaan"); p.fill("#pwNew", "teach2026x"); p.fill("#pwNew2", "teach2026y"); p.click("#pwForm button[type=submit]")
    check("settings: mismatched new passwords caught in the form", "do not match" in p.text_content("#pwMsg"))
    p.click("[data-act=nav][data-arg=dash]"); p.wait_for_selector(".exam-chip")
    check("Dashboard link returns to the teacher's exams", p.locator("[data-act=nav][data-arg=dash].on").count() == 1)
    check("no console errors in the account flows", not errs, errs[:3])
    ctx.close()
    c = wk.new_context(**PW.devices["iPhone 13"]); q = c.new_page()
    q.goto(BASE); q.tap("[data-act=pickAcc][data-arg='0']"); q.wait_for_selector("#burger")
    check("phone: sidebar hidden until the menu button", not q.evaluate("document.getElementById('side').getBoundingClientRect().right>0"))
    q.tap("#burger"); q.wait_for_timeout(350)
    check("phone: menu opens the account drawer", q.evaluate("document.getElementById('side').getBoundingClientRect().left>=0") and q.get_attribute("#burger", "aria-expanded") == "true")
    q.tap("[data-act=nav][data-arg=profile]"); q.wait_for_selector("#pfForm")
    check("phone: choosing Profile closes the drawer", q.get_attribute("#burger", "aria-expanded") == "false" and q.evaluate("document.documentElement.scrollWidth-innerWidth") <= 0)
    c.close()

def main():
    global BASE, PW
    r = subprocess.run(["node", "server/seed.js", "--no-reco"], cwd=ROOT, env=ENV, capture_output=True, text=True, timeout=300)
    check("seed test database", r.returncode == 0 and "pending survey notifications" in r.stdout, (r.stdout + r.stderr)[-200:])
    check("history seeded: 110 rows (40+40+30)", count("student_history") == 110)
    port = free_port(); BASE = f"http://127.0.0.1:{port}"
    srv = subprocess.Popen(["node", "server/server.js"], cwd=ROOT, env={**ENV, "PORT": str(port), "LOGIN_RATE_LIMIT": "1000"}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    for _ in range(60):
        try: urllib.request.urlopen(BASE + "/api/health", timeout=1); break
        except Exception: time.sleep(0.2)
    try:
        with sync_playwright() as pw:
            PW = pw; b = pw.chromium.launch(); wk = pw.webkit.launch()
            for s in (suite_contrast, suite_api, suite_lifecycle):
                try: s(b)
                except Exception as e: check(f"{s.__name__} crashed", False, repr(e))
            try: suite_ui(b, wk)
            except Exception as e: check("suite_ui crashed", False, repr(e))
            try: suite_account(b, wk)
            except Exception as e: check("suite_account crashed", False, repr(e))
            b.close(); wk.close()
    finally: srv.terminate()
    failed = [x for x in R if not x[1]]
    print(f"\n==== {len(R) - len(failed)}/{len(R)} checks passed ====")
    (OUT / "v4_results.json").write_text(json.dumps([{"check": n, "pass": ok, "detail": d} for n, ok, d in R], indent=1), encoding="utf-8")
    sys.exit(len(failed))

if __name__ == "__main__":
    main()
