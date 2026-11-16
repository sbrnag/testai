/* ────────────────────────────────────────────────────────────────────────
   Mock API. This is the ONLY module that touches the data store.
   Every export is async and resolves after simulated network latency, so
   swapping a body for `fetch('/api/…')` needs no change in any view.
   ──────────────────────────────────────────────────────────────────────── */
import * as store from './store.js';
import { pct } from './components.js';

const delay = (ms = 260) => new Promise(r => setTimeout(r, ms + Math.random() * 140));
const clone = o => JSON.parse(JSON.stringify(o));
const db = () => store.load();

/* ── joins ─────────────────────────────────────────────────────────────── */
function hydrate(sheet){
  const d = db();
  const exam = d.exams.find(e => e.id === sheet.examId);
  const student = d.students.find(s => s.id === sheet.studentId);
  const total = exam?.totalMarks || 0;
  return {
    ...sheet,
    examName: exam?.name || '—', examCode: exam?.code || '—', subject: exam?.subject || '—',
    totalMarks: total,
    studentName: student?.name || '—', rollNo: student?.rollNo || '—',
    className: student?.className || '—',
    percentage: sheet.status === 'pending' ? null : pct(sheet.marksObtained, total),
  };
}

/* ── meta ──────────────────────────────────────────────────────────────── */
export async function getMeta(){
  await delay(90);
  const d = db();
  return clone({ institution:d.institution, examiner:d.examiner, settings:d.settings });
}
export async function updateSettings(patch){
  await delay(180);
  Object.assign(db().settings, patch); store.save();
  return clone(db().settings);
}
export async function resetDemo(){ await delay(420); store.reset(); return true; }

/* ── exams ─────────────────────────────────────────────────────────────── */
export async function getExams(){
  await delay();
  const d = db();
  return clone(d.exams.map(e => {
    const sheets = d.sheets.filter(s => s.examId === e.id);
    const done = sheets.filter(s => s.status === 'approved' || s.status === 'evaluated');
    const avg = done.length
      ? done.reduce((s,x) => s + pct(x.marksObtained, e.totalMarks), 0) / done.length : null;
    return { ...e, sheetCount:sheets.length,
      pendingCount: sheets.filter(s => s.status === 'pending' || s.status === 'processing').length,
      reviewCount: sheets.filter(s => s.status === 'evaluated').length,
      approvedCount: sheets.filter(s => s.status === 'approved').length,
      avgPercent: avg === null ? null : Math.round(avg * 10) / 10 };
  }));
}
export async function getExam(id){
  await delay(200);
  const e = db().exams.find(x => x.id === id);
  return e ? clone(e) : null;
}
export async function createExam(data){
  await delay(520);
  const exam = {
    id: store.uid('ex'), status:'draft', createdAt:new Date().toISOString(),
    paperFile:null, keyFile:null, ...data,
    questions:(data.questions || []).map((q,i) => ({ ...q, no:i+1, id: store.uid('q') })),
  };
  exam.totalMarks = exam.questions.reduce((s,q) => s + (+q.maxMarks || 0), 0);
  db().exams.unshift(exam); store.save();
  return clone(exam);
}
export async function updateExam(id, patch){
  await delay(300);
  const e = db().exams.find(x => x.id === id);
  if (!e) throw new Error('Exam not found');
  Object.assign(e, patch);
  if (patch.questions) e.totalMarks = e.questions.reduce((s,q) => s + (+q.maxMarks || 0), 0);
  store.save();
  return clone(e);
}
export async function deleteExam(id){
  await delay(320);
  const d = db();
  d.exams = d.exams.filter(e => e.id !== id);
  const gone = d.sheets.filter(s => s.examId === id).map(s => s.id);
  d.sheets = d.sheets.filter(s => s.examId !== id);
  d.evaluations = d.evaluations.filter(e => !gone.includes(e.sheetId));
  store.save();
  return true;
}

