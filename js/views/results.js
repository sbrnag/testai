import { icon } from '../icons.js';
import * as api from '../api.js';
import { $, $$, esc, Avatar, StatusBadge, DataTable, StatCard, BarChart, Ring, Empty,
         toast, toneOf, gradeOf, fmtDate, pct } from '../components.js';
import { go, path } from '../router.js';
import { setCrumbs } from '../app.js';
import { downloadCSV } from './exam-detail.js';

export async function render({ id } = {}){
  const here = path();
  const el = document.createElement('div');
  el.className = 'view';
  const exams = (await api.getExams()).filter(e => e.sheetCount);
  if (!exams.length){
    el.innerHTML = Empty({ iconName:'chart', title:'No results yet',
      body:'Results appear once answer sheets have been uploaded and evaluated.',
      action:`<a class="btn btn-primary" href="#/upload-sheets">${icon('uploadCloud')}Upload answer sheets</a>` });
    return el;
  }
  let examId = id || exams[0].id;

  el.innerHTML = `
    <div class="view-head">
      <div class="titles"><h1>Results</h1><p>Final marks, distribution and question-level analysis for each examination.</p></div>
      <div class="actions">
        <select class="select" id="examSel" aria-label="Choose examination">${exams.map(e =>
          `<option value="${e.id}" ${e.id===examId?'selected':''}>${esc(e.name)}</option>`).join('')}</select>
        <button class="btn" id="csvBtn">${icon('download')}Export CSV</button>
        <button class="btn btn-primary" id="pubBtn">${icon('external')}Publish results</button>
      </div>
    </div>
    <div id="body"></div>`;

  const body = el.querySelector('#body');

  async function draw(){
    body.innerHTML = '<div class="card"><div class="card-body"><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div></div>';
    const r = await api.getResults(examId);
    if (path() === here || path().startsWith('/results')){
      setCrumbs([{ label:'Results', href:'/results' }, { label:r.exam.name }]);
      document.title = `${r.exam.name} results · Test AI`;
    }

    const st = r.stats;
    const bands = [[90,100,'A+'],[80,89,'A'],[70,79,'B'],[60,69,'C'],[50,59,'D'],[35,49,'E'],[0,34,'F']];
    const gradeDist = bands.map(([lo,hi,g]) => ({ label:g,
      value: r.rows.filter(x => x.percentage !== null && x.percentage >= lo && x.percentage <= hi).length }));

    body.innerHTML = `
      <div class="grid g-4" style="margin-bottom:16px">
        ${StatCard({label:'Sheets evaluated', value:`${st.evaluated}/${st.appeared}`, iconName:'layers',
                    tone:'brand', foot: st.evaluated === st.appeared ? 'All sheets complete' : `${st.appeared-st.evaluated} pending`})}
        ${StatCard({label:'Class average', value:st.avg, unit:'%', iconName:'percent', tone:'info',
                    foot:`Grade ${gradeOf(st.avg)}`})}
        ${StatCard({label:'Highest score', value:st.highest, unit:'%', iconName:'award', tone:'ok',
                    foot:`Lowest ${st.lowest}%`})}
        ${StatCard({label:'Pass rate', value: st.evaluated ? Math.round(st.passed/st.evaluated*100) : 0, unit:'%',
                    iconName:'trend', tone: st.passed === st.evaluated ? 'ok' : 'warn',
                    foot:`${st.passed} of ${st.evaluated} at or above 35%`})}
      </div>

      <div class="grid g-2-1" style="margin-bottom:16px">
        <div class="card">
          <div class="card-head"><div><h3>Marks by question</h3>
            <p>Average marks awarded as a share of the marks available</p></div></div>
          <div class="card-body">
            ${BarChart({ data:r.perQuestion, height:190, unit:'%', max:100 })}
            <div class="stack" style="gap:9px;margin-top:16px">
              ${r.perQuestion.map(q => `<div class="row" style="gap:12px;align-items:flex-start">
                <span class="q-no" style="flex:0 0 auto">${q.label.replace('Q','')}</span>
                <div style="flex:1;min-width:0">
                  <div style="font-size:12.6px;line-height:1.5;color:var(--text-2)">${esc(q.text)}</div>
                  <div class="row" style="gap:8px;margin-top:5px">
                    <span class="chip">${q.avgMarks} / ${q.maxMarks} avg</span>
                    <span class="badge ${q.value>=75?'ok':q.value>=50?'warn':'bad'}"><i></i>${q.value}%</span>
                    ${q.value < 50 ? '<span class="chip miss">'+icon('alertTri')+'Cohort found this hard</span>' : ''}
                  </div>
                </div></div>`).join('')}
            </div>
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="card-head"><div><h3>Cohort average</h3></div></div>
            <div class="card-body" style="display:grid;place-items:center">
              ${Ring(st.avg, { size:140, stroke:12, label:'Average' })}
            </div>
          </div>
          <div class="card">
            <div class="card-head"><div><h3>Grade distribution</h3></div></div>
            <div class="card-body">${BarChart({ horizontal:true, data: gradeDist.map(g => ({
              label:`Grade ${g.label}`, value:g.value,
              tone: ['A+','A'].includes(g.label) ? 'ok' : ['F','E'].includes(g.label) ? 'bad' : 'warn' })) })}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h3>Result sheet</h3><p>${esc(r.exam.name)} · ${esc(r.exam.className)} · ${fmtDate(r.exam.date)} · ${r.exam.totalMarks} marks</p></div>
          <div class="actions"><span class="badge ${st.evaluated===st.appeared?'ok':'warn'}"><i></i>
            ${st.evaluated === st.appeared ? 'Complete' : `${st.appeared-st.evaluated} pending`}</span></div>
        </div>
        <div id="table"></div>
      </div>`;

    const ranked = [...r.rows].sort((a,b) => (b.percentage ?? -1) - (a.percentage ?? -1));
    body.querySelector('#table').replaceChildren(DataTable({
      rows: ranked,
      onRow: x => { if (x.percentage !== null) go('/evaluations/' + x.id); },
      cols:[
        { key:'rank', label:'#', sortable:false, width:'52px',
          render:x => { const i = ranked.indexOf(x); return x.percentage === null ? '—'
            : `<span style="font-weight:680;color:${i<3?'var(--brand-600)':'var(--muted)'};font-variant-numeric:tabular-nums">${i+1}</span>`; } },
        { key:'studentName', label:'Student', render:x => `<div class="cell-user">${Avatar(x.studentName)}
            <div><b>${esc(x.studentName)}</b><span>${esc(x.rollNo)}</span></div></div>` },
        { key:'totalMarks', label:'Total marks', align:'right' },
        { key:'marksObtained', label:'Marks obtained', align:'right', render:x => x.percentage === null
            ? '<span style="color:var(--muted)">—</span>' : `<b>${x.marksObtained}</b>` },
        { key:'percentage', label:'Percentage', align:'right', render:x => x.percentage === null
            ? '<span style="color:var(--muted)">—</span>'
            : `<b style="font-variant-numeric:tabular-nums">${x.percentage}%</b>`,
          sortValue:x => x.percentage ?? -1 },
        { key:'grade', label:'Grade', render:x => x.percentage === null ? '—'
            : `<span class="badge ${toneOf(x.percentage)}"><i></i>${gradeOf(x.percentage)}</span>`,
          sortValue:x => x.percentage ?? -1 },
        { key:'status', label:'Evaluation status', render:x => StatusBadge(x.status) },
        { key:'act', label:'', sortable:false, render:x => x.percentage === null ? ''
            : `<a class="btn btn-sm" href="#/evaluations/${x.id}">${icon('eye')}Detail</a>` },
      ],
    }));

    el.querySelector('#csvBtn').onclick = () => {
      downloadCSV([['Rank','Roll No','Student','Class','Exam','Total Marks','Marks Obtained','Percentage','Grade','Status'],
        ...ranked.map((x,i) => [x.percentage === null ? '' : i+1, x.rollNo, x.studentName, x.className,
          r.exam.name, x.totalMarks, x.percentage === null ? '' : x.marksObtained,
          x.percentage ?? '', x.percentage === null ? '' : gradeOf(x.percentage), x.status])],
        `${r.exam.code}-results.csv`);
      toast('Results exported', `${ranked.length} rows written to CSV`, 'ok');
    };
    el.querySelector('#pubBtn').onclick = () => import('../components.js').then(({ confirmModal }) => confirmModal({
      title:'Publish these results?',
      body: st.evaluated < st.appeared
        ? `${st.appeared - st.evaluated} sheet${st.appeared-st.evaluated>1?'s are':' is'} still unevaluated. Publishing now releases marks only for the ${st.evaluated} completed sheets.`
        : `All ${st.evaluated} results for <b>${esc(r.exam.name)}</b> will be released to students and marked final.`,
      confirmLabel:'Publish results',
      onConfirm: () => toast('Results published', `${esc(r.exam.name)} — visible to students`, 'ok'),
    }));
  }

  el.querySelector('#examSel').onchange = e => { examId = e.target.value; draw(); };
  await draw();
  return el;
}
