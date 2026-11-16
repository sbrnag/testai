import { icon } from '../icons.js';
import * as api from '../api.js';
import { $, $$, esc, Avatar, StatusBadge, DataTable, Ring, Empty, BarChart,
         fmtDate, toneOf, gradeOf, pct } from '../components.js';
import { go, path } from '../router.js';
import { setCrumbs } from '../app.js';

export async function render({ id }){
  const here = path();
  const el = document.createElement('div');
  el.className = 'view';
  const s = await api.getStudent(id);
  if (!s){ el.innerHTML = Empty({ title:'Student not found' }); return el; }

  if (path() === here){
    setCrumbs([{ label:'Students', href:'/students' }, { label:s.name }]);
    document.title = `${s.name} · Test AI`;
  }

  const done = s.sheets.filter(x => x.percentage !== null);
  const avg = done.length ? Math.round(done.reduce((a,x) => a + x.percentage, 0) / done.length * 10) / 10 : 0;
  const best = done.length ? Math.max(...done.map(x => x.percentage)) : 0;

  el.innerHTML = `
    <div class="view-head">
      <div class="titles">
        <a class="btn btn-sm btn-ghost" href="#/students" style="margin-bottom:8px;margin-left:-10px">${icon('arrowLeft')}All students</a>
        <div class="row" style="gap:13px">${Avatar(s.name)}
          <div><h1>${esc(s.name)}</h1><p>${esc(s.rollNo)} · ${esc(s.className)} · ${esc(s.email)}</p></div></div>
      </div>
    </div>
    <div class="grid g-1-2">
      <div class="stack">
        <div class="card"><div class="card-body" style="display:flex;flex-direction:column;align-items:center;gap:15px">
          ${done.length ? Ring(avg, { size:132, stroke:11, label:'Average' })
            : `<div class="empty" style="padding:22px"><div class="ei">${icon('inbox')}</div>
               <h4>Not yet evaluated</h4><p>No evaluated answer sheets for this student.</p></div>`}
          ${done.length ? `<div style="width:100%" class="stack">
            <div class="row" style="justify-content:space-between">
              <span style="font-size:12.6px;color:var(--muted)">Overall grade</span>
              <span class="badge ${toneOf(avg)}"><i></i>${gradeOf(avg)}</span></div>
            <div class="row" style="justify-content:space-between">
              <span style="font-size:12.6px;color:var(--muted)">Best result</span>
              <b style="font-size:13px">${best}%</b></div>
            <div class="row" style="justify-content:space-between">
              <span style="font-size:12.6px;color:var(--muted)">Sheets evaluated</span>
              <b style="font-size:13px">${done.length} of ${s.sheets.length}</b></div>
          </div>` : ''}
        </div></div>
        ${done.length ? `<div class="card">
          <div class="card-head"><div><h3>Performance by exam</h3></div></div>
          <div class="card-body">${BarChart({ horizontal:true, unit:'%', max:100,
            data: done.map(x => ({ label:x.subject, value:x.percentage })) })}</div>
        </div>` : ''}
      </div>

      <div class="card">
        <div class="card-head"><div><h3>Answer sheets</h3><p>Every sheet submitted by this student</p></div></div>
        <div id="sheets"></div>
      </div>
    </div>`;

  if (!s.sheets.length){
    el.querySelector('#sheets').innerHTML = Empty({ iconName:'inbox', title:'No answer sheets',
      body:'This student has no uploaded answer sheets yet.' });
  } else {
    el.querySelector('#sheets').replaceChildren(DataTable({
      rows: s.sheets,
      onRow: r => { if (r.percentage !== null) go('/evaluations/' + r.id); },
      cols:[
        { key:'examName', label:'Exam', render:r => `<div><b style="font-weight:600">${esc(r.examName)}</b>
            <div class="cell-sub">${esc(r.examCode)} · ${fmtDate(r.uploadedAt)}</div></div>` },
        { key:'marksObtained', label:'Marks', align:'right', render:r => r.percentage === null
            ? '<span style="color:var(--muted)">—</span>'
            : `<b>${r.marksObtained}</b><span style="color:var(--muted);font-weight:500">/${r.totalMarks}</span>` },
        { key:'percentage', label:'Result', align:'right', render:r => r.percentage === null
            ? '<span style="color:var(--muted)">—</span>'
            : `<span class="badge ${toneOf(r.percentage)}"><i></i>${r.percentage}% · ${gradeOf(r.percentage)}</span>`,
          sortValue:r => r.percentage ?? -1 },
        { key:'status', label:'Status', render:r => StatusBadge(r.status) },
      ],
    }));
  }
  return el;
}