/* ── students ──────────────────────────────────────────────────────────── */
export async function getStudents(){
  await delay();
  const d = db();
  return clone(d.students.map(s => {
    const sheets = d.sheets.filter(x => x.studentId === s.id);
    const done = sheets.filter(x => x.status !== 'pending' && x.status !== 'processing');
    const avg = done.length ? done.reduce((a,x) => {
      const ex = d.exams.find(e => e.id === x.examId);
      return a + pct(x.marksObtained, ex?.totalMarks || 1);
    }, 0) / done.length : null;
    return { ...s, examCount:sheets.length, evaluatedCount:done.length,
      avgPercent: avg === null ? null : Math.round(avg * 10) / 10 };
  }));
}
export async function getStudent(id){
  await delay(200);
  const d = db();
  const s = d.students.find(x => x.id === id);
  if (!s) return null;
  return clone({ ...s, sheets: d.sheets.filter(x => x.studentId === id).map(hydrate) });
}

/* ── answer sheets ─────────────────────────────────────────────────────── */
export async function getSheets(filter = {}){
  await delay();
  let rows = db().sheets.filter(s =>
    (!filter.examId || s.examId === filter.examId) &&
    (!filter.status || s.status === filter.status) &&
    (!filter.studentId || s.studentId === filter.studentId));
  return clone(rows.map(hydrate));
}
export async function getSheet(id){
  await delay(200);
  const s = db().sheets.find(x => x.id === id);
  return s ? clone(hydrate(s)) : null;
}
/** files: [{name, size}] from a Dropzone. Creates sheets in `pending`. */
export async function createSheets(examId, files){
  await delay(600);
  const d = db();
  const exam = d.exams.find(e => e.id === examId);
  if (!exam) throw new Error('Exam not found');
  const roster = d.students.filter(s => s.className === exam.className);
  const taken = new Set(d.sheets.filter(s => s.examId === examId).map(s => s.studentId));

  const made = files.map((f) => {
    /* An explicit choice from the examiner always wins. Otherwise fall back to
       matching the filename against a roll number. There is deliberately no
       positional fallback — assigning a sheet to whoever happens to be next on
       the roster silently credits one student's answers to another. */
    const student = (f.studentId && roster.find(s => s.id === f.studentId))
      || roster.find(s => f.name.toUpperCase().includes(s.rollNo.toUpperCase()));
    if (!student) throw new Error(`No student assigned for "${f.name}"`);
    taken.add(student.id);
    const sheet = {
      id: store.uid('sh'), examId, studentId: student.id,
      fileName: f.name, fileSize: f.size || 2097152,
      pages: f.pages || (4 + Math.floor(Math.random() * 4)),
      uploadedAt: new Date().toISOString(),
      status:'pending', stage:null, progress:0, ocrConfidence:0, marksObtained:0,
      evaluatedAt:null, approvedAt:null, approvedBy:null,
    };
    /* Re-uploading for a student replaces their previous sheet rather than
       leaving two rows for the same person. */
    const prior = d.sheets.find(s => s.examId === examId && s.studentId === student.id);
    if (prior){
      d.sheets = d.sheets.filter(s => s.id !== prior.id);
      d.evaluations = d.evaluations.filter(e => e.sheetId !== prior.id);
    }
    d.sheets.push(sheet);
    return sheet;
  });
  if (exam.status === 'draft') exam.status = 'active';
  store.save();
  return clone(made.map(hydrate));
}
export async function deleteSheet(id){
  await delay(280);
  const d = db();
  d.sheets = d.sheets.filter(s => s.id !== id);
  d.evaluations = d.evaluations.filter(e => e.sheetId !== id);
  store.save();
  return true;
}

