import { icon } from '../icons.js';
import * as api from '../api.js';
import * as evaluator from '../evaluator.js';
import { $, $$, esc, Dropzone, toast, fmtBytes, fmtDate, Avatar, StatusBadge, Empty,
         Modal, PageThumbs, hashRand, DataTable } from '../components.js';
import { go } from '../router.js';
import { refreshCounts } from '../app.js';
import { listZip, readEntry, isSheet, mimeOf, countPages } from '../zip.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const STEPS = [
  ['reading',   'Reading archive'],
  ['listing',   'Listing entries'],
  ['matching',  'Matching students'],
  ['ready',     'Ready to review'],
];

export async function render(_params, query){
  const el = document.createElement('div');
  el.className = 'view';
  const exams = (await api.getExams()).filter(e => e.questions.length);
  let examId = query.exam || exams.find(e => e.status === 'active')?.id || exams[0]?.id;

  let archive = null;   // { name, size, buffer|null, rows[] }
  let autoRun = true;
  let stage = null;

  el.innerHTML = `
    <div class="view-head">
      <div class="titles"><h1>Bulk upload</h1>
        <p>Upload one ZIP archive containing many students' answer sheets. Every file inside is
           listed with the student it belongs to, so you can verify each one before importing.</p></div>
      <div class="actions"><a class="btn" href="#/upload-sheets">${icon('uploadCloud')}Upload one at a time</a></div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><div><h3>1 · Choose the examination</h3>
        <p>Every sheet in the archive is graded against this exam's answer key</p></div></div>
      <div class="card-body">
        <select class="select" id="examSel">${exams.map(e =>
          `<option value="${e.id}" ${e.id===examId?'selected':''}>${esc(e.name)} — ${esc(e.className)} (${e.totalMarks} marks)</option>`).join('')}</select>
        <div id="examInfo" style="margin-top:13px"></div>
      </div>
    </div>

    <div class="card" id="dropCard">
      <div class="card-head"><div><h3>2 · Upload the archive</h3>
        <p>A .zip of scanned sheets — folders inside are read too</p></div>
        <div class="actions"><button class="btn btn-sm" id="sampleBtn">${icon('sparkles')}Use a sample archive</button></div></div>
      <div class="card-body"><div id="dz"></div></div>
    </div>

    <div id="work"></div>`;

  /* ── exam context ─────────────────────────────────────────────────── */
  async function drawExam(){
    const exam = exams.find(e => e.id === examId);
    el.querySelector('#examInfo').innerHTML = exam ? `<div class="row wrap" style="gap:8px">
      <span class="chip">${icon('book')}${esc(exam.subject)}</span>
      <span class="chip">${icon('users')}${esc(exam.className)}</span>
      <span class="chip">${icon('fileText')}${exam.questions.length} questions</span>
      <span class="chip">${icon('award')}${exam.totalMarks} marks</span>
      ${exam.keyFile ? `<span class="chip ok">${icon('check')}Answer key attached</span>`
        : `<span class="chip miss">${icon('alertTri')}No answer key file</span>`}
    </div>` : '';
  }

  /* ── extraction pipeline ──────────────────────────────────────────── */
  function drawStages(active, note){
    const i = STEPS.findIndex(s => s[0] === active);
    el.querySelector('#work').innerHTML = `<div class="card">
      <div class="card-head"><div><h3 class="row" style="gap:8px">${icon('layers')}Extracting archive</h3>
        <p>${esc(note || archive?.name || '')}</p></div>
        <div class="actions"><span class="badge brand pulse"><i></i>Working</span></div></div>
      <div class="card-body"><div class="pipeline">${STEPS.map(([k,label], j) => `
        <div class="pipe-stage ${j < i ? 'done' : j === i ? 'active' : ''}">
          <div class="pd">${j < i ? icon('check') : j === i
            ? '<span class="spinner" style="width:11px;height:11px;border-width:1.6px;border-color:rgba(255,255,255,.35);border-top-color:#fff"></span>' : ''}</div>
          <div class="pt">${esc(label)}</div>
        </div>`).join('')}</div></div></div>`;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /** Build review rows from archive entries, matching each to a student. */
  async function buildRows(entries, buffer){
    const exam = exams.find(e => e.id === examId);
    const students = (await api.getStudents()).filter(s => s.className === exam.className);
    return entries.map(entry => {
      const base = entry.name.split('/').pop();
      const byRoll = students.find(s => base.toUpperCase().includes(s.rollNo.toUpperCase()));
      return {
        entry, buffer, name: base, path: entry.name,
        size: entry.size, date: entry.date,
        pages: entry.pages ?? null,
        studentId: byRoll ? byRoll.id : null,
        autoMatched: !!byRoll,
      };
    });
  }

  async function ingest(file){
    stage = 'reading';
    drawStages('reading', file.name);
    await sleep(500);

    let entries, buffer;
    try {
      const res = await listZip(file);
      buffer = res.buffer;
      entries = res.entries.filter(isSheet);
    } catch (err){
      el.querySelector('#work').innerHTML = `<div class="card"><div class="empty">
        <div class="ei" style="background:var(--bad-bg);color:var(--bad-fg)">${icon('alertTri')}</div>
        <h4>Could not read that archive</h4><p>${esc(err.message)}</p>
        <button class="btn" id="retryBtn">${icon('refresh')}Try another file</button></div></div>`;
      $('#retryBtn', el).onclick = () => { archive = null; el.querySelector('#work').innerHTML = ''; };
      return;
    }

    drawStages('listing', `${entries.length} answer sheet${entries.length===1?'':'s'} found`);
    await sleep(650);

    if (!entries.length){
      el.querySelector('#work').innerHTML = `<div class="card">${Empty({
        iconName:'inbox', title:'No answer sheets in that archive',
        body:'The ZIP contained no PDF or image files. Check that sheets were added directly rather than as a nested archive.' })}</div>`;
      return;
    }

    /* Page counts need the actual bytes, so only inflate PDFs, and only once. */
    for (const e of entries){
      if (/\.pdf$/i.test(e.name)){
        try {
          const blob = await readEntry(buffer, e, 'application/pdf');
          e.pages = countPages(new Uint8Array(await blob.arrayBuffer()), e.name);
        } catch { e.pages = null; }
      } else e.pages = 1;
    }

    drawStages('matching', 'Reading roll numbers from filenames');
    await sleep(700);

    archive = { name:file.name, size:file.size, buffer, rows: await buildRows(entries, buffer) };
    drawReview();
  }

  /** A synthetic archive so the flow is demonstrable without a real ZIP. */
  async function sampleArchive(){
    const exam = exams.find(e => e.id === examId);
    const students = (await api.getStudents()).filter(s => s.className === exam.className);
    const existing = new Set((await api.getSheets({ examId })).map(s => s.studentId));
    const pool = students.filter(s => !existing.has(s.id));
    const picks = (pool.length ? pool : students).slice(0, 6);

    stage = 'reading';
    drawStages('reading', `${exam.className}-${exam.code}-scans.zip`);
    await sleep(600);
    drawStages('listing', `${picks.length + 1} answer sheets found`);
    await sleep(700);
    drawStages('matching', 'Reading roll numbers from filenames');
    await sleep(700);

    const rows = picks.map((s,i) => ({
      entry:null, buffer:null,
      name:`${s.rollNo}_${exam.code}_answersheet.pdf`,
      path:`${exam.className.replace(/\s+/g,'-')}/${s.rollNo}_${exam.code}_answersheet.pdf`,
      size: Math.round((1.4 + hashRand(s.id, 4) * 3.2) * 1048576),
      date: new Date(), pages: 4 + Math.floor(hashRand(s.id, 3) * 5),
      studentId: s.id, autoMatched: true,
    }));
    /* One unnamed scan, because real archives always contain one. */
    rows.push({ entry:null, buffer:null, name:'scan_0047.pdf',
      path:`${exam.className.replace(/\s+/g,'-')}/scan_0047.pdf`,
      size: 2_310_144, date:new Date(), pages:6, studentId:null, autoMatched:false });

    archive = { name:`${exam.className.replace(/\s+/g,'-')}-${exam.code}-scans.zip`,
                size: rows.reduce((a,r) => a + r.size, 0), buffer:null, rows, sample:true };
    drawReview();
  }

  /* ── review table ─────────────────────────────────────────────────── */
  async function drawReview(){
    const exam = exams.find(e => e.id === examId);
    const students = (await api.getStudents()).filter(s => s.className === exam.className);
    const existing = new Map((await api.getSheets({ examId })).map(s => [s.studentId, s]));

    const counts = archive.rows.reduce((m,r) => r.studentId
      ? m.set(r.studentId, (m.get(r.studentId) || 0) + 1) : m, new Map());
    const unassigned = archive.rows.filter(r => !r.studentId).length;
    const clashing   = archive.rows.filter(r => r.studentId && counts.get(r.studentId) > 1).length;
    const replacing  = archive.rows.filter(r => r.studentId && existing.has(r.studentId)).length;
    const ready      = archive.rows.length - unassigned - clashing;

    el.querySelector('#work').innerHTML = `
      <div class="grid g-4" style="margin-bottom:16px">
        <div class="stat"><div class="tile t-brand">${icon('layers')}</div>
          <div class="label">Sheets in archive</div><div class="value">${archive.rows.length}</div>
          <div class="foot"><span>${esc(archive.name)} · ${fmtBytes(archive.size)}</span></div></div>
        <div class="stat"><div class="tile t-ok">${icon('userCheck')}</div>
          <div class="label">Matched to a student</div><div class="value">${archive.rows.length - unassigned}</div>
          <div class="foot"><span>by roll number in the filename</span></div></div>
        <div class="stat"><div class="tile t-warn">${icon('alertTri')}</div>
          <div class="label">Need attention</div><div class="value">${unassigned + clashing}</div>
          <div class="foot"><span>${unassigned} unmatched · ${clashing} duplicate</span></div></div>
        <div class="stat"><div class="tile t-info">${icon('refresh')}</div>
          <div class="label">Replacing a sheet</div><div class="value">${replacing}</div>
          <div class="foot"><span>student already has one uploaded</span></div></div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h3>3 · Review extracted sheets</h3>
            <p>Click any row to open the sheet and verify it belongs to that student</p></div>
          <div class="actions">
            <button class="btn btn-sm btn-ghost" id="discardBtn">${icon('x')}Discard archive</button>
          </div>
        </div>
        <div id="rows"></div>
        <div class="card-foot">
          <label class="switch"><input type="checkbox" id="autoChk" ${autoRun?'checked':''}><span class="track"></span>
            <span style="font-size:12.8px;font-weight:560">Start AI evaluation immediately after import</span></label>
          <div style="flex:1"></div>
          <span id="importHint" style="font-size:12.3px;color:var(--warn-fg);font-weight:560"></span>
          <button class="btn btn-primary" id="importBtn">${icon('check')}Import ${ready} sheet${ready===1?'':'s'}</button>
        </div>
      </div>`;

    el.querySelector('#rows').replaceChildren(DataTable({
      rows: archive.rows,
      onRow: r => preview(r),
      cols:[
        { key:'name', label:'File in archive', render:r => `<div style="min-width:0">
            <b style="font-weight:600;font-size:12.9px">${esc(r.name)}</b>
            <div class="cell-sub">${esc(r.path.includes('/') ? r.path.split('/').slice(0,-1).join('/') + '/' : 'archive root')}
              · ${fmtBytes(r.size)}${r.pages ? ` · ${plural(r.pages,'page')}` : ''}</div></div>` },
        { key:'studentId', label:'Student', sortable:false, render:r => `
            <select class="select" data-stu="${archive.rows.indexOf(r)}" style="width:210px;height:32px;font-size:12.5px">
              <option value="" ${!r.studentId?'selected':''}>— Select student —</option>
              ${students.map(s => `<option value="${s.id}" ${s.id===r.studentId?'selected':''}>${esc(s.rollNo)} · ${esc(s.name)}</option>`).join('')}
            </select>` },
        { key:'roll', label:'Roll no.', sortable:false, render:r => {
            const s = students.find(x => x.id === r.studentId);
            return s ? `<b style="font-weight:600">${esc(s.rollNo)}</b>` : '<span style="color:var(--muted)">—</span>'; } },
        { key:'exam', label:'Examination', sortable:false, render:() =>
            `<div><b style="font-weight:560;font-size:12.7px">${esc(exam.name)}</b>
             <div class="cell-sub">${esc(exam.code)} · ${esc(exam.className)}</div></div>` },
        { key:'status', label:'Status', sortable:false, render:r => {
            if (!r.studentId) return '<span class="badge warn"><i></i>Needs a student</span>';
            if (counts.get(r.studentId) > 1) return '<span class="badge bad"><i></i>Duplicate</span>';
            if (existing.has(r.studentId)) return '<span class="badge warn"><i></i>Replaces existing</span>';
            return r.autoMatched
              ? '<span class="badge ok"><i></i>Matched</span>'
              : '<span class="badge info"><i></i>Assigned</span>'; } },
        { key:'act', label:'', sortable:false, render:() =>
            `<button class="btn btn-sm">${icon('eye')}View sheet</button>` },
      ],
    }));

    $$('[data-stu]', el).forEach(sel => sel.onchange = e => {
      e.stopPropagation();
      const r = archive.rows[+sel.dataset.stu];
      r.studentId = sel.value || null;
      r.autoMatched = false;
      drawReview();
    });
    $$('[data-stu]', el).forEach(sel => sel.onclick = e => e.stopPropagation());

    const blocked = unassigned || clashing;
    el.querySelector('#importBtn').disabled = !!blocked;
    el.querySelector('#importHint').textContent = unassigned
      ? `${unassigned} sheet${unassigned>1?'s need':' needs'} a student`
      : clashing ? `${clashing} sheets share a student` : '';

    el.querySelector('#autoChk').onchange = e => { autoRun = e.target.checked; };
    el.querySelector('#discardBtn').onclick = () => {
      archive = null; el.querySelector('#work').innerHTML = '';
      toast('Archive discarded', 'Nothing was imported', 'info');
    };
    el.querySelector('#importBtn').onclick = doImport;
  }

  /* ── sheet preview ────────────────────────────────────────────────── */
  async function preview(row){
    const exam = exams.find(e => e.id === examId);
    const students = await api.getStudents();
    const student = students.find(s => s.id === row.studentId);

    const m = Modal({
      title: row.name, wide:true,
      subtitle: `${student ? `${student.name} · ${student.rollNo}` : 'No student assigned'} · ${exam.name}`,
      body: `<div class="stack" style="gap:14px">
        <div class="row wrap" style="gap:8px">
          <span class="chip">${icon('file')}${fmtBytes(row.size)}</span>
          ${row.pages ? `<span class="chip">${icon('layers')}${plural(row.pages,'page')}</span>` : ''}
          ${row.date ? `<span class="chip">${icon('calendar')}${fmtDate(row.date)}</span>` : ''}
          <span class="chip">${icon('inbox')}${esc(row.path)}</span>
        </div>
        <div id="pv" style="min-height:220px;display:grid;place-items:center;
          border:1px solid var(--border);border-radius:var(--r-md);background:var(--surface-2);padding:14px">
          <span class="spinner"></span></div>
      </div>`,
      footer: `<button class="btn" data-close>Close</button>
               ${student ? '' : '<span style="font-size:12.4px;color:var(--warn-fg);align-self:center">Assign a student before importing</span>'}`,
    });

    const host = $('#pv', m.el);
    /* A real archive can be inflated and shown; the sample falls back to
       the same page placeholders used elsewhere in the prototype. */
    if (row.entry && row.buffer){
      try {
        const blob = await readEntry(row.buffer, row.entry, mimeOf(row.name));
        const url = URL.createObjectURL(blob);
        host.style.display = 'block';
        host.innerHTML = /\.pdf$/i.test(row.name)
          ? `<iframe src="${url}" style="width:100%;height:62vh;border:0;border-radius:var(--r)"></iframe>`
          : `<img src="${url}" alt="${esc(row.name)}" style="max-height:62vh;margin:0 auto;border-radius:var(--r)">`;
        m.el.addEventListener('click', () => setTimeout(() => URL.revokeObjectURL(url), 500), { once:true });
      } catch (err){
        host.innerHTML = `<div style="text-align:center;color:var(--muted);font-size:12.8px">
          ${icon('alertTri')}<p style="margin-top:8px">Could not display this entry — ${esc(err.message)}</p></div>`;
      }
    } else {
      host.style.display = 'block';
      host.innerHTML = `${PageThumbs(row.pages || 4, row.name)}
        <div class="comment-note" style="margin-top:13px">${icon('info')}<span>
          Sample archive — page placeholders are shown. A real ZIP is inflated in the browser
          and the actual scan is rendered here.</span></div>`;
    }
  }

  /* ── import ───────────────────────────────────────────────────────── */
  async function doImport(){
    const btn = el.querySelector('#importBtn');
    btn.innerHTML = '<span class="spinner"></span>Importing…'; btn.disabled = true;
    const created = await api.createSheets(examId, archive.rows.map(r => ({
      name: r.name, size: r.size, pages: r.pages || undefined, studentId: r.studentId,
    })));
    archive = null;
    el.querySelector('#work').innerHTML = '';
    await refreshCounts();
    toast(`${created.length} sheet${created.length===1?'':'s'} imported`,
      autoRun ? 'AI evaluation starting now' : 'Queued — start evaluation when ready', 'ok');
    if (autoRun){
      evaluator.runBatch(created.map(s => s.id));
      go('/evaluations?exam=' + examId);
    }
  }

  /* ── wiring ───────────────────────────────────────────────────────── */
  el.querySelector('#dz').replaceChildren(Dropzone({
    accept:'.zip', multiple:false,
    title:'Drop a ZIP archive of answer sheets',
    body:'One archive · PDFs or images inside · folders are read too',
    formats:['ZIP','PDF inside','JPG inside','PNG inside'],
    onFiles: files => {
      const f = files[0];
      if (!/\.zip$/i.test(f.name))
        return toast('Not a ZIP archive', 'Bulk upload takes a single .zip file', 'warn');
      ingest(f);
    },
  }));
  el.querySelector('#examSel').onchange = e => {
    examId = e.target.value; drawExam();
    if (archive) drawReview();
  };
  el.querySelector('#sampleBtn').onclick = sampleArchive;

  await drawExam();
  return el;
}
