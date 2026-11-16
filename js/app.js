import { icon } from './icons.js';
import { $, $$, esc, Avatar, toast } from './components.js';
import * as router from './router.js';
import * as api from './api.js';
import * as evaluator from './evaluator.js';

/* ── nav definition ────────────────────────────────────────────────────── */
const NAV = [
  { group:'Overview', items:[
    { path:'/',                icon:'grid',      label:'Dashboard' },
    { path:'/exams',           icon:'fileText',  label:'Exams' },
  ]},
  { group:'Intake', items:[
    { path:'/upload-paper',    icon:'filePlus',  label:'Upload Question Paper' },
    { path:'/upload-sheets',   icon:'uploadCloud', label:'Upload Answer Sheets', badge:'pending' },
    { path:'/bulk-upload',     icon:'layers',    label:'Bulk Upload' },
  ]},
  { group:'Assessment', items:[
    { path:'/students',        icon:'users',     label:'Students' },
    { path:'/evaluations',     icon:'cpu',       label:'Evaluations', badge:'review' },
    { path:'/results',         icon:'chart',     label:'Results' },
  ]},
  { group:'', items:[
    { path:'/settings',        icon:'settings',  label:'Settings' },
  ]},
];

let meta = null;
let counts = { pending:0, review:0 };

/* ── theme ─────────────────────────────────────────────────────────────── */
const THEME_KEY = 'testai.theme';
function applyTheme(t){
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch {}
  const btn = $('#themeBtn');
  if (btn){
    btn.innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
    btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }
}
function initTheme(){
  let t;
  try { t = localStorage.getItem(THEME_KEY); } catch {}
  if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(t);
}

/* ── chrome ────────────────────────────────────────────────────────────── */
function renderSidebar(){
  const active = router.path();
  $('#sidebar').innerHTML = `
    <a class="brand" href="#/">
      <div class="brand-mark">${icon('check')}</div>
      <div><div class="brand-name">Test<span>AI</span></div>
      <div class="brand-tag">Evaluation Suite</div></div>
    </a>
    <nav class="nav">
      ${NAV.map(g => `
        ${g.group ? `<div class="nav-label">${esc(g.group)}</div>` : '<div style="height:10px"></div>'}
        ${g.items.map(it => {
          const on = it.path === '/' ? active === '/' : active.startsWith(it.path);
          const n = it.badge ? counts[it.badge] : 0;
          return `<a class="nav-item ${on?'active':''}" href="#${it.path}">
            ${icon(it.icon)}<span>${esc(it.label)}</span>
            ${n ? `<span class="count ${it.badge==='pending'?'quiet':''}">${n}</span>` : ''}
          </a>`;
        }).join('')}`).join('')}
    </nav>
    <div class="sidebar-foot">
      <div class="credit-card">
        <h5>Evaluation credits</h5>
        <p>1,240 of 2,000 sheets used</p>
        <div class="credit-bar"><i style="width:62%"></i></div>
        <small>Resets 1 Oct 2026</small>
      </div>
    </div>`;
}

function renderTopbar(route){
  const crumbs = (route?.crumbs || [{ label: route?.title || 'Dashboard' }]);
  $('#topbar').innerHTML = `
    <button class="icon-btn mobile-toggle" id="navBtn" aria-label="Open navigation">${icon('menu')}</button>
    <div class="crumbs">
      ${crumbs.map((c,i) => `${i ? icon('chevRight') : ''}${
        c.href ? `<a href="#${c.href}">${esc(c.label)}</a>` : `<b>${esc(c.label)}</b>`}`).join('')}
    </div>
    <div class="search">
      ${icon('search')}
      <input id="globalSearch" type="search" placeholder="Search exams, students…" aria-label="Search" autocomplete="off">
      <kbd>⌘K</kbd>
    </div>
    <button class="icon-btn" id="themeBtn"></button>
    <button class="icon-btn" id="bellBtn" aria-label="Notifications">${icon('bell')}${counts.review?'<span class="dot"></span>':''}</button>
    <div class="sep"></div>
    <button class="user-chip" id="userBtn">
      <div class="who"><b>${esc(meta?.examiner.name || '')}</b><span>${esc(meta?.examiner.role || '')}</span></div>
      ${Avatar(meta?.examiner.name || 'Examiner')}
    </button>`;

  applyTheme(document.documentElement.dataset.theme);
  $('#themeBtn').onclick = () =>
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  $('#navBtn').onclick = () => document.body.classList.toggle('nav-open');
  $('#bellBtn').onclick = () => notifications();
  $('#userBtn').onclick = () => router.go('/settings');
  wireSearch();
}

