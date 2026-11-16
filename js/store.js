/* localStorage-backed mock database. Only api.js should import this. */
import { EXAMS, STUDENTS, INSTITUTION, EXAMINER } from './seed.js';
import { hashRand } from './components.js';
import { pageRange } from './paging.js';

const KEY = 'testai.db.v1';
/* Bump whenever the shape of a stored record changes. A saved database from an
   older shape is rebuilt rather than loaded, so new fields are never silently
   missing (which showed up as "Page —" and absent approval state). */
const SCHEMA = 3;
const round2 = n => Math.round(n * 2) / 2;   // half-mark granularity

/* Which sheets exist, and how far each exam has progressed. */
const PLAN = {
  ex_phy_ut2: { classOf:'Class 12-A', approved:6, evaluated:4,  pending:0, daysAgo:14 },
  ex_bio_mid: { classOf:'Class 11-B', approved:2, evaluated:3,  pending:3, daysAgo:7  },
  ex_cs_t1:   { classOf:'Class 12-A', approved:0, evaluated:3,  pending:7, daysAgo:4  },
};

function build(){
  const exams = EXAMS.map(e => ({
    ...e,
    totalMarks: e.questions.reduce((s,q) => s + q.maxMarks, 0),
    questions: e.questions.map((q,i) => ({ ...q, id:`${e.id}_q${i+1}` })),
  }));

  const sheets = [], evaluations = [];
  const now = Date.now(), DAY = 864e5;

  for (const exam of exams){
    const plan = PLAN[exam.id];
    if (!plan) continue;
    const roster = STUDENTS.filter(s => s.className === plan.classOf);
    const base = now - plan.daysAgo * DAY;

    roster.forEach((student, idx) => {
      const status = idx < plan.approved ? 'approved'
                   : idx < plan.approved + plan.evaluated ? 'evaluated'
                   : 'pending';
      const sid = `sh_${exam.id}_${student.rollNo}`;
      const pages = 4 + Math.floor(hashRand(sid, 3) * 5);
      const uploadedAt = new Date(base + idx * 47e4 + hashRand(sid,9) * 36e5).toISOString();

      const sheet = {
        id: sid, examId: exam.id, studentId: student.id,
        fileName: `${student.rollNo}_${exam.code}_answersheet.pdf`,
        fileSize: Math.round((1.4 + hashRand(sid,4) * 3.2) * 1048576),
        pages, uploadedAt, status, stage: status === 'pending' ? null : 'complete',
        progress: status === 'pending' ? 0 : 100,
        ocrConfidence: 0, marksObtained: 0,
        evaluatedAt: null, approvedAt: null, approvedBy: null,
      };

      if (status !== 'pending'){
        const ability = hashRand(student.id, 11);
        let total = 0, confSum = 0;

        exam.questions.forEach((qn, qi) => {
          const jitter = hashRand(sid + qn.id, 17) * 0.34 - 0.17;
          const score = ability + jitter;
          const vi = score > 0.60 ? 0 : score > 0.32 ? 1 : 2;
          const v = qn.variants[vi] || qn.variants[qn.variants.length - 1];
          const marks = round2(v.ratio * qn.maxMarks);
          const conf = 0.80 + hashRand(sid + qn.id, 23) * 0.19;
          total += marks; confSum += conf;

          evaluations.push({
            id: `ev_${sid}_q${qi+1}`, sheetId: sid, examId: exam.id, questionId: qn.id,
            extractedAnswer: v.extracted, ocrConfidence: Math.round(conf * 1000) / 10,
            aiMarks: marks, finalMarks: marks, overridden: false, overrideReason: null,
            feedback: v.feedback, matched: v.matched, missing: v.missing, comment: null,
            approved: status === 'approved', approvedAt: null, approvedBy: null,
            ...pageRange(exam.questions, qi, pages),
          });
        });

        sheet.marksObtained = round2(total);
        sheet.ocrConfidence = Math.round((confSum / exam.questions.length) * 1000) / 10;
        sheet.evaluatedAt = new Date(new Date(uploadedAt).getTime() + 42e4).toISOString();
        if (status === 'approved'){
          sheet.approvedAt = new Date(new Date(sheet.evaluatedAt).getTime() + 864e5).toISOString();
          sheet.approvedBy = EXAMINER.name;
        }
      }
      sheets.push(sheet);
    });
  }

  /* A couple of authored examiner overrides so the review trail isn't empty.
     Deltas are relative to whatever the AI awarded, so the recorded reason always
     agrees with the direction of the change. */
  const tweak = (evId, delta, reason, comment) => {
    const ev = evaluations.find(e => e.id === evId);
    if (!ev) return;
    const sh = sheets.find(s => s.id === ev.sheetId);
    const exam = exams.find(e => e.id === sh?.examId);
    const qn = exam?.questions.find(q => q.id === ev.questionId);
    if (!qn) return;
    const next = Math.max(0, Math.min(qn.maxMarks, round2(ev.aiMarks + delta)));
    if (next === ev.aiMarks) return;          // nothing to record
    ev.finalMarks = next; ev.overridden = true; ev.overrideReason = reason;
    if (comment) ev.comment = comment;
    sh.marksObtained = round2(evaluations.filter(e => e.sheetId === sh.id)
      .reduce((s,e) => s + e.finalMarks, 0));
  };
  tweak('ev_sh_ex_phy_ut2_S-1201_q4', -2,
    'The power step reaches the right number by the wrong route. P = V\u00d7I with the terminal voltage is not what the question asked for, so two marks are withheld.',
    'Method mark withheld on the third part. The arithmetic coincides here, which is why the AI did not catch it \u2014 worth flagging in the answer key.');
  tweak('ev_sh_ex_phy_ut2_S-1204_q5', +3,
    'The mesh diagram on page 6 was too faint for OCR to pick up. It does contain the labelled loop currents, so the marks for that step are restored.',
    'Re-check page 6 against the original \u2014 the loop currents are drawn but very light. Credit given.');

  /* One sheet left part-way through review, so the per-question workflow is
     visible without the examiner having to start it themselves. */
  evaluations.filter(e => e.sheetId === 'sh_ex_phy_ut2_S-1207')
    .slice(0, 3)
    .forEach(e => { e.approved = true; e.approvedBy = EXAMINER.name;
                    e.approvedAt = new Date(now - 2 * DAY).toISOString(); });

  return {
    schema: SCHEMA,
    institution: INSTITUTION, examiner: EXAMINER,
    exams, students: STUDENTS, sheets, evaluations,
    settings: {
      theme:'light', strictness:'balanced', autoApprove:false, minConfidence:75,
      halfMarks:true, notifyOnComplete:true, model:'testai-eval-2.4',
    },
    createdAt: new Date().toISOString(),
  };
}

let db = null;
export function load(){
  if (db) return db;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw){
      const saved = JSON.parse(raw);
      if (saved.schema === SCHEMA){ db = saved; return db; }
      // older shape — reseed rather than serve records missing fields
    }
  } catch { /* corrupt or unavailable storage — fall through to a fresh seed */ }
  db = build(); save();
  return db;
}
export function save(){
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch { /* quota or private mode — the in-memory copy still works this session */ }
}
export function reset(){ db = build(); save(); return db; }
export const uid = p => p + '_' + Math.random().toString(36).slice(2,9);