/* ── evaluations ───────────────────────────────────────────────────────── */
export async function getEvaluations(sheetId){
  await delay(240);
  const d = db();
  const sheet = d.sheets.find(s => s.id === sheetId);
  if (!sheet) return null;
  const exam = d.exams.find(e => e.id === sheet.examId);
  const rows = d.evaluations.filter(e => e.sheetId === sheetId)
    .map(e => ({ ...e, question: exam.questions.find(q => q.id === e.questionId) }))
    .sort((a,b) => (a.question?.no || 0) - (b.question?.no || 0));
  return clone({ sheet: hydrate(sheet), exam, evaluations: rows });
}
export async function updateEvaluation(id, patch){
  await delay(220);
  const d = db();
  const ev = d.evaluations.find(e => e.id === id);
  if (!ev) throw new Error('Evaluation not found');
  const priorMarks = ev.finalMarks;
  Object.assign(ev, patch);
  if ('finalMarks' in patch){
    ev.overridden = ev.finalMarks !== ev.aiMarks;
    if (ev.finalMarks !== priorMarks && ev.approved){
      ev.approved = false; ev.approvedAt = null; ev.approvedBy = null;   // re-check required
    }
  }
  const sheet = d.sheets.find(s => s.id === ev.sheetId);
  if (sheet) sheet.marksObtained = Math.round(
    d.evaluations.filter(e => e.sheetId === sheet.id)
      .reduce((s,e) => s + e.finalMarks, 0) * 2) / 2;
  store.save();
  return clone(ev);
}
/** Approve (or reopen) the marks for a single question. */
export async function approveEvaluation(id, approve = true){
  await delay(200);
  const d = db();
  const ev = d.evaluations.find(e => e.id === id);
  if (!ev) throw new Error('Evaluation not found');
  ev.approved = approve;
  ev.approvedAt = approve ? new Date().toISOString() : null;
  ev.approvedBy = approve ? d.examiner.name : null;
  store.save();
  return clone(ev);
}

/** Approve every question on a sheet that is not yet approved. */
export async function approveAllEvaluations(sheetId){
  await delay(420);
  const d = db();
  const rows = d.evaluations.filter(e => e.sheetId === sheetId && !e.approved);
  const stamp = new Date().toISOString();
  rows.forEach(e => { e.approved = true; e.approvedAt = stamp; e.approvedBy = d.examiner.name; });
  store.save();
  return clone(rows);
}

export async function approveSheet(id, approve = true){
  await delay(420);
  const d = db();
  const s = d.sheets.find(x => x.id === id);
  if (!s) throw new Error('Sheet not found');
  s.status = approve ? 'approved' : 'evaluated';
  s.approvedAt = approve ? new Date().toISOString() : null;
  s.approvedBy = approve ? d.examiner.name : null;
  /* Per-question approvals survive a sheet reopen. The examiner reopens the one
     question they need to change — which un-approves just that question — rather
     than re-checking a paper they have already worked through. */
  const exam = d.exams.find(e => e.id === s.examId);
  if (exam && d.sheets.filter(x => x.examId === exam.id).every(x => x.status === 'approved'))
    exam.status = 'completed';
  store.save();
  return clone(hydrate(s));
}

/* ── dashboard & results ───────────────────────────────────────────────── */
export async function getDashboard(){
  await delay(340);
  const d = db();
  const done = d.sheets.filter(s => s.status === 'evaluated' || s.status === 'approved');
  const pending = d.sheets.filter(s => s.status === 'pending' || s.status === 'processing');
  const avg = done.length ? done.reduce((a,s) => {
    const ex = d.exams.find(e => e.id === s.examId);
    return a + pct(s.marksObtained, ex?.totalMarks || 1);
  }, 0) / done.length : 0;

  /* 30-day evaluation trend, bucketed by day of evaluation */
  const days = 14, today = new Date(); today.setHours(0,0,0,0);
  const trend = Array.from({length:days}, (_,i) => {
    const day = new Date(today.getTime() - (days-1-i) * 864e5);
    const n = done.filter(s => s.evaluatedAt &&
      new Date(s.evaluatedAt).toDateString() === day.toDateString()).length;
    return { label: day.toLocaleDateString('en-GB',{day:'numeric',month:'short'}), value:n };
  });

  const buckets = [[0,34,'0–34'],[35,49,'35–49'],[50,64,'50–64'],[65,79,'65–79'],[80,89,'80–89'],[90,100,'90–100']];
  const dist = buckets.map(([lo,hi,label]) => ({ label, value: done.filter(s => {
    const ex = d.exams.find(e => e.id === s.examId);
    const p = pct(s.marksObtained, ex?.totalMarks || 1);
    return p >= lo && p <= hi;
  }).length }));

  return clone({
    totalExams: d.exams.length,
    activeExams: d.exams.filter(e => e.status === 'active').length,
    studentsEvaluated: new Set(done.map(s => s.studentId)).size,
    totalStudents: d.students.length,
    sheetsPending: pending.length,
    needsReview: d.sheets.filter(s => s.status === 'evaluated').length,
    approved: d.sheets.filter(s => s.status === 'approved').length,
    avgScore: Math.round(avg * 10) / 10,
    avgConfidence: done.length
      ? Math.round(done.reduce((a,s) => a + s.ocrConfidence, 0) / done.length * 10) / 10 : 0,
    trend, dist,
    recent: d.sheets.filter(s => s.evaluatedAt)
      .sort((a,b) => new Date(b.evaluatedAt) - new Date(a.evaluatedAt))
      .slice(0,6).map(hydrate),
    recentExams: d.exams.slice(0,4).map(e => {
      const sheets = d.sheets.filter(s => s.examId === e.id);
      const ok = sheets.filter(s => s.status === 'evaluated' || s.status === 'approved');
      return { id:e.id, name:e.name, subject:e.subject, className:e.className, date:e.date,
        status:e.status, done:ok.length, total:sheets.length,
        avg: ok.length ? Math.round(ok.reduce((a,s) => a + pct(s.marksObtained, e.totalMarks), 0) / ok.length) : null };
    }),
  });
}