/* ── global search ─────────────────────────────────────────────────────── */
let searchPanel = null;
function wireSearch(){
  const input = $('#globalSearch');
  if (!input) return;
  const close = () => { searchPanel?.remove(); searchPanel = null; };
  input.addEventListener('input', async () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) return close();
    const [exams, students] = await Promise.all([api.getExams(), api.getStudents()]);
    const hits = [
      ...exams.filter(e => (e.name + e.code + e.subject).toLowerCase().includes(q))
        .slice(0,4).map(e => ({ icon:'fileText', label:e.name, sub:`${e.code} · ${e.className}`, href:`/exams/${e.id}` })),
      ...students.filter(s => (s.name + s.rollNo).toLowerCase().includes(q))
        .slice(0,4).map(s => ({ icon:'user', label:s.name, sub:`${s.rollNo} · ${s.className}`, href:`/students/${s.id}` })),
    ];
    close();
    searchPanel = document.createElement('div');
    Object.assign(searchPanel.style, {
      position:'absolute', top:'42px', left:'0', right:'0', zIndex:'50',
      background:'var(--surface)', border:'1px solid var(--border)',
      borderRadius:'var(--r-md)', boxShadow:'var(--shadow-lg)', overflow:'hidden',
    });
    searchPanel.innerHTML = hits.length
      ? hits.map(h => `<a class="list-item" href="#${h.href}" style="padding:10px 13px">
          <div style="width:29px;height:29px;border-radius:8px;display:grid;place-items:center;background:var(--surface-3);color:var(--muted);flex:0 0 auto">${icon(h.icon)}</div>
          <div class="meta"><b>${esc(h.label)}</b><span>${esc(h.sub)}</span></div>
          ${icon('arrowRight','')}</a>`).join('')
      : `<div style="padding:20px;text-align:center;color:var(--muted);font-size:12.8px">No matches for "${esc(q)}"</div>`;
    $('.search').appendChild(searchPanel);
    $$('a', searchPanel).forEach(a => a.onclick = () => { input.value = ''; close(); });
  });
  input.addEventListener('blur', () => setTimeout(close, 180));
  input.addEventListener('keydown', e => { if (e.key === 'Escape'){ input.value = ''; close(); input.blur(); } });
}

function notifications(){
  import('./components.js').then(({ Modal }) => Modal({
    title:'Notifications', subtitle:'Recent pipeline and review activity',
    body: `<div style="margin:0 -20px">${[
      counts.review ? { i:'alertTri', t:`${counts.review} evaluations awaiting your review`, s:'Across all active exams', h:'/evaluations' } : null,
      counts.pending ? { i:'inbox', t:`${counts.pending} answer sheets not yet processed`, s:'Queue them to start AI evaluation', h:'/upload-sheets' } : null,
      { i:'sparkles', t:'Evaluation model updated to testai-eval-2.4', s:'Improved handwriting recognition on faint scans', h:'/settings' },
      { i:'checkCircle', t:'Physics Unit Test II results published', s:'10 of 10 sheets evaluated', h:'/results' },
    ].filter(Boolean).map(n => `<a class="list-item" href="#${n.h}" data-close>
      <div style="width:31px;height:31px;border-radius:9px;display:grid;place-items:center;background:var(--brand-50);color:var(--brand-600);flex:0 0 auto">${icon(n.i)}</div>
      <div class="meta"><b>${esc(n.t)}</b><span>${esc(n.s)}</span></div>${icon('chevRight')}</a>`).join('')}</div>`,
  }));
}

/* ── counts ────────────────────────────────────────────────────────────── */
export async function refreshCounts(){
  const sheets = await api.getSheets();
  counts = {
    pending: sheets.filter(s => s.status === 'pending' || s.status === 'processing').length,
    review:  sheets.filter(s => s.status === 'evaluated').length,
  };
  renderSidebar();
  const bell = $('#bellBtn');
  if (bell) bell.innerHTML = icon('bell') + (counts.review ? '<span class="dot"></span>' : '');
}

/* ── routes ────────────────────────────────────────────────────────────── */
const view = m => (params, q) => m().then(mod => mod.render(params, q));

router.route('/',                view(() => import('./views/dashboard.js')),         { title:'Dashboard' });
router.route('/exams',           view(() => import('./views/exams.js')),             { title:'Exams' });
router.route('/exams/:id',       view(() => import('./views/exam-detail.js')),       { title:'Exam' });
router.route('/upload-paper',    view(() => import('./views/upload-paper.js')),      { title:'Upload Question Paper' });
router.route('/upload-sheets',   view(() => import('./views/upload-sheets.js')),     { title:'Upload Answer Sheets' });
router.route('/bulk-upload',     view(() => import('./views/bulk-upload.js')),       { title:'Bulk Upload' });
router.route('/students',        view(() => import('./views/students.js')),          { title:'Students' });
router.route('/students/:id',    view(() => import('./views/student-detail.js')),    { title:'Student' });
router.route('/evaluations',     view(() => import('./views/evaluations.js')),       { title:'Evaluations' });
router.route('/evaluations/:id', view(() => import('./views/evaluation-detail.js')), { title:'Evaluation' });
router.route('/results',         view(() => import('./views/results.js')),           { title:'Results' });
router.route('/results/:id',     view(() => import('./views/results.js')),           { title:'Results' });
router.route('/settings',        view(() => import('./views/settings.js')),          { title:'Settings' });
router.setNotFound(() => `<div class="view"><div class="card"><div class="empty">
  <div class="ei">${icon('search')}</div><h4>Page not found</h4>
  <p>The screen you are looking for does not exist in this prototype.</p>
  <a class="btn btn-primary" href="#/">Back to dashboard</a></div></div></div>`);

/* Breadcrumb titles are set by views via document.title conventions. */
router.onRoute(route => {
  document.title = `${route.title || 'Test AI'} · Test AI`;
  renderSidebar();
  renderTopbar(route);
  document.body.classList.remove('nav-open');
});
/** Views call this to refine the breadcrumb once their data has loaded. */
export function setCrumbs(crumbs){
  const r = router.currentRoute();
  renderTopbar({ ...r, crumbs });
}

/* ── boot ──────────────────────────────────────────────────────────────── */
initTheme();
meta = await api.getMeta();
await refreshCounts();
$('#scrim').onclick = () => document.body.classList.remove('nav-open');
addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'){
    e.preventDefault(); $('#globalSearch')?.focus();
  }
});
/* Keep the sidebar badges honest while the pipeline runs. */
evaluator.subscribe(ev => { if (ev.type === 'complete' || ev.type === 'start') refreshCounts(); });

router.start($('#view'));
export { meta };
