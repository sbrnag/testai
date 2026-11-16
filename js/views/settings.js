import { icon } from '../icons.js';
import * as api from '../api.js';
import * as evaluator from '../evaluator.js';
import { $, $$, esc, toast, confirmModal } from '../components.js';
import { refreshCounts } from '../app.js';

const SECTIONS = [
  ['institution','Institution','building'],
  ['evaluation','AI evaluation','sparkles'],
  ['marking','Marking rules','scale'],
  ['appearance','Appearance','sun'],
  ['data','Data & prototype','shield'],
];

export async function render(){
  const el = document.createElement('div');
  el.className = 'view';
  const meta = await api.getMeta();
  let section = 'institution';

  el.innerHTML = `
    <div class="view-head">
      <div class="titles"><h1>Settings</h1><p>Configure how Test AI evaluates, marks and presents results.</p></div>
    </div>
    <div class="settings-grid">
      <div class="card"><div class="card-body set-nav" style="padding:9px" id="nav">
        ${SECTIONS.map(([k,label,ic]) => `<button data-s="${k}" class="${k===section?'on':''}">
          <span class="row" style="gap:9px">${icon(ic)}${esc(label)}</span></button>`).join('')}
      </div></div>
      <div id="panel"></div>
    </div>`;

  const panel = el.querySelector('#panel');
  const row = (title, desc, ctl) => `<div class="set-row">
    <div class="info"><b>${title}</b><p>${desc}</p></div><div class="ctl">${ctl}</div></div>`;
  const sw = (id, on) => `<label class="switch"><input type="checkbox" id="${id}" ${on?'checked':''}><span class="track"></span></label>`;

  const panels = {
    institution: () => `<div class="card">
      <div class="card-head"><div><h3>Institution</h3><p>Appears on exported result sheets and evaluation reports</p></div></div>
      <div class="card-body">
        <div class="grid g-2" style="gap:15px;margin-bottom:6px">
          <div class="field"><label>Institution name</label><input class="input" value="${esc(meta.institution.name)}"></div>
          <div class="field"><label>Short code</label><input class="input" value="${esc(meta.institution.short)}"></div>
          <div class="field"><label>Academic session</label><input class="input" value="${esc(meta.institution.session)}"></div>
          <div class="field"><label>Examiner in charge</label><input class="input" value="${esc(meta.examiner.name)}"></div>
        </div>
        ${row('Department', 'Shown alongside the examiner name on approval records.',
              `<input class="input" style="width:200px" value="${esc(meta.examiner.dept)}">`)}
      </div>
      <div class="card-foot"><div style="flex:1"></div><button class="btn btn-primary" data-save>${icon('save')}Save changes</button></div>
    </div>`,

    evaluation: () => `<div class="card">
      <div class="card-head"><div><h3>AI evaluation</h3><p>How the model reads and scores handwritten answers</p></div></div>
      <div class="card-body">
        ${row('Evaluation model', 'The model version used for semantic comparison and scoring.',
          `<select class="select" id="model" style="width:200px">${
            ['testai-eval-2.4','testai-eval-2.1','testai-eval-1.8 (legacy)']
              .map(m => `<option ${m===meta.settings.model?'selected':''}>${m}</option>`).join('')}</select>`)}
        ${row('Grading strictness', 'Lenient credits partial understanding generously. Strict requires each key concept to be explicit.',
          `<div class="seg" id="strict">${['lenient','balanced','strict'].map(s =>
            `<button data-v="${s}" class="${s===meta.settings.strictness?'on':''}">${s[0].toUpperCase()+s.slice(1)}</button>`).join('')}</div>`)}
        ${row('Minimum OCR confidence', 'Sheets transcribed below this confidence are flagged for manual verification rather than auto-scored.',
          `<div class="row" style="gap:11px"><input type="range" id="conf" min="50" max="95" step="5" value="${meta.settings.minConfidence}" style="width:150px">
           <b style="font-size:13px;width:38px;font-variant-numeric:tabular-nums" id="confVal">${meta.settings.minConfidence}%</b></div>`)}
        ${row('Auto-approve high-confidence results', 'Approve without review when OCR confidence is high and no key concept is missing. Off by default — examiner review is the safer default for a live exam.',
          sw('autoApprove', meta.settings.autoApprove))}
        ${row('Notify when a batch completes', 'Show a notification once every queued sheet has been evaluated.',
          sw('notify', meta.settings.notifyOnComplete))}
        ${row('Simulation speed', 'Prototype only — controls how fast the mock pipeline runs so you can watch the stages.',
          `<div class="seg" id="speed">${[['0.5','Slow'],['1','Normal'],['3','Fast']].map(([v,l]) =>
            `<button data-v="${v}" class="${+v===evaluator.speed?'on':''}">${l}</button>`).join('')}</div>`)}
      </div>
      <div class="card-foot"><div style="flex:1"></div><button class="btn btn-primary" data-save>${icon('save')}Save changes</button></div>
    </div>`,

    marking: () => `<div class="card">
      <div class="card-head"><div><h3>Marking rules</h3><p>How marks are awarded, rounded and presented</p></div></div>
      <div class="card-body">
        ${row('Allow half marks', 'Permits 0.5 increments when overriding marks and when the AI awards partial credit.',
          sw('halfMarks', meta.settings.halfMarks))}
        ${row('Pass mark', 'Used for pass-rate statistics and the grade boundaries on result sheets.',
          `<div class="row" style="gap:7px"><input class="input" type="number" value="35" min="0" max="100" style="width:78px">
           <span style="font-size:13px;color:var(--muted)">%</span></div>`)}
        ${row('Grade scale', 'Applied across every exported result sheet.',
          `<select class="select" style="width:200px"><option>A+ / A / B / C / D / E / F</option><option>9-point CBSE scale</option><option>Percentage only</option></select>`)}
        ${row('Require a reason for overrides', 'An examiner changing an AI mark must record why. Recommended — it keeps the evaluation auditable.',
          sw('reqReason', true))}
      </div>
      <div class="card-foot"><div style="flex:1"></div><button class="btn btn-primary" data-save>${icon('save')}Save changes</button></div>
    </div>`,

    appearance: () => `<div class="card">
      <div class="card-head"><div><h3>Appearance</h3></div></div>
      <div class="card-body">
        ${row('Theme', 'Applies to this browser. Test AI follows your system setting until you choose.',
          `<div class="seg" id="theme">${[['light','Light'],['dark','Dark']].map(([v,l]) =>
            `<button data-v="${v}" class="${document.documentElement.dataset.theme===v?'on':''}">${l}</button>`).join('')}</div>`)}
        ${row('Density', 'Compact fits more rows on screen at the cost of breathing room.',
          `<div class="seg"><button class="on">Comfortable</button><button>Compact</button></div>`)}
      </div>
    </div>`,

    data: () => `<div class="stack">
      <div class="card">
        <div class="card-head"><div><h3>Prototype data</h3><p>This build runs entirely in your browser</p></div></div>
        <div class="card-body">
          <div class="comment-note" style="margin-bottom:4px">${icon('info')}<span>
            Test AI is a frontend prototype. Exams, sheets, evaluations and your overrides are stored in
            this browser's local storage — nothing is sent anywhere. The AI pipeline is simulated with
            authored answer variants, and <b>js/api.js</b> is the single seam where real endpoints
            would replace the mock calls.</span></div>
          ${row('Reset demo data', 'Restores the seeded exams, students and evaluations, discarding everything you have created or overridden.',
            `<button class="btn btn-danger" id="resetBtn">${icon('refresh')}Reset demo data</button>`)}
          ${row('Export everything', 'Downloads the full local database as JSON.',
            `<button class="btn" id="dumpBtn">${icon('download')}Export JSON</button>`)}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Integration points</h3><p>What a production deployment would connect to</p></div></div>
        <div class="card-body"><div class="stack" style="gap:0">
          ${[['scan','OCR / handwriting recognition','Transcribes scanned pages into text with per-region confidence','evaluator.js → runJob()'],
             ['sparkles','Semantic evaluation model','Compares student answers to the model answer and drafts feedback','evaluator.js → grade()'],
             ['users','Student information system','Keeps the roster and class assignments in sync','api.js → getStudents()'],
             ['inbox','Document storage','Holds the uploaded papers, keys and scanned answer sheets','api.js → createSheets()'],
             ['external','Results publishing','Releases approved marks to students and to the board','results.js → publish']]
            .map(([ic,t,d,seam]) => `<div class="set-row">
              <div style="width:33px;height:33px;border-radius:9px;display:grid;place-items:center;background:var(--brand-50);color:var(--brand-600);flex:0 0 auto">${icon(ic)}</div>
              <div class="info"><b>${esc(t)}</b><p>${esc(d)}</p></div>
              <div class="ctl"><code style="font-family:var(--mono);font-size:11.4px;color:var(--muted);background:var(--surface-3);padding:4px 8px;border-radius:6px;white-space:nowrap">${esc(seam)}</code></div>
            </div>`).join('')}
        </div></div>
      </div>
    </div>`,
  };

  function drawPanel(){
    panel.innerHTML = panels[section]();

    $$('[data-save]', panel).forEach(b => b.onclick = async () => {
      b.innerHTML = '<span class="spinner"></span>Saving…'; b.disabled = true;
      await api.updateSettings({});
      b.innerHTML = `${icon('save')}Save changes`; b.disabled = false;
      toast('Settings saved', 'Changes applied to this workspace', 'ok');
    });

    const conf = $('#conf', panel);
    if (conf) conf.oninput = e => { $('#confVal', panel).textContent = e.target.value + '%'; };

    $$('#strict button', panel).forEach(b => b.onclick = async () => {
      $$('#strict button', panel).forEach(x => x.classList.remove('on')); b.classList.add('on');
      await api.updateSettings({ strictness:b.dataset.v });
      toast('Grading strictness updated', `Now set to ${b.dataset.v}`, 'info');
    });
    $$('#speed button', panel).forEach(b => b.onclick = () => {
      $$('#speed button', panel).forEach(x => x.classList.remove('on')); b.classList.add('on');
      evaluator.setSpeed(+b.dataset.v);
      toast('Simulation speed changed', `Pipeline runs at ${b.dataset.v}×`, 'info');
    });
    $$('#theme button', panel).forEach(b => b.onclick = () => {
      $$('#theme button', panel).forEach(x => x.classList.remove('on')); b.classList.add('on');
      document.documentElement.dataset.theme = b.dataset.v;
      try { localStorage.setItem('testai.theme', b.dataset.v); } catch {}
      const tb = document.querySelector('#themeBtn');
      if (tb) tb.innerHTML = icon(b.dataset.v === 'dark' ? 'sun' : 'moon');
    });

    const reset = $('#resetBtn', panel);
    if (reset) reset.onclick = () => confirmModal({
      title:'Reset all demo data?', danger:true, confirmLabel:'Reset everything',
      body:'Every exam you created, sheet you uploaded, mark you overrode and evaluation you approved will be discarded, and the original sample data restored. This cannot be undone.',
      onConfirm: async () => {
        await api.resetDemo();
        await refreshCounts();
        toast('Demo data reset', 'Sample exams and evaluations restored', 'ok');
        location.hash = '/';
        setTimeout(() => location.reload(), 400);
      },
    });

    const dump = $('#dumpBtn', panel);
    if (dump) dump.onclick = () => {
      const raw = localStorage.getItem('testai.db.v1') || '{}';
      const url = URL.createObjectURL(new Blob([raw], { type:'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = 'testai-database.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Database exported', 'testai-database.json', 'ok');
    };
  }

  $$('#nav button', el).forEach(b => b.onclick = () => {
    $$('#nav button', el).forEach(x => x.classList.remove('on'));
    b.classList.add('on'); section = b.dataset.s; drawPanel();
  });
  drawPanel();
  return el;
}
