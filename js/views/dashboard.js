import { icon } from '../icons.js';
import * as api from '../api.js';
import { $, $$, esc, StatCard, StatusBadge, Avatar, Ring, LineChart, BarChart,
         fmtDate, ago, toneOf, gradeOf, Empty } from '../components.js';
import { go } from '../router.js';

export async function render(){
  const d = await api.getDashboard();
  const el = document.createElement('div');
  el.className = 'view';

  el.innerHTML = `
    <div class="view-head">
      <div class="titles">
        <h1>Good afternoon, Priya</h1>
        <p>${d.needsReview
            ? `${d.needsReview} evaluation${d.needsReview>1?'s':''} are waiting for your review.`
            : 'Everything is reviewed and up to date.'}</p>
      </div>
      <div class="actions">
        <a class="btn" href="#/upload-sheets">${icon('uploadCloud')}Upload answer sheets</a>
        <a class="btn btn-primary" href="#/upload-paper">${icon('plus')}New exam</a>
      </div>
    </div>

    <div class="grid g-4" style="margin-bottom:16px">
      ${StatCard({label:'Total exams', value:d.totalExams, iconName:'fileText', tone:'brand',
                  delta:'+2', deltaDir:'up', foot:`${d.activeExams} active`})}
      ${StatCard({label:'Students evaluated', value:d.studentsEvaluated, iconName:'userCheck', tone:'ok',
                  delta:'+8', deltaDir:'up', foot:`of ${d.totalStudents} enrolled`})}
      ${StatCard({label:'Answer sheets pending', value:d.sheetsPending, iconName:'inbox', tone:'warn',
                  foot: d.sheetsPending ? 'Awaiting AI processing' : 'Queue is clear'})}
      ${StatCard({label:'Average score', value:d.avgScore, unit:'%', iconName:'percent', tone:'info',
                  delta:'+3.4', deltaDir:'up', foot:'across evaluated sheets'})}
    </div>

    <div class="grid g-2-1" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head">
          <div><h3>Evaluation throughput</h3><p>Sheets evaluated per day, last 14 days</p></div>
          <div class="actions"><span class="badge brand"><i></i>Live pipeline</span></div>
        </div>
        <div class="card-body">${LineChart({ data:d.trend, height:210 })}</div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>Cohort average</h3><p>All evaluated sheets</p></div></div>
        <div class="card-body" style="display:flex;flex-direction:column;align-items:center;gap:16px">
          ${Ring(d.avgScore, { size:130, stroke:11, label:'Average' })}
          <div style="width:100%" class="stack">
            <div class="row" style="justify-content:space-between">
              <span style="font-size:12.6px;color:var(--muted)">Median grade</span>
              <span class="badge ${toneOf(d.avgScore)}"><i></i>${gradeOf(d.avgScore)}</span>
            </div>
            <div class="row" style="justify-content:space-between">
              <span style="font-size:12.6px;color:var(--muted)">Mean OCR confidence</span>
              <b style="font-size:13px;font-variant-numeric:tabular-nums">${d.avgConfidence}%</b>
            </div>
            <div class="row" style="justify-content:space-between">
              <span style="font-size:12.6px;color:var(--muted)">Approved by examiner</span>
              <b style="font-size:13px;font-variant-numeric:tabular-nums">${d.approved} / ${d.approved + d.needsReview}</b>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid g-1-2" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><div><h3>Score distribution</h3><p>Evaluated sheets by band</p></div></div>
        <div class="card-body">${BarChart({ data:d.dist, height:180 })}</div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h3>Recently evaluated</h3><p>Latest sheets through the pipeline</p></div>
          <div class="actions"><a class="btn btn-sm btn-ghost" href="#/evaluations">View all${icon('chevRight')}</a></div>
        </div>
        <div class="card-body tight">
          ${d.recent.length ? d.recent.map(r => `
            <a class="list-item" href="#/evaluations/${r.id}">
              ${Avatar(r.studentName)}
              <div class="meta">
                <b>${esc(r.studentName)}</b>
                <span>${esc(r.rollNo)} · ${esc(r.examName)}</span>
              </div>
              <div style="text-align:right;flex:0 0 auto">
                <b style="font-size:13.5px;font-variant-numeric:tabular-nums">${r.marksObtained}<span style="color:var(--muted);font-weight:500">/${r.totalMarks}</span></b>
                <div style="font-size:11.3px;color:var(--muted)">${ago(r.evaluatedAt)}</div>
              </div>
              <span class="badge ${toneOf(r.percentage)}" style="flex:0 0 auto"><i></i>${r.percentage}%</span>
              ${StatusBadge(r.status)}
            </a>`).join('') : Empty({ title:'No evaluations yet', body:'Upload answer sheets to get started.' })}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div><h3>Recently evaluated exams</h3><p>Progress across your active examinations</p></div>
        <div class="actions"><a class="btn btn-sm" href="#/exams">All exams${icon('chevRight')}</a></div>
      </div>
      <div class="card-body">
        <div class="grid g-4">
          ${d.recentExams.map(e => `
            <div class="card exam-card" data-exam="${e.id}">
              <div class="top">
                <div class="subject">${icon('book')}${esc(e.subject)}</div>
                <h3>${esc(e.name.split('—')[0].trim())}</h3>
                <div class="sub">${esc(e.className)} · ${fmtDate(e.date)}</div>
                <div style="margin-top:11px">${StatusBadge(e.status)}</div>
              </div>
              <div class="stats">
                <div><b>${e.done}/${e.total}</b><span>Evaluated</span></div>
                <div><b>${e.avg !== null ? e.avg + '%' : '—'}</b><span>Average</span></div>
                <div><b>${e.avg !== null ? gradeOf(e.avg) : '—'}</b><span>Grade</span></div>
              </div>
            </div>`).join('')}
        </div>
      </div>
    </div>`;

  $$('[data-exam]', el).forEach(c => c.onclick = () => go('/exams/' + c.dataset.exam));
  return el;
}
