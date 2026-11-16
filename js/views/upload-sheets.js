import { icon } from '../icons.js';
import * as api from '../api.js';
import * as evaluator from '../evaluator.js';
import { $, $$, esc, Dropzone, toast, fmtBytes, Avatar, StatusBadge, Empty,
         PageThumbs, hashRand } from '../components.js';
import { go } from '../router.js';
import { refreshCounts } from '../app.js';

export async function render(_params, query){
  const el = document.createElement('div');
  el.className = 'view';
  const exams = (await api.getExams()).filter(e => e.questions.length);

  let examId = query.exam || exams.find(e => e.status === 'active')?.id || exams[0]?.id;
  let staged = [];      // files chosen but not yet uploaded
  let autoRun = true;

  el.innerHTML = `
    <div class="view-head">
      <div class="titles"><h1>Upload answer sheets</h1>
        <p>Scanned answer sheets are matched to students by roll number in the filename, then queued for AI evaluation.</p></div>
      <div class="actions"><a class="btn" href="#/evaluations">${icon('cpu')}Go to evaluations</a></div>
    </div>
    <div class="grid g-2-1">
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h3>1 · Choose the examination</h3>
            <p>Sheets are graded against this exam's answer key</p></div></div>
          <div class="card-body">
            <select class="select" id="examSel">${exams.map(e =>
              `<option value="${e.id}" ${e.id===examId?'selected':''}>${esc(e.name)} — ${esc(e.className)} (${e.totalMarks} marks)</option>`).join('')}</select>
            <div id="examInfo" style="margin-top:13px"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>2 · Add scanned answer sheets</h3>
            <p>Multi-page PDFs or images, one file per student</p></div></div>
          <div class="card-body"><div id="dz"></div></div>
        </div>

        <div class="card" id="stagedCard" hidden>
          <div class="card-head">
            <div><h3>Ready to upload</h3><p id="stagedSub"></p></div>
            <div class="actions"><button class="btn btn-sm btn-ghost" id="clearBtn">Clear all</button></div>
          </div>
          <div class="card-body tight" id="stagedList"></div>
          <div class="card-foot">
            <label class="switch"><input type="checkbox" id="autoChk" checked><span class="track"></span>
              <span style="font-size:12.8px;font-weight:560">Start AI evaluation immediately after upload</span></label>
            <div style="flex:1"></div>
            <span id="stagedHint" style="font-size:12.3px;color:var(--warn-fg);font-weight:560"></span>
            <button class="btn btn-primary" id="uploadBtn">${icon('uploadCloud')}Upload sheets</button>
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h3>Already uploaded</h3></div></div>
          <div class="card-body tight" id="existing"></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Scanning guidance</h3></div></div>
          <div class="card-body">
            <ul style="display:grid;gap:10px">
              ${[['scan','Scan at 300 DPI or higher — faint pencil on low-resolution scans is the commonest cause of low OCR confidence.'],
                 ['fileText','Name each file with the student\'s roll number, e.g. <b>S-1203_PHY-12-UT2.pdf</b>, so it maps automatically.'],
                 ['layers','Keep every page of one student in a single file, in order. Page order drives question matching.'],
                 ['image','Avoid shadows and skew. The pipeline deskews automatically but heavy distortion still costs accuracy.']]
                .map(([ic,t]) => `<li style="display:flex;gap:10px;font-size:12.7px;line-height:1.6;color:var(--text-2)">
                  <span style="color:var(--brand-600);flex:0 0 auto;margin-top:1px">${icon(ic)}</span><span>${t}</span></li>`).join('')}
            </ul>
          </div>
        </div>
      </div>
    </div>`;

  /* ── exam context ─────────────────────────────────────────────────── */
  async function drawExam(){
    const exam = exams.find(e => e.id === examId);
    const sheets = await api.getSheets({ examId });
    el.querySelector('#examInfo').innerHTML = exam ? `
      <div class="row wrap" style="gap:8px">
        <span class="chip">${icon('book')}${esc(exam.subject)}</span>
        <span class="chip">${icon('users')}${esc(exam.className)}</span>
        <span class="chip">${icon('fileText')}${exam.questions.length} questions</span>
        <span class="chip">${icon('award')}${exam.totalMarks} marks</span>
        ${exam.keyFile ? `<span class="chip ok">${icon('check')}Answer key attached</span>`
          : `<span class="chip miss">${icon('alertTri')}No answer key file</span>`}
      </div>` : '';

    const host = el.querySelector('#existing');
    if (!sheets.length){
      host.innerHTML = Empty({ iconName:'inbox', title:'No sheets yet',
        body:'Uploaded sheets for this exam will appear here.' });
      return;
    }
    host.innerHTML = sheets.slice(0,8).map(s => `
      <div class="list-item">
        ${Avatar(s.studentName)}
        <div class="meta"><b>${esc(s.studentName)}</b><span>${esc(s.rollNo)} · ${s.pages} pages</span></div>
        ${StatusBadge(s.status)}
      </div>`).join('') + (sheets.length > 8
        ? `<div class="list-item" style="justify-content:center;color:var(--muted);font-size:12.4px">
            +${sheets.length - 8} more</div>` : '');
  }

  /* ── staging ──────────────────────────────────────────────────────── */
  async function drawStaged(){
    const card = el.querySelector('#stagedCard');
    card.hidden = !staged.length;
    if (!staged.length) return;
    const exam = exams.find(e => e.id === examId);
    const students = (await api.getStudents()).filter(s => s.className === exam.className);
    const existing = await api.getSheets({ examId });
    const taken = new Map(existing.map(s => [s.studentId, s]));

    /* Auto-match on roll number only. A file that does not name a student is
       left for the examiner to assign — never guessed. */
    staged.forEach(f => {
      if (f.studentId !== undefined) return;                  // already chosen
      const byRoll = students.find(s => f.name.toUpperCase().includes(s.rollNo.toUpperCase()));
      f.studentId = byRoll ? byRoll.id : null;
      f.autoMatched = !!byRoll;
    });

    const counts = staged.reduce((m,f) => f.studentId
      ? m.set(f.studentId, (m.get(f.studentId) || 0) + 1) : m, new Map());
    const unassigned = staged.filter(f => !f.studentId).length;
    const clashing   = staged.filter(f => f.studentId && counts.get(f.studentId) > 1).length;

    el.querySelector('#stagedSub').textContent =
      `${staged.length} file${staged.length===1?'':'s'} · ${fmtBytes(staged.reduce((s,f)=>s+f.size,0))} · ${exam.className}`;

    el.querySelector('#stagedList').innerHTML = staged.map((f,i) => {
      const clash    = f.studentId && counts.get(f.studentId) > 1;
      const replaces = f.studentId && taken.has(f.studentId);
      const tone = !f.studentId || clash ? 'warn' : 'brand';
      return `<div class="list-item staged-row ${!f.studentId || clash ? 'needs-attention' : ''}">
        <div class="file-ico t-${tone}">${icon(f.name.match(/\.(jpg|jpeg|png)$/i) ? 'image' : 'file')}</div>
        <div class="meta">
          <b>${esc(f.name)}</b>
          <span>${fmtBytes(f.size)} · ${f.pages} pages${
            f.autoMatched ? ' · matched by roll number' : ''}</span>
        </div>
        <div class="assign">
          <label class="assign-label" for="stu-${i}">Student</label>
          <select class="select" id="stu-${i}" data-stu="${i}">
            <option value="" ${!f.studentId ? 'selected' : ''}>— Select student —</option>
            ${students.map(s => `<option value="${s.id}" ${s.id === f.studentId ? 'selected' : ''}>
              ${esc(s.rollNo)} · ${esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="row" style="gap:8px;flex:0 0 auto">
          ${!f.studentId ? '<span class="badge warn"><i></i>Needs a student</span>'
            : clash ? '<span class="badge bad"><i></i>Duplicate</span>'
            : replaces ? '<span class="badge warn"><i></i>Replaces existing</span>'
            : '<span class="badge ok"><i></i>Ready</span>'}
          <button class="icon-btn" data-rm="${i}" title="Remove">${icon('x')}</button>
        </div>
      </div>`;
    }).join('');

    $$('[data-rm]', el).forEach(b => b.onclick = () => { staged.splice(+b.dataset.rm, 1); drawStaged(); });
    $$('[data-stu]', el).forEach(sel => sel.onchange = () => {
      const f = staged[+sel.dataset.stu];
      f.studentId = sel.value || null;
      f.autoMatched = false;
      drawStaged();
    });

    /* Nothing uploads until every file names exactly one distinct student. */
    const btn  = el.querySelector('#uploadBtn');
    const hint = el.querySelector('#stagedHint');
    const blocked = unassigned || clashing;
    btn.disabled = !!blocked;
    hint.textContent = unassigned
      ? `${unassigned} file${unassigned>1?'s need':' needs'} a student`
      : clashing
        ? `${clashing} files are assigned to the same student`
        : '';
  }

  el.querySelector('#dz').replaceChildren(Dropzone({
    accept:'.pdf,.jpg,.jpeg,.png',
    title:'Drop scanned answer sheets here',
    body:'PDF or image files · one file per student · up to 40 files at a time',
    formats:['PDF','JPG','PNG','Multi-page'],
    onFiles: files => {
      staged.push(...files.map(f => ({
        name:f.name, size:f.size,
        pages: 4 + Math.floor(hashRand(f.name, 5) * 5),
        studentId: undefined,        // resolved in drawStaged, editable by the examiner
      })));
      drawStaged();
      toast(`${files.length} file${files.length===1?'':'s'} added`, 'Review the student matches, then upload', 'ok');
    },
  }));

  el.querySelector('#examSel').onchange = e => { examId = e.target.value; drawExam(); drawStaged(); };
  el.querySelector('#clearBtn').onclick = () => { staged = []; drawStaged(); };
  el.querySelector('#autoChk').onchange = e => { autoRun = e.target.checked; };

  el.querySelector('#uploadBtn').onclick = async () => {
    const btn = el.querySelector('#uploadBtn');
    btn.innerHTML = '<span class="spinner"></span>Uploading…'; btn.disabled = true;
    const created = await api.createSheets(examId, staged);
    staged = [];
    await Promise.all([drawStaged(), drawExam()]);
    await refreshCounts();
    btn.innerHTML = `${icon('uploadCloud')}Upload sheets`; btn.disabled = false;
    toast(`${created.length} answer sheet${created.length===1?'':'s'} uploaded`,
      autoRun ? 'AI evaluation starting now' : 'Queued — start evaluation when ready', 'ok');
    if (autoRun){
      evaluator.runBatch(created.map(s => s.id));
      go('/evaluations?exam=' + examId);
    }
  };

  await drawExam();
  return el;
}
