import { icon } from '../icons.js';
import * as api from '../api.js';
import { $, $$, esc, Dropzone, toast, fmtBytes, Empty, confirmModal } from '../components.js';
import { go } from '../router.js';
import { refreshCounts } from '../app.js';

const STEPS = ['Exam details', 'Question paper', 'Questions & answer key', 'Review'];

/* A starter question so step 3 is never an empty screen. */
const blank = () => ({ text:'', type:'Short answer', maxMarks:5, modelAnswer:'', keyConcepts:[] });

export async function render(){
  const el = document.createElement('div');
  el.className = 'view';

  const state = {
    step: 0,
    details: { name:'', subject:'Physics', code:'', className:'Class 12-A',
               date:new Date(Date.now() + 12096e5).toISOString().slice(0,10), duration:90 },
    paperFile: null, keyFile: null,
    questions: [blank()],
  };

  el.innerHTML = `
    <div class="view-head">
      <div class="titles"><h1>Upload question paper</h1>
        <p>Create an examination, attach the paper and the official answer key, then define marks for each question.</p></div>
    </div>
    <div class="grid g-2-1">
      <div class="card">
        <div class="steps" id="steps"></div>
        <div id="stepBody"></div>
        <div class="card-foot">
          <button class="btn" id="backBtn">${icon('arrowLeft')}Back</button>
          <div style="flex:1"></div>
          <span id="stepHint" style="font-size:12.3px;color:var(--muted)"></span>
          <button class="btn btn-primary" id="nextBtn">Continue${icon('arrowRight')}</button>
        </div>
      </div>
      <div class="stack" id="aside"></div>
    </div>`;

  const stepsEl = el.querySelector('#steps');
  const body = el.querySelector('#stepBody');
  const aside = el.querySelector('#aside');

  const totalMarks = () => state.questions.reduce((s,q) => s + (+q.maxMarks || 0), 0);

  function drawSteps(){
    stepsEl.innerHTML = STEPS.map((s,i) => `
      ${i ? `<div class="step-line ${i <= state.step ? 'done' : ''}"></div>` : ''}
      <div class="step ${i === state.step ? 'on' : i < state.step ? 'done' : ''}">
        <div class="n">${i < state.step ? icon('check') : i+1}</div><b>${esc(s)}</b>
      </div>`).join('');
  }

  function drawAside(){
    const d = state.details;
    aside.innerHTML = `
      <div class="card">
        <div class="card-head"><div><h3>Exam summary</h3></div></div>
        <div class="card-body"><dl class="kv">
          <dt>Name</dt><dd style="text-align:right;max-width:180px">${esc(d.name || '—')}</dd>
          <dt>Subject</dt><dd>${esc(d.subject)}</dd>
          <dt>Code</dt><dd>${esc(d.code || '—')}</dd>
          <dt>Class</dt><dd>${esc(d.className)}</dd>
          <dt>Questions</dt><dd>${state.questions.length}</dd>
          <dt>Total marks</dt><dd>${totalMarks()}</dd>
          <dt>Question paper</dt><dd>${state.paperFile ? '✓ attached' : '—'}</dd>
          <dt>Answer key</dt><dd>${state.keyFile ? '✓ attached' : '—'}</dd>
        </dl></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>How evaluation works</h3></div></div>
        <div class="card-body">
          <p style="font-size:12.7px;color:var(--text-2);line-height:1.65">
            Your model answer and its key concepts become the reference the AI grades against.
            It compares meaning rather than matching keywords, so a student who expresses the
            same idea in different words still earns the marks — and one who reproduces your
            wording without the underlying concept does not.</p>
          <div class="comment-note" style="margin-top:12px">${icon('info')}
            <span>The more precisely you list key concepts, the more specific the AI's feedback and the fewer overrides you will need.</span></div>
        </div>
      </div>`;
  }

  /* ── step 1 ───────────────────────────────────────────────────────── */
  function step0(){
    const d = state.details;
    body.innerHTML = `<div class="card-body stack" style="gap:15px">
      <div class="field"><label for="f-name">Examination name</label>
        <input class="input" id="f-name" placeholder="e.g. Physics Unit Test II — Current Electricity" value="${esc(d.name)}">
        <span class="hint">Shown to examiners on the dashboard and on every result sheet.</span></div>
      <div class="grid g-2" style="gap:15px">
        <div class="field"><label for="f-subject">Subject</label>
          <select class="select" id="f-subject">${['Physics','Chemistry','Biology','Mathematics','Computer Science','English','History','Economics']
            .map(s => `<option ${s===d.subject?'selected':''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label for="f-code">Exam code</label>
          <input class="input" id="f-code" placeholder="e.g. PHY-12-UT2" value="${esc(d.code)}"></div>
        <div class="field"><label for="f-class">Class / section</label>
          <select class="select" id="f-class">${['Class 12-A','Class 12-B','Class 11-A','Class 11-B']
            .map(s => `<option ${s===d.className?'selected':''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label for="f-date">Examination date</label>
          <input class="input" id="f-date" type="date" value="${d.date}"></div>
        <div class="field"><label for="f-dur">Duration (minutes)</label>
          <input class="input" id="f-dur" type="number" min="15" step="15" value="${d.duration}"></div>
      </div>
    </div>`;
    const bind = (id, key, num) => el.querySelector(id).oninput = e => {
      d[key] = num ? +e.target.value : e.target.value; drawAside(); validate();
    };
    bind('#f-name','name'); bind('#f-code','code'); bind('#f-date','date'); bind('#f-dur','duration', true);
    el.querySelector('#f-subject').onchange = e => { d.subject = e.target.value; drawAside(); };
    el.querySelector('#f-class').onchange = e => { d.className = e.target.value; drawAside(); };
  }

  /* ── step 2 ───────────────────────────────────────────────────────── */
  function step1(){
    body.innerHTML = `<div class="card-body stack" style="gap:18px">
      <div>
        <div class="pane-head" style="margin-bottom:10px">${icon('fileText')}<h5>Question paper</h5></div>
        <div id="dz1"></div><div id="f1" style="margin-top:10px"></div>
      </div>
      <div>
        <div class="pane-head" style="margin-bottom:10px">${icon('check')}<h5>Official answer key <span style="text-transform:none;letter-spacing:0;font-weight:500;color:var(--muted)">— optional, you can type answers in the next step</span></h5></div>
        <div id="dz2"></div><div id="f2" style="margin-top:10px"></div>
      </div>
    </div>`;

    const mount = (host, out, key, title) => {
      const draw = () => {
        const f = state[key];
        el.querySelector(out).innerHTML = f
          ? `<div class="file-row"><div class="file-ico t-brand">${icon('file')}</div>
              <div class="meta"><b>${esc(f.name)}</b><span>${fmtBytes(f.size)} · ready</span></div>
              <button class="icon-btn" data-rm="${key}">${icon('x')}</button></div>` : '';
        const rm = el.querySelector(`[data-rm="${key}"]`);
        if (rm) rm.onclick = () => { state[key] = null; draw(); drawAside(); validate(); };
      };
      el.querySelector(host).replaceChildren(Dropzone({
        accept:'.pdf,.docx,.jpg,.png', multiple:false, title,
        body:'Drag a file here, or click to browse',
        formats:['PDF','DOCX','JPG','PNG'],
        onFiles: files => {
          state[key] = { name:files[0].name, size:files[0].size };
          draw(); drawAside(); validate();
          toast('File attached', files[0].name, 'ok');
        },
      }));
      draw();
    };
    mount('#dz1', '#f1', 'paperFile', 'Upload the question paper');
    mount('#dz2', '#f2', 'keyFile', 'Upload the answer key');
  }

  /* ── step 3 ───────────────────────────────────────────────────────── */
  function step2(){
    body.innerHTML = `
      <div class="filters">
        <b style="font-size:13px">${state.questions.length} question${state.questions.length===1?'':'s'}</b>
        <span class="badge brand"><i></i>${totalMarks()} marks total</span>
        <div style="flex:1"></div>
        <button class="btn btn-sm" id="autoBtn">${icon('sparkles')}Auto-detect from paper</button>
        <button class="btn btn-sm btn-primary" id="addQ">${icon('plus')}Add question</button>
      </div>
      <div class="card-body" id="qList"></div>`;

    const list = el.querySelector('#qList');
    const drawList = () => {
      list.innerHTML = state.questions.map((q,i) => `
        <div class="q-item" data-q="${i}">
          <div class="q-item-head">
            <div class="q-no">${i+1}</div>
            <div class="qt" style="flex:1">${esc(q.text || 'Untitled question')}</div>
            <select class="select" data-type="${i}" style="width:150px;height:31px;font-size:12.4px">
              ${['Short answer','Long answer','Numerical','Diagram + short answer','MCQ']
                .map(t => `<option ${t===q.type?'selected':''}>${t}</option>`).join('')}
            </select>
            <div class="marks-input">
              <button data-dec="${i}" aria-label="Decrease marks">−</button>
              <input type="number" min="1" max="100" value="${q.maxMarks}" data-marks="${i}" aria-label="Marks">
              <button data-inc="${i}" aria-label="Increase marks">+</button>
            </div>
            <button class="icon-btn" data-rmq="${i}" title="Remove question" ${state.questions.length===1?'disabled style="opacity:.35"':''}>${icon('trash')}</button>
          </div>
          <div class="q-item-body">
            <div class="field"><label>Question text</label>
              <textarea class="textarea" data-text="${i}" style="min-height:62px"
                placeholder="Type the question exactly as it appears on the paper…">${esc(q.text)}</textarea></div>
            <div class="field"><label>Model / expected answer</label>
              <textarea class="textarea" data-ans="${i}"
                placeholder="Write the full-mark answer. The AI grades student answers against this.">${esc(q.modelAnswer)}</textarea></div>
            <div class="field"><label>Key concepts <span class="hint" style="font-weight:500">— comma separated; the AI reports which are present and which are missing</span></label>
              <input class="input" data-kc="${i}" value="${esc(q.keyConcepts.join(', '))}"
                placeholder="e.g. V = IR, constant temperature condition, applies to metallic conductors"></div>
          </div>
        </div>`).join('');

      $$('[data-text]', list).forEach(t => t.oninput = e => {
        state.questions[+t.dataset.text].text = e.target.value;
        list.querySelector(`[data-q="${t.dataset.text}"] .qt`).textContent = e.target.value || 'Untitled question';
        validate();
      });
      $$('[data-ans]', list).forEach(t => t.oninput = e => { state.questions[+t.dataset.ans].modelAnswer = e.target.value; validate(); });
      $$('[data-kc]', list).forEach(t => t.oninput = e => {
        state.questions[+t.dataset.kc].keyConcepts = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
      });
      $$('[data-type]', list).forEach(t => t.onchange = e => { state.questions[+t.dataset.type].type = e.target.value; });
      $$('[data-marks]', list).forEach(t => t.oninput = e => {
        state.questions[+t.dataset.marks].maxMarks = Math.max(1, +e.target.value || 1);
        refreshMarks(); drawAside();
      });
      $$('[data-inc]', list).forEach(b => b.onclick = () => { state.questions[+b.dataset.inc].maxMarks++; drawList(); drawAside(); });
      $$('[data-dec]', list).forEach(b => b.onclick = () => {
        const q = state.questions[+b.dataset.dec]; q.maxMarks = Math.max(1, q.maxMarks - 1); drawList(); drawAside();
      });
      $$('[data-rmq]', list).forEach(b => b.onclick = () => {
        if (state.questions.length === 1) return;
        state.questions.splice(+b.dataset.rmq, 1); drawList(); refreshMarks(); drawAside(); validate();
      });
    };
    const refreshMarks = () => {
      el.querySelector('.filters .badge').innerHTML = `<i></i>${totalMarks()} marks total`;
      el.querySelector('.filters b').textContent = `${state.questions.length} question${state.questions.length===1?'':'s'}`;
    };

    el.querySelector('#addQ').onclick = () => { state.questions.push(blank()); drawList(); refreshMarks(); drawAside(); validate(); };
    el.querySelector('#autoBtn').onclick = () => {
      if (!state.paperFile) return toast('No question paper attached', 'Go back and upload the paper first', 'warn');
      const btn = el.querySelector('#autoBtn');
      btn.innerHTML = '<span class="spinner"></span>Reading paper…'; btn.disabled = true;
      setTimeout(() => {
        state.questions = [
          { text:'State Ohm\'s law and write its mathematical form. Mention one condition under which it holds.',
            type:'Short answer', maxMarks:5, modelAnswer:'', keyConcepts:['V = IR','constant temperature'] },
          { text:'Define resistivity and explain how it varies with temperature for a metallic conductor.',
            type:'Short answer', maxMarks:5, modelAnswer:'', keyConcepts:['ρ = RA/L','increases with temperature'] },
          { text:'Derive an expression for the equivalent resistance of three resistors connected in parallel.',
            type:'Long answer', maxMarks:10, modelAnswer:'', keyConcepts:['same potential difference','1/Req = Σ1/Ri'] },
        ];
        drawList(); refreshMarks(); drawAside(); validate();
        btn.innerHTML = `${icon('sparkles')}Auto-detect from paper`; btn.disabled = false;
        toast('3 questions detected', 'Review the text and add model answers', 'ok');
      }, 1800);
    };
    drawList();
  }

  /* ── step 4 ───────────────────────────────────────────────────────── */
  function step3(){
    const d = state.details;
    const noAnswers = state.questions.filter(q => !q.modelAnswer.trim()).length;
    body.innerHTML = `<div class="card-body stack" style="gap:16px">
      ${noAnswers ? `<div class="comment-note" style="background:var(--warn-bg);color:var(--warn-fg)">
        ${icon('alertTri')}<span><b>${noAnswers} question${noAnswers>1?'s have':' has'} no model answer.</b>
        The AI can still transcribe those answers, but it cannot score them until a model answer exists.</span></div>` : ''}
      <div class="grid g-2" style="gap:16px">
        <div><div class="pane-head">${icon('fileText')}<h5>Examination</h5></div>
          <dl class="kv" style="margin-top:9px">
            <dt>Name</dt><dd>${esc(d.name)}</dd><dt>Subject</dt><dd>${esc(d.subject)}</dd>
            <dt>Code</dt><dd>${esc(d.code || '—')}</dd><dt>Class</dt><dd>${esc(d.className)}</dd>
            <dt>Date</dt><dd>${esc(d.date)}</dd><dt>Duration</dt><dd>${d.duration} min</dd>
          </dl></div>
        <div><div class="pane-head">${icon('layers')}<h5>Paper</h5></div>
          <dl class="kv" style="margin-top:9px">
            <dt>Questions</dt><dd>${state.questions.length}</dd>
            <dt>Total marks</dt><dd>${totalMarks()}</dd>
            <dt>With model answer</dt><dd>${state.questions.length - noAnswers} of ${state.questions.length}</dd>
            <dt>Question paper</dt><dd>${state.paperFile ? esc(state.paperFile.name) : '—'}</dd>
            <dt>Answer key</dt><dd>${state.keyFile ? esc(state.keyFile.name) : '—'}</dd>
          </dl></div>
      </div>
      <div>
        <div class="pane-head" style="margin-bottom:10px">${icon('check')}<h5>Questions</h5></div>
        <div class="table-wrap"><table class="data"><thead><tr>
          <th style="width:44px">#</th><th>Question</th><th>Type</th><th style="text-align:right">Marks</th><th>Key concepts</th>
        </tr></thead><tbody>${state.questions.map((q,i) => `<tr>
          <td><div class="q-no">${i+1}</div></td>
          <td><b style="font-weight:580">${esc(q.text || 'Untitled question')}</b></td>
          <td><span class="chip">${esc(q.type)}</span></td>
          <td class="num">${q.maxMarks}</td>
          <td>${q.keyConcepts.length ? q.keyConcepts.slice(0,2).map(c => `<span class="chip">${esc(c)}</span>`).join(' ')
             + (q.keyConcepts.length > 2 ? ` <span class="chip">+${q.keyConcepts.length-2}</span>` : '')
             : '<span style="color:var(--muted);font-size:12px">none listed</span>'}</td>
        </tr>`).join('')}</tbody></table></div>
      </div>
    </div>`;
  }

  /* ── navigation ───────────────────────────────────────────────────── */
  const renderers = [step0, step1, step2, step3];

  function validate(){
    const next = el.querySelector('#nextBtn');
    const hint = el.querySelector('#stepHint');
    let ok = true, msg = '';
    if (state.step === 0){
      ok = state.details.name.trim().length > 2;
      msg = ok ? '' : 'An examination name is required';
    } else if (state.step === 1){
      ok = !!state.paperFile;
      msg = ok ? '' : 'Attach the question paper to continue';
    } else if (state.step === 2){
      ok = state.questions.every(q => q.text.trim());
      msg = ok ? '' : 'Every question needs its text';
    }
    next.disabled = !ok;
    hint.textContent = msg;
    next.innerHTML = state.step === 3 ? `${icon('check')}Create examination` : `Continue${icon('arrowRight')}`;
    el.querySelector('#backBtn').style.visibility = state.step ? 'visible' : 'hidden';
  }

  function goTo(i){
    state.step = i; drawSteps(); renderers[i](); drawAside(); validate();
    el.scrollIntoView({ block:'start' });
  }

  el.querySelector('#backBtn').onclick = () => goTo(Math.max(0, state.step - 1));
  el.querySelector('#nextBtn').onclick = async () => {
    if (state.step < 3) return goTo(state.step + 1);
    const btn = el.querySelector('#nextBtn');
    btn.innerHTML = '<span class="spinner"></span>Creating…'; btn.disabled = true;
    const exam = await api.createExam({
      ...state.details,
      code: state.details.code || state.details.subject.slice(0,3).toUpperCase() + '-NEW',
      paperFile: state.paperFile?.name || null,
      keyFile: state.keyFile?.name || null,
      questions: state.questions,
    });
    await refreshCounts();
    toast('Examination created', `${exam.name} · ${exam.totalMarks} marks`, 'ok');
    go('/exams/' + exam.id);
  };

  goTo(0);
  return el;
}
