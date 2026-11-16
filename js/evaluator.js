/* ────────────────────────────────────────────────────────────────────────
   Simulated AI/OCR evaluation pipeline.

   Behind a real backend, runJob() would POST the answer sheet to an
   OCR + LLM grading service and stream progress back over SSE/websocket.
   The stage list, the progress events and the shape of the committed
   result are all designed to survive that swap unchanged.
   ──────────────────────────────────────────────────────────────────────── */
import * as api from './api.js';
import { hashRand } from './components.js';
import { pageRange } from './paging.js';

export const STAGES = [
  { key:'reading',    label:'Reading document',                  detail:'Splitting pages, correcting skew',        ms:900  },
  { key:'extracting', label:'Extracting handwriting (OCR)',      detail:'Transcribing handwritten regions',        ms:2200 },
  { key:'matching',   label:'Matching answers to questions',     detail:'Locating question numbers and boundaries', ms:1200 },
  { key:'comparing',  label:'Semantic comparison with key',      detail:'Embedding answers against the model answer', ms:1900 },
  { key:'scoring',    label:'Assigning marks and feedback',      detail:'Scoring concepts, drafting reasoning',     ms:1400 },
];
export const stageIndex = key => STAGES.findIndex(s => s.key === key);

const listeners = new Set();
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = ev => listeners.forEach(fn => { try { fn(ev); } catch { /* a bad listener must not stall the queue */ } });

const running = new Map();          // sheetId -> job state
export const isRunning = id => running.has(id);
export const activeJobs = () => [...running.values()];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const round2 = n => Math.round(n * 2) / 2;

/** Speed multiplier — Settings can slow this down for demos. */
export let speed = 1;
export const setSpeed = s => { speed = s; };

/**
 * Grade one sheet. Deterministic: the same sheet always produces the same
 * result, so a re-run after a reset reproduces the demo exactly.
 */
async function grade(sheetId, exam){
  const sheet = await api.getSheet(sheetId);
  const ability = hashRand(sheet.studentId, 11);
  return exam.questions.map((qn, qi) => {
    const pages = pageRange(exam.questions, qi, sheet.pages);
    const jitter = hashRand(sheetId + qn.id, 17) * 0.34 - 0.17;
    const score = ability + jitter;
    const vi = score > 0.60 ? 0 : score > 0.32 ? 1 : 2;
    const v = qn.variants?.[vi] || qn.variants?.[qn.variants.length - 1];
    if (!v){
      return { id:`ev_${sheetId}_q${qi+1}`, questionId:qn.id, extractedAnswer:'[No answer detected on the sheet]',
        ocrConfidence:0, aiMarks:0, finalMarks:0, overridden:false, overrideReason:null,
        feedback:'No answer could be located for this question. The examiner should verify the page order.',
        matched:[], missing:qn.keyConcepts, comment:null,
        approved:false, approvedAt:null, approvedBy:null, ...pages };
    }
    const marks = round2(v.ratio * qn.maxMarks);
    return {
      id:`ev_${sheetId}_q${qi+1}`, questionId:qn.id,
      extractedAnswer:v.extracted,
      ocrConfidence: Math.round((0.80 + hashRand(sheetId + qn.id, 23) * 0.19) * 1000) / 10,
      aiMarks:marks, finalMarks:marks, overridden:false, overrideReason:null,
      feedback:v.feedback, matched:v.matched, missing:v.missing, comment:null,
      approved:false, approvedAt:null, approvedBy:null, ...pages,
    };
  });
}

/** Run the full pipeline for one sheet, emitting progress as it goes. */
export async function runJob(sheetId){
  if (running.has(sheetId)) return running.get(sheetId).promise;

  const job = { sheetId, stage:STAGES[0].key, progress:0, startedAt:Date.now() };
  const promise = (async () => {
    const exam = await api._examFor(sheetId);
    const total = STAGES.reduce((s,x) => s + x.ms, 0);
    let elapsed = 0;

    await api._setProgress(sheetId, STAGES[0].key, 0, 'processing');
    emit({ type:'start', sheetId, job });

    for (const stage of STAGES){
      job.stage = stage.key;
      const ticks = Math.max(3, Math.round(stage.ms / 220));
      for (let t = 0; t < ticks; t++){
        await sleep((stage.ms / ticks) / speed);
        elapsed += stage.ms / ticks;
        job.progress = Math.min(99, Math.round((elapsed / total) * 100));
        await api._setProgress(sheetId, stage.key, job.progress);
        emit({ type:'progress', sheetId, job:{ ...job } });
      }
    }

    const rows = await grade(sheetId, exam);
    const sheet = await api._commitEvaluation(sheetId, rows);
    job.stage = 'complete'; job.progress = 100;
    running.delete(sheetId);
    emit({ type:'complete', sheetId, job:{ ...job }, sheet });
    return sheet;
  })().catch(err => {
    running.delete(sheetId);
    api._setProgress(sheetId, null, 0, 'pending');
    emit({ type:'error', sheetId, error:err });
    throw err;
  });

  job.promise = promise;
  running.set(sheetId, job);
  return promise;
}

/** Run many sheets with bounded concurrency, as a real queue would. */
export async function runBatch(sheetIds, concurrency = 2){
  const queue = [...sheetIds];
  emit({ type:'batch-start', count: queue.length });
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length){
      const id = queue.shift();
      try { await runJob(id); } catch { /* one bad sheet must not stop the batch */ }
    }
  });
  await Promise.all(workers);
  emit({ type:'batch-complete', count: sheetIds.length });
}