export async function getResults(examId){
  await delay(320);
  const d = db();
  const exam = d.exams.find(e => e.id === examId);
  if (!exam) return null;
  const rows = d.sheets.filter(s => s.examId === examId).map(hydrate);
  const done = rows.filter(r => r.percentage !== null);
  const perQuestion = exam.questions.map(q => {
    const evs = d.evaluations.filter(e => e.questionId === q.id);
    const avg = evs.length ? evs.reduce((s,e) => s + e.finalMarks, 0) / evs.length : 0;
    return { label:`Q${q.no}`, value: Math.round(pct(avg, q.maxMarks)),
      avgMarks: Math.round(avg * 10) / 10, maxMarks:q.maxMarks, text:q.text };
  });
  const scores = done.map(r => r.percentage).sort((a,b) => a - b);
  return clone({
    exam, rows, perQuestion,
    stats: {
      appeared: rows.length, evaluated: done.length,
      avg: done.length ? Math.round(done.reduce((s,r) => s + r.percentage, 0) / done.length * 10) / 10 : 0,
      highest: scores.length ? scores[scores.length-1] : 0,
      lowest: scores.length ? scores[0] : 0,
      median: scores.length ? scores[Math.floor(scores.length/2)] : 0,
      passed: done.filter(r => r.percentage >= 35).length,
    },
  });
}

/* ── evaluator write-path ──────────────────────────────────────────────────
   Used only by evaluator.js. Behind a real backend these become
   PATCH /api/sheets/:id/progress and POST /api/sheets/:id/evaluation.        */
export async function _setProgress(sheetId, stage, progress, status){
  const s = db().sheets.find(x => x.id === sheetId);
  if (!s) return;
  s.stage = stage; s.progress = progress;
  if (status) s.status = status;
  store.save();
}
export async function _commitEvaluation(sheetId, rows){
  const d = db();
  const sheet = d.sheets.find(s => s.id === sheetId);
  if (!sheet) return;
  d.evaluations = d.evaluations.filter(e => e.sheetId !== sheetId);
  rows.forEach(r => d.evaluations.push({ ...r, sheetId, examId: sheet.examId }));
  sheet.marksObtained = Math.round(rows.reduce((s,r) => s + r.finalMarks, 0) * 2) / 2;
  sheet.ocrConfidence = Math.round(rows.reduce((s,r) => s + r.ocrConfidence, 0) / rows.length * 10) / 10;
  sheet.status = 'evaluated'; sheet.stage = 'complete'; sheet.progress = 100;
  sheet.evaluatedAt = new Date().toISOString();
  store.save();
  return clone(hydrate(sheet));
}
/** Raw question bank for a sheet's exam — the evaluator needs model answers. */
export async function _examFor(sheetId){
  const d = db();
  const s = d.sheets.find(x => x.id === sheetId);
  return s ? clone(d.exams.find(e => e.id === s.examId)) : null;
}
