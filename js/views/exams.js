import { icon } from '../icons.js';
import * as api from '../api.js';
import { $, $$, esc, StatusBadge, StatCard, fmtDate, gradeOf, Empty, Bar,
         confirmModal, toast, DataTable, Skeleton } from '../components.js';
import { go } from '../router.js';
import { refreshCounts } from '../app.js';

export async function render(){
  const el = document.createElement('div');
  el.className = 'view';
  el.innerHTML = `<div class="view-head">
      <div class="titles"><h1>Exams</h1><p>Every examination you have created and its evaluation progress.</p></div>
      <div class="actions">
        <div class="seg" id="viewToggle">
          <button data-v="grid" class="on">Cards</button><button data-v="table">Table</button>
        </div>
        <a class="btn btn-primary" href="#/upload-paper">${icon('plus')}Create exam</a>
      </div>
    </div>
    <div class="grid g-4" id="stats" style="margin-bottom:16px"></div>
    <div class="card"><div class="filters">
        <div class="search-inline">${icon('search')}<input class="input" id="q" placeholder="Search by name, code or subject…"></div>
        <select class="select" id="fSubject"><option value="">All subjects</option></select>
        <select class="select" id="fStatus">
          <option value="">All statuses</option><option value="draft">Draft</option>
          <option value="active">Active</option><option value="completed">Completed</option>
        </select>
        <div class="spacer" style="flex:1"></div>
        <span style="font-size:12.4px;color:var(--muted)" id="countLbl"></span>
      </div><div id="list">${Skeleton(4)}</div></div>`;

  let exams = await api.getExams();
  let mode = 'grid';

  const stats = el.querySelector('#stats');
  const totalSheets = exams.reduce((s,e) => s + e.sheetCount, 0);
  const avgAll = exams.filter(e => e.avgPercent !== null);
  stats.innerHTML =
    StatCard({label:'Exams created', value:exams.length, iconName:'fileText', tone:'brand',
              foot:`${exams.filter(e=>e.status==='active').length} currently active`}) +
    StatCard({label:'Answer sheets', value:totalSheets, iconName:'layers', tone:'info',
              foot:`${exams.reduce((s,e)=>s+e.approvedCount,0)} approved`}) +
    StatCard({label:'Awaiting review', value:exams.reduce((s,e)=>s+e.reviewCount,0), iconName:'alertTri',
              tone:'warn', foot:'AI evaluated, unapproved'}) +
    StatCard({label:'Average across exams', value: avgAll.length
              ? Math.round(avgAll.reduce((s,e)=>s+e.avgPercent,0)/avgAll.length*10)/10 : 0,
              unit:'%', iconName:'percent', tone:'ok', foot:'weighted by exam'});

  const subjSel = el.querySelector('#fSubject');
  [...new Set(exams.map(e => e.subject))].forEach(s =>
    subjSel.insertAdjacentHTML('beforeend', `<option>${esc(s)}</option>`));

  const filtered = () => {
    const q = el.querySelector('#q').value.trim().toLowerCase();
    const su = subjSel.value, st = el.querySelector('#fStatus').value;
    return exams.filter(e =>
      (!q || (e.name + e.code + e.subject + e.className).toLowerCase().includes(q)) &&
      (!su || e.subject === su) && (!st || e.status === st));
  };

  function card(e){
    const done = e.sheetCount - e.pendingCount;
    return `<div class="card exam-card" data-id="${e.id}">
      <div class="top">
        <div class="row" style="align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div class="subject">${icon('book')}${esc(e.subject)}</div>
            <h3>${esc(e.name)}</h3>
            <div class="sub">${esc(e.code)} · ${esc(e.className)} · ${fmtDate(e.date)}</div>
          </div>
          ${StatusBadge(e.status)}
        </div>
        <div style="margin-top:13px">
          <div class="row" style="justify-content:space-between;margin-bottom:5px">
            <span style="font-size:11.8px;color:var(--muted);font-weight:560">Evaluation progress</span>
            <span style="font-size:11.8px;font-weight:640;font-variant-numeric:tabular-nums">${done}/${e.sheetCount || 0}</span>
          </div>
          ${Bar(done, e.sheetCount || 1, e.pendingCount ? 'warn' : 'ok').replace('<span class="pct">'+
            Math.round(e.sheetCount?done/e.sheetCount*100:0)+'%</span>','')}
        </div>
      </div>
      <div class="stats">
        <div><b>${e.questions.length}</b><span>Questions</span></div>
        <div><b>${e.totalMarks}</b><span>Total marks</span></div>
        <div><b>${e.avgPercent !== null ? e.avgPercent + '%' : '—'}</b><span>Average</span></div>
        <div><b>${e.avgPercent !== null ? gradeOf(e.avgPercent) : '—'}</b><span>Grade</span></div>
      </div>
    </div>`;
  }

  function draw(){
    const rows = filtered();
    el.querySelector('#countLbl').textContent = `${rows.length} of ${exams.length} exams`;
    const host = el.querySelector('#list');
    if (!rows.length){
      host.innerHTML = Empty({ iconName:'fileText', title:'No exams match those filters',
        body:'Try clearing the search or choosing a different subject.' });
      return;
    }
    if (mode === 'grid'){
      host.innerHTML = `<div class="card-body"><div class="grid g-3">${rows.map(card).join('')}</div></div>`;
      $$('[data-id]', host).forEach(c => c.onclick = () => go('/exams/' + c.dataset.id));
    } else {
      host.replaceChildren(DataTable({
        rows,
        onRow: r => go('/exams/' + r.id),
        cols:[
          { key:'name', label:'Exam', render:r => `<div><b style="font-weight:620">${esc(r.name)}</b>
              <div class="cell-sub">${esc(r.code)} · ${esc(r.className)}</div></div>` },
          { key:'subject', label:'Subject', render:r => `<span class="chip">${esc(r.subject)}</span>` },
          { key:'date', label:'Date', render:r => fmtDate(r.date), sortValue:r => new Date(r.date).getTime() },
          { key:'questions', label:'Qs', align:'right', render:r => r.questions.length, sortValue:r => r.questions.length },
          { key:'totalMarks', label:'Marks', align:'right' },
          { key:'sheetCount', label:'Sheets', align:'right', render:r => `${r.sheetCount - r.pendingCount}/${r.sheetCount}` },
          { key:'avgPercent', label:'Average', align:'right', render:r => r.avgPercent !== null
              ? `<span style="font-weight:640">${r.avgPercent}%</span>` : '<span style="color:var(--muted)">—</span>',
            sortValue:r => r.avgPercent ?? -1 },
          { key:'status', label:'Status', render:r => StatusBadge(r.status) },
          { key:'act', label:'', sortable:false, render:r =>
              `<button class="btn btn-sm btn-ghost" data-del="${r.id}" title="Delete exam">${icon('trash')}</button>` },
        ],
      }));
      $$('[data-del]', host).forEach(b => b.onclick = e => {
        e.stopPropagation();
        const ex = exams.find(x => x.id === b.dataset.del);
        confirmModal({
          title:'Delete this exam?', danger:true, confirmLabel:'Delete exam',
          body:`<b>${esc(ex.name)}</b> and its ${ex.sheetCount} answer sheet${ex.sheetCount===1?'':'s'} will be removed. This cannot be undone.`,
          onConfirm: async () => {
            await api.deleteExam(ex.id);
            exams = exams.filter(x => x.id !== ex.id);
            draw(); refreshCounts();
            toast('Exam deleted', ex.name, 'ok');
          },
        });
      });
    }
  }

  el.querySelector('#q').oninput = draw;
  subjSel.onchange = draw;
  el.querySelector('#fStatus').onchange = draw;
  $$('#viewToggle button', el).forEach(b => b.onclick = () => {
    $$('#viewToggle button', el).forEach(x => x.classList.remove('on'));
    b.classList.add('on'); mode = b.dataset.v; draw();
  });
  draw();
  return el;
}
