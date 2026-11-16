import { icon } from '../icons.js';
import * as api from '../api.js';
import { $, $$, esc, Avatar, DataTable, StatCard, Empty, toneOf, gradeOf, Bar } from '../components.js';
import { go } from '../router.js';

export async function render(){
  const el = document.createElement('div');
  el.className = 'view';
  const students = await api.getStudents();

  const evaluated = students.filter(s => s.avgPercent !== null);
  const avg = evaluated.length
    ? Math.round(evaluated.reduce((a,s) => a + s.avgPercent, 0) / evaluated.length * 10) / 10 : 0;

  el.innerHTML = `
    <div class="view-head">
      <div class="titles"><h1>Students</h1><p>Everyone enrolled, with their evaluation history across exams.</p></div>
      <div class="actions">
        <button class="btn" id="exportBtn">${icon('download')}Export roster</button>
        <button class="btn btn-primary" id="addBtn">${icon('plus')}Add student</button>
      </div>
    </div>
    <div class="grid g-4" style="margin-bottom:16px">
      ${StatCard({label:'Students enrolled', value:students.length, iconName:'users', tone:'brand',
                  foot:`${[...new Set(students.map(s=>s.className))].length} classes`})}
      ${StatCard({label:'With evaluated sheets', value:evaluated.length, iconName:'userCheck', tone:'ok',
                  foot:`${students.length - evaluated.length} not yet evaluated`})}
      ${StatCard({label:'Cohort average', value:avg, unit:'%', iconName:'percent', tone:'info',
                  foot:`Grade ${gradeOf(avg)} overall`})}
      ${StatCard({label:'Below pass mark', value:evaluated.filter(s=>s.avgPercent<35).length,
                  iconName:'alertTri', tone:'warn', foot:'Average under 35%'})}
    </div>
    <div class="card">
      <div class="filters">
        <div class="search-inline">${icon('search')}<input class="input" id="q" placeholder="Search name, roll number or email…"></div>
        <select class="select" id="fClass"><option value="">All classes</option>${
          [...new Set(students.map(s => s.className))].sort().map(c => `<option>${esc(c)}</option>`).join('')}</select>
        <select class="select" id="fBand">
          <option value="">All performance</option><option value="top">Distinction (≥75%)</option>
          <option value="mid">Pass (35–74%)</option><option value="low">Below pass (&lt;35%)</option>
          <option value="none">Not yet evaluated</option>
        </select>
        <div style="flex:1"></div>
        <span style="font-size:12.4px;color:var(--muted)" id="countLbl"></span>
      </div>
      <div id="list"></div>
    </div>`;

  function draw(){
    const q = el.querySelector('#q').value.trim().toLowerCase();
    const cls = el.querySelector('#fClass').value;
    const band = el.querySelector('#fBand').value;
    const rows = students.filter(s => {
      if (q && !(s.name + s.rollNo + s.email).toLowerCase().includes(q)) return false;
      if (cls && s.className !== cls) return false;
      if (band === 'none') return s.avgPercent === null;
      if (band === 'top')  return s.avgPercent !== null && s.avgPercent >= 75;
      if (band === 'mid')  return s.avgPercent !== null && s.avgPercent >= 35 && s.avgPercent < 75;
      if (band === 'low')  return s.avgPercent !== null && s.avgPercent < 35;
      return true;
    });
    el.querySelector('#countLbl').textContent = `${rows.length} of ${students.length} students`;

    if (!rows.length){
      el.querySelector('#list').innerHTML = Empty({ iconName:'users', title:'No students match those filters',
        body:'Try a different class or clear the search.' });
      return;
    }
    el.querySelector('#list').replaceChildren(DataTable({
      rows, onRow: r => go('/students/' + r.id),
      cols:[
        { key:'name', label:'Student', render:r => `<div class="cell-user">${Avatar(r.name)}
            <div><b>${esc(r.name)}</b><span>${esc(r.email)}</span></div></div>` },
        { key:'rollNo', label:'Roll no.' },
        { key:'className', label:'Class', render:r => `<span class="chip">${esc(r.className)}</span>` },
        { key:'examCount', label:'Sheets', align:'right' },
        { key:'evaluatedCount', label:'Evaluated', align:'right' },
        { key:'avgPercent', label:'Average', render:r => r.avgPercent === null
            ? '<span style="color:var(--muted)">Not evaluated</span>'
            : `<div style="min-width:120px">${Bar(r.avgPercent, 100)}</div>`,
          sortValue:r => r.avgPercent ?? -1 },
        { key:'grade', label:'Grade', align:'right', render:r => r.avgPercent === null ? '—'
            : `<span class="badge ${toneOf(r.avgPercent)}"><i></i>${gradeOf(r.avgPercent)}</span>`,
          sortValue:r => r.avgPercent ?? -1 },
      ],
    }));
  }

  el.querySelector('#q').oninput = draw;
  el.querySelector('#fClass').onchange = draw;
  el.querySelector('#fBand').onchange = draw;
  el.querySelector('#addBtn').onclick = () => import('../components.js').then(({ Modal, toast }) => Modal({
    title:'Add student', subtitle:'Students are normally synced from your student information system',
    body:`<div class="stack" style="gap:14px">
      <div class="field"><label>Full name</label><input class="input" placeholder="e.g. Aarav Mehta"></div>
      <div class="grid g-2" style="gap:14px">
        <div class="field"><label>Roll number</label><input class="input" placeholder="S-1211"></div>
        <div class="field"><label>Class</label><select class="select">${
          [...new Set(students.map(s => s.className))].sort().map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
      </div>
      <div class="comment-note">${icon('info')}<span>In this prototype the roster is seeded. Connecting a real SIS would populate it automatically and keep it in sync.</span></div>
    </div>`,
    footer:`<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-close>Add student</button>`,
  }));
  el.querySelector('#exportBtn').onclick = async () => {
    const { downloadCSV } = await import('./exam-detail.js');
    const { toast } = await import('../components.js');
    downloadCSV([['Roll No','Name','Class','Email','Sheets','Evaluated','Average %'],
      ...students.map(s => [s.rollNo, s.name, s.className, s.email, s.examCount, s.evaluatedCount, s.avgPercent ?? ''])],
      'students-roster.csv');
    toast('Roster exported', `${students.length} students written to CSV`, 'ok');
  };
  draw();
  return el;
}
