import { icon } from '../icons.js';
import * as api from '../api.js';
import { $, $$, esc, StatusBadge, Avatar, DataTable, fmtDate, fmtBytes, ago, toneOf,
         Empty, toast, Modal, Bar, BarChart } from '../components.js';
import { go, path } from '../router.js';
import { setCrumbs } from '../app.js';

export async function render({ id }){
  const here = path();
  const [exam, sheets, results] = await Promise.all([
    api.getExam(id), api.getSheets({ examId:id }), api.getResults(id),
  ]);
  const el = document.createElement('div');
  el.className = 'view';
  if (!exam){ el.innerHTML = Empty({ title:'Exam not found' }); return el; }

  if (path() === here){          // still the visible route — safe to claim the chrome
    setCrumbs([{ label:'Exams', href:'/exams' }, { label:exam.name }]);
    document.title = `${exam.name} · Test AI`;
  }

  const done = sheets.filter(s => s.status !== 'pending' && s.status !== 'processing');
  const pending = sheets.filter(s => s.status === 'pending');

  el.innerHTML = `
    <div class="view-head">
      <div class="titles">
        <a class="btn btn-sm btn-ghost" href="#/exams" style="margin-bottom:8px;margin-left:-10px">${icon('arrowLeft')}All exams</a>
        <div class="row" style="gap:11px"><h1>${esc(exam.name)}</h1>${StatusBadge(exam.status)}</div>
        <p>${esc(exam.code)} · ${esc(exam.className)} · ${fmtDate(exam.date)} · ${exam.duration} minutes · ${exam.totalMarks} marks</p>
      </div>
      <div class="actions">
        <button class="btn" id="exportBtn">${icon('download')}Export results</button>
        ${pending.length ? `<a class="btn" href="#/upload-sheets?exam=${exam.id}">${icon('uploadCloud')}Upload sheets</a>` : ''}
        <a class="btn btn-primary" href="#/results/${exam.id}">${icon('chart')}View results</a>
      </div>
    </div>

    <div class="grid g-2-1">
      <div class="stack">
        <div class="card">
          <div class="tabs" id="tabs">
            <button class="on" data-t="questions">Question paper &amp; key (${exam.questions.length})</button>
            <button data-t="sheets">Answer sheets (${sheets.length})</button>
            <button data-t="analysis">Question analysis</button>
          </div>
          <div id="tabBody"></div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h3>Evaluation progress</h3></div></div>
          <div class="card-body stack">
            ${Bar(done.length, sheets.length || 1, pending.length ? 'warn' : 'ok')}
            <dl class="kv">
              <dt>Sheets uploaded</dt><dd>${sheets.length}</dd>
              <dt>AI evaluated</dt><dd>${done.length}</dd>
              <dt>Awaiting review</dt><dd>${sheets.filter(s=>s.status==='evaluated').length}</dd>
              <dt>Approved</dt><dd>${sheets.filter(s=>s.status==='approved').length}</dd>
              <dt>Not yet processed</dt><dd>${pending.length}</dd>
            </dl>
            ${pending.length ? `<a class="btn btn-primary btn-block" href="#/evaluations?exam=${exam.id}">
              ${icon('play')}Run AI evaluation on ${pending.length} sheet${pending.length>1?'s':''}</a>` : ''}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>Source documents</h3></div></div>
          <div class="card-body stack" style="gap:9px">
            ${docRow('fileText', exam.paperFile, 'Question paper', 'brand')}
            ${docRow('check', exam.keyFile, 'Answer key', 'ok')}
          </div>
        </div>

        ${results && results.stats.evaluated ? `<div class="card">
          <div class="card-head"><div><h3>At a glance</h3></div></div>
          <div class="card-body"><dl class="kv">
            <dt>Class average</dt><dd>${results.stats.avg}%</dd>
            <dt>Highest</dt><dd>${results.stats.highest}%</dd>
            <dt>Lowest</dt><dd>${results.stats.lowest}%</dd>
            <dt>Median</dt><dd>${results.stats.median}%</dd>
            <dt>Passed (≥35%)</dt><dd>${results.stats.passed} of ${results.stats.evaluated}</dd>
          </dl></div></div>` : ''}
      </div>
    </div>`;

  function docRow(ic, file, label, tone){
    return file
      ? `<div class="file-row"><div class="file-ico t-${tone}">${icon(ic)}</div>
          <div class="meta"><b>${esc(file)}</b><span>${label} · uploaded ${ago(exam.createdAt)}</span></div>
          <button class="icon-btn" title="Preview">${icon('eye')}</button></div>`
      : `<div class="file-row" style="border-style:dashed">
          <div class="file-ico t-warn">${icon('alertTri')}</div>
          <div class="meta"><b>No ${label.toLowerCase()} uploaded</b><span>Required before evaluation can run</span></div>
          <a class="btn btn-sm" href="#/upload-paper">Add</a></div>`;
  }

  /* ── tabs ─────────────────────────────────────────────────────────── */
  const body = el.querySelector('#tabBody');
  const tabs = {
    questions(){
      body.innerHTML = `<div class="card-body">${exam.questions.map(q => `
        <div class="q-item">
          <div class="q-item-head">
            <div class="q-no">${q.no}</div>
            <div class="qt">${esc(q.text)}</div>
            <span class="chip">${esc(q.type)}</span>
            <span class="badge brand"><i></i>${q.maxMarks} marks</span>
          </div>
          <div class="q-item-body">
            <div>
              <div class="pane-head">${icon('check')}<h5>Examiner's model answer</h5></div>
              <div class="body" style="font-size:13.1px;line-height:1.65;color:var(--text-2)">${esc(q.modelAnswer)}</div>
            </div>
            <div>
              <div class="pane-head">${icon('target')}<h5>Key concepts the AI checks for</h5></div>
              <div class="concepts">${q.keyConcepts.map(c => `<span class="chip">${icon('check')}${esc(c)}</span>`).join('')}</div>
            </div>
          </div>
        </div>`).join('')}</div>`;
    },
    sheets(){
      if (!sheets.length){
        body.innerHTML = Empty({ iconName:'uploadCloud', title:'No answer sheets uploaded',
          body:'Upload scanned answer sheets to start AI evaluation.',
          action:`<a class="btn btn-primary" href="#/upload-sheets?exam=${exam.id}">${icon('uploadCloud')}Upload answer sheets</a>` });
        return;
      }
      body.replaceChildren(DataTable({
        rows: sheets,
        onRow: r => r.status === 'pending' ? go('/evaluations?exam=' + exam.id) : go('/evaluations/' + r.id),
        cols:[
          { key:'studentName', label:'Student', render:r => `<div class="cell-user">${Avatar(r.studentName)}
              <div><b>${esc(r.studentName)}</b><span>${esc(r.rollNo)}</span></div></div>` },
          { key:'fileName', label:'File', render:r => `<div><b style="font-weight:560;font-size:12.6px">${esc(r.fileName)}</b>
              <div class="cell-sub">${r.pages} pages · ${fmtBytes(r.fileSize)}</div></div>` },
          { key:'ocrConfidence', label:'OCR', align:'right', render:r => r.ocrConfidence
              ? `<span class="badge ${r.ocrConfidence>=90?'ok':r.ocrConfidence>=80?'warn':'bad'}"><i></i>${r.ocrConfidence}%</span>`
              : '<span style="color:var(--muted)">—</span>' },
          { key:'marksObtained', label:'Marks', align:'right', render:r => r.status === 'pending'
              ? '<span style="color:var(--muted)">—</span>'
              : `<b>${r.marksObtained}</b><span style="color:var(--muted);font-weight:500">/${r.totalMarks}</span>` },
          { key:'percentage', label:'%', align:'right', render:r => r.percentage === null
              ? '<span style="color:var(--muted)">—</span>'
              : `<span class="badge ${toneOf(r.percentage)}"><i></i>${r.percentage}%</span>`,
            sortValue:r => r.percentage ?? -1 },
          { key:'status', label:'Status', render:r => StatusBadge(r.status) },
        ],
      }));
    },
    analysis(){
      if (!results || !results.stats.evaluated){
        body.innerHTML = Empty({ iconName:'chart', title:'No evaluated sheets yet',
          body:'Question-level analysis appears once the AI has evaluated at least one answer sheet.' });
        return;
      }
      body.innerHTML = `<div class="card-body stack">
        <p style="font-size:12.8px;color:var(--muted)">Average marks awarded per question, as a percentage of the marks available. Low bars point to questions the cohort found hard — or to answer-key wording worth revisiting.</p>
        ${results.perQuestion.map(q => `
          <div>
            <div class="row" style="justify-content:space-between;margin-bottom:5px;gap:12px">
              <span style="font-size:12.5px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                <b style="color:var(--brand-600)">${esc(q.label)}</b> · ${esc(q.text)}</span>
              <span style="font-size:12.4px;font-weight:670;font-variant-numeric:tabular-nums;flex:0 0 auto">
                ${q.avgMarks} / ${q.maxMarks}</span>
            </div>
            <div class="bar ${q.value>=75?'ok':q.value>=50?'warn':'bad'}" style="height:8px"><i style="width:${q.value}%"></i></div>
          </div>`).join('')}
      </div>`;
    },
  };
  $$('#tabs button', el).forEach(b => b.onclick = () => {
    $$('#tabs button', el).forEach(x => x.classList.remove('on'));
    b.classList.add('on'); tabs[b.dataset.t]();
  });
  tabs.questions();

  el.querySelector('#exportBtn').onclick = () => {
    const rows = [['Roll No','Student','Class','Total Marks','Marks Obtained','Percentage','Status']];
    sheets.forEach(s => rows.push([s.rollNo, s.studentName, s.className, s.totalMarks,
      s.status === 'pending' ? '' : s.marksObtained, s.percentage ?? '', s.status]));
    downloadCSV(rows, `${exam.code}-results.csv`);
    toast('Results exported', `${sheets.length} rows written to CSV`, 'ok');
  };
  return el;
}

export function downloadCSV(rows, filename){
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type:'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
