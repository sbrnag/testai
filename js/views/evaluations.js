import { icon } from '../icons.js';
import * as api from '../api.js';
import * as evaluator from '../evaluator.js';
import { $, $$, esc, StatusBadge, StatCard, Avatar, DataTable, Empty, toast,
         toneOf, ago, fmtBytes } from '../components.js';
import { go } from '../router.js';
import { refreshCounts } from '../app.js';

export async function render(_params, query){
  const el = document.createElement('div');
  el.className = 'view';
  const exams = await api.getExams();
  let examId = query.exam || '';
  let statusFilter = '';
  let sheets = [];

  el.innerHTML = `
    <div class="view-head">
      <div class="titles"><h1>Evaluations</h1>
        <p>Run the AI pipeline over uploaded answer sheets and review what it produced.</p></div>
      <div class="actions">
        <button class="btn" id="runAllBtn">${icon('play')}Run pending</button>
        <a class="btn btn-primary" href="#/upload-sheets">${icon('uploadCloud')}Upload sheets</a>
      </div>
    </div>
    <div class="grid g-4" id="stats" style="margin-bottom:16px"></div>
    <div id="liveHost"></div>
    <div class="card">
      <div class="filters">
        <div class="search-inline">${icon('search')}<input class="input" id="q" placeholder="Search student or roll number…"></div>
        <select class="select" id="fExam"><option value="">All exams</option>${exams.map(e =>
          `<option value="${e.id}" ${e.id===examId?'selected':''}>${esc(e.name)}</option>`).join('')}</select>
        <select class="select" id="fStatus">
          <option value="">All statuses</option><option value="pending">Pending</option>
          <option value="processing">Processing</option><option value="evaluated">Needs review</option>
          <option value="approved">Approved</option>
        </select>
        <div style="flex:1"></div>
        <span style="font-size:12.4px;color:var(--muted)" id="countLbl"></span>
      </div>
      <div id="list"></div>
    </div>`;

  const statsHost = el.querySelector('#stats');
  const liveHost  = el.querySelector('#liveHost');
  const listHost  = el.querySelector('#list');

  async function reload(){
    sheets = await api.getSheets(examId ? { examId } : {});
    drawStats(); drawList(); drawLive();
  }

  function drawStats(){
    const pend = sheets.filter(s => s.status === 'pending').length;
    const proc = sheets.filter(s => s.status === 'processing').length;
    const rev  = sheets.filter(s => s.status === 'evaluated').length;
    const app  = sheets.filter(s => s.status === 'approved').length;
    statsHost.innerHTML =
      StatCard({label:'Pending evaluation', value:pend, iconName:'inbox', tone:'warn',
                foot: pend ? 'Ready to queue' : 'Queue is clear'}) +
      StatCard({label:'Processing now', value:proc, iconName:'cpu', tone:'brand',
                foot: proc ? 'OCR and scoring in flight' : 'Pipeline idle'}) +
      StatCard({label:'Awaiting your review', value:rev, iconName:'alertTri', tone:'info',
                foot:'AI evaluated, not approved'}) +
      StatCard({label:'Approved', value:app, iconName:'checkCircle', tone:'ok', foot:'Final marks locked'});
    const btn = el.querySelector('#runAllBtn');
    btn.disabled = !pend;
    btn.innerHTML = `${icon('play')}Run pending${pend ? ` (${pend})` : ''}`;
  }

  /* ── live pipeline panel ──────────────────────────────────────────── */
  function drawLive(){
    const active = sheets.filter(s => s.status === 'processing');
    if (!active.length){ liveHost.innerHTML = ''; return; }
    liveHost.innerHTML = `<div class="card" style="margin-bottom:16px;border-color:var(--brand-400)">
      <div class="card-head">
        <div><h3 class="row" style="gap:8px">${icon('cpu')}AI evaluation in progress</h3>
          <p>${active.length} answer sheet${active.length>1?'s':''} moving through the pipeline</p></div>
        <div class="actions"><span class="badge brand pulse"><i></i>Live</span></div>
      </div>
      <div class="card-body" id="liveBody">${active.map(liveCard).join('')}</div>
    </div>`;
  }

  function liveCard(s){
    const idx = evaluator.stageIndex(s.stage);
    return `<div class="proc-card" data-live="${s.id}">
      <div class="row" style="gap:11px;margin-bottom:12px">
        ${Avatar(s.studentName)}
        <div style="flex:1;min-width:0">
          <b style="font-size:13.3px;font-weight:620">${esc(s.studentName)}</b>
          <div style="font-size:11.7px;color:var(--muted)">${esc(s.rollNo)} · ${esc(s.fileName)} · ${s.pages} pages</div>
        </div>
        <div style="text-align:right;flex:0 0 auto">
          <b style="font-size:16px;font-weight:700;font-variant-numeric:tabular-nums">${s.progress}%</b>
        </div>
      </div>
      <div class="bar" style="margin-bottom:12px"><i style="width:${s.progress}%"></i></div>
      <div class="pipeline">${evaluator.STAGES.map((st,i) => `
        <div class="pipe-stage ${i < idx ? 'done' : i === idx ? 'active' : ''}">
          <div class="pd">${i < idx ? icon('check') : i === idx ? '<span class="spinner" style="width:11px;height:11px;border-width:1.6px;border-top-color:#fff;border-color:rgba(255,255,255,.35);border-top-color:#fff"></span>' : ''}</div>
          <div><div class="pt">${esc(st.label)}</div>
            ${i === idx ? `<div style="font-size:11.3px;color:var(--muted)">${esc(st.detail)}</div>` : ''}</div>
          <span class="pm">${i < idx ? 'done' : i === idx ? 'running' : ''}</span>
        </div>`).join('')}</div>
    </div>`;
  }

  /* ── table ────────────────────────────────────────────────────────── */
  function drawList(){
    const q = el.querySelector('#q').value.trim().toLowerCase();
    const rows = sheets.filter(s =>
      (!statusFilter || s.status === statusFilter) &&
      (!q || (s.studentName + s.rollNo + s.fileName).toLowerCase().includes(q)));
    el.querySelector('#countLbl').textContent = `${rows.length} of ${sheets.length} sheets`;

    if (!rows.length){
      listHost.innerHTML = Empty({ iconName:'cpu', title:'No answer sheets here',
        body:'Upload scanned answer sheets to start evaluating.',
        action:`<a class="btn btn-primary" href="#/upload-sheets">${icon('uploadCloud')}Upload answer sheets</a>` });
      return;
    }
    listHost.replaceChildren(DataTable({
      rows,
      onRow: r => { if (r.status !== 'pending' && r.status !== 'processing') go('/evaluations/' + r.id); },
      cols:[
        { key:'studentName', label:'Student', render:r => `<div class="cell-user">${Avatar(r.studentName)}
            <div><b>${esc(r.studentName)}</b><span>${esc(r.rollNo)} · ${esc(r.className)}</span></div></div>` },
        { key:'examName', label:'Exam', render:r => `<div><b style="font-weight:560;font-size:12.8px">${esc(r.examName)}</b>
            <div class="cell-sub">${esc(r.examCode)}</div></div>` },
        { key:'pages', label:'Pages', align:'right', render:r => `${r.pages}<div class="cell-sub">${fmtBytes(r.fileSize)}</div>` },
        { key:'ocrConfidence', label:'OCR conf.', align:'right', render:r => r.ocrConfidence
            ? `<span class="badge ${r.ocrConfidence>=90?'ok':r.ocrConfidence>=80?'warn':'bad'}"><i></i>${r.ocrConfidence}%</span>`
            : '<span style="color:var(--muted)">—</span>' },
        { key:'marksObtained', label:'Marks', align:'right', render:r => r.percentage === null
            ? '<span style="color:var(--muted)">—</span>'
            : `<b>${r.marksObtained}</b><span style="color:var(--muted);font-weight:500">/${r.totalMarks}</span>
               <div class="cell-sub" style="text-align:right">${r.percentage}%</div>` },
        { key:'status', label:'Status', render:r => r.status === 'processing'
            ? `<div style="min-width:120px">${StatusBadge(r.status)}
                <div class="bar" style="margin-top:6px;height:4px"><i style="width:${r.progress}%"></i></div></div>`
            : StatusBadge(r.status) },
        { key:'act', label:'', sortable:false, render:r => r.status === 'pending'
            ? `<button class="btn btn-sm btn-primary" data-run="${r.id}">${icon('play')}Evaluate</button>`
            : r.status === 'processing'
              ? `<span style="font-size:12px;color:var(--muted)">${r.progress}%</span>`
              : `<a class="btn btn-sm" href="#/evaluations/${r.id}">${icon('eye')}Review</a>` },
      ],
    }));
    $$('[data-run]', listHost).forEach(b => b.onclick = async e => {
      e.stopPropagation();
      b.innerHTML = '<span class="spinner"></span>'; b.disabled = true;
      evaluator.runJob(b.dataset.run);
    });
  }

  /* ── live updates from the pipeline ───────────────────────────────── */
  const unsub = evaluator.subscribe(async ev => {
    if (!el.isConnected) return unsub();
    const i = sheets.findIndex(s => s.id === ev.sheetId);
    if (ev.type === 'progress' || ev.type === 'start'){
      if (i > -1){
        sheets[i] = { ...sheets[i], status:'processing', stage:ev.job.stage, progress:ev.job.progress };
        const card = el.querySelector(`[data-live="${ev.sheetId}"]`);
        if (card) card.outerHTML = liveCard(sheets[i]);
        else { drawLive(); drawStats(); drawList(); }
      }
    }
    if (ev.type === 'complete'){
      await reload();
      toast('Evaluation complete', `${ev.sheet.studentName} — ${ev.sheet.marksObtained}/${ev.sheet.totalMarks}`, 'ok');
      refreshCounts();
    }
  });

  el.querySelector('#runAllBtn').onclick = () => {
    const ids = sheets.filter(s => s.status === 'pending').map(s => s.id);
    if (!ids.length) return;
    evaluator.runBatch(ids);
    toast(`Queued ${ids.length} sheet${ids.length>1?'s':''}`, 'Two sheets are processed at a time', 'info');
  };
  el.querySelector('#q').oninput = drawList;
  el.querySelector('#fExam').onchange = e => { examId = e.target.value; reload(); };
  el.querySelector('#fStatus').onchange = e => { statusFilter = e.target.value; drawList(); };

  await reload();
  return el;
}
