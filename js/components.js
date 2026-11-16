import { icon } from './icons.js';

/* ── helpers ───────────────────────────────────────────────────────────── */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const $  = (s, r=document) => r.querySelector(s);
export const $$ = (s, r=document) => [...r.querySelectorAll(s)];
export const initials = n => n.split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
export const pct = (a,b) => b ? Math.round((a/b)*1000)/10 : 0;
export const fmtDate = d => new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
export const fmtShort = d => new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
export const fmtTime = d => new Date(d).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
export const fmtBytes = b => b < 1048576 ? (b/1024).toFixed(0)+' KB' : (b/1048576).toFixed(1)+' MB';
export function ago(d){
  const s = (Date.now()-new Date(d))/1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60)+'m ago';
  if (s < 86400) return Math.floor(s/3600)+'h ago';
  if (s < 604800) return Math.floor(s/86400)+'d ago';
  return fmtShort(d);
}
/** Deterministic pseudo-random in [0,1) from a string — keeps mock data stable. */
export function hashRand(str, salt=0){
  let h = 2166136261 ^ salt;
  for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}
export const gradeOf = p =>
  p >= 90 ? 'A+' : p >= 80 ? 'A' : p >= 70 ? 'B' : p >= 60 ? 'C' : p >= 50 ? 'D' : p >= 35 ? 'E' : 'F';
export const toneOf = p => p >= 75 ? 'ok' : p >= 50 ? 'warn' : 'bad';

/* ── atoms ─────────────────────────────────────────────────────────────── */
export const Avatar = (name, cls='') =>
  `<div class="avatar ${cls}" style="background:${avatarBg(name)}">${esc(initials(name))}</div>`;
function avatarBg(name){
  const h = Math.floor(hashRand(name)*360);
  return `linear-gradient(145deg,hsl(${h} 62% 56%),hsl(${(h+38)%360} 58% 44%))`;
}

const STATUS = {
  pending:    ['',       'Pending'],
  queued:     ['info',   'Queued'],
  processing: ['brand',  'Processing'],
  evaluated:  ['warn',   'Needs review'],
  approved:   ['ok',     'Approved'],
  draft:      ['',       'Draft'],
  active:     ['info',   'Active'],
  completed:  ['ok',     'Completed'],
  failed:     ['bad',    'Failed'],
};
export function StatusBadge(status){
  const [tone, label] = STATUS[status] || ['', status];
  const live = status === 'processing' ? ' pulse' : '';
  return `<span class="badge ${tone}${live}"><i></i>${esc(label)}</span>`;
}

export function StatCard({label, value, unit='', iconName, tone='brand', delta, deltaDir='up', foot}){
  const d = delta ? `<span class="delta ${deltaDir}">${icon(deltaDir==='up'?'arrowUp':deltaDir==='down'?'arrowDown':'minus')}${esc(delta)}</span>` : '';
  return `<div class="stat">
    <div class="tile t-${tone}">${icon(iconName)}</div>
    <div class="label">${esc(label)}</div>
    <div class="value">${esc(value)}${unit?`<small>${esc(unit)}</small>`:''}</div>
    <div class="foot">${d}${foot?`<span>${esc(foot)}</span>`:''}</div>
  </div>`;
}

export function Bar(value, max, tone){
  const p = Math.min(100, pct(value, max));
  const t = tone || toneOf(p);
  return `<div class="bar-row"><div class="bar ${t}"><i style="width:${p}%"></i></div><span class="pct">${p}%</span></div>`;
}

export function Ring(percent, {size=104, stroke=9, label='Average', tone}={}){
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const off = c - (Math.min(100, Math.max(0, percent)) / 100) * c;
  const color = tone === false ? 'var(--brand-600)' :
    `var(--${toneOf(percent) === 'ok' ? 'ok' : toneOf(percent) === 'warn' ? 'warn' : 'bad'}-solid)`;
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}">
      <circle class="track" cx="${size/2}" cy="${size/2}" r="${r}" stroke-width="${stroke}"/>
      <circle class="val" cx="${size/2}" cy="${size/2}" r="${r}" stroke-width="${stroke}"
        style="stroke:${color}" stroke-dasharray="${c}" stroke-dashoffset="${off}"/>
    </svg>
    <div class="lbl"><b>${Math.round(percent)}%</b><span>${esc(label)}</span></div>
  </div>`;
}

export const Empty = ({iconName='inbox', title, body, action}) =>
  `<div class="empty"><div class="ei">${icon(iconName)}</div><h4>${esc(title)}</h4>
   <p>${esc(body||'')}</p>${action||''}</div>`;

export const Skeleton = (rows=5) =>
  `<div style="padding:18px">${'<div class="skeleton sk-row"></div>'.repeat(rows)}</div>`;

/* ── data table ────────────────────────────────────────────────────────── */
/**
 * cols: [{ key, label, align?, sortable?, width?, render(row) }]
 * opts: { rows, cols, onRow(row), empty, sort:{key,dir} }
 */
export function DataTable({rows, cols, onRow, empty, sortState}){
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  let sort = sortState || {key:null, dir:'asc'};

  const draw = () => {
    let data = [...rows];
    if (sort.key){
      const col = cols.find(c => c.key === sort.key);
      const val = r => (col.sortValue ? col.sortValue(r) : r[sort.key]);
      data.sort((a,b) => {
        const x = val(a), y = val(b);
        const n = typeof x === 'number' && typeof y === 'number'
          ? x - y : String(x??'').localeCompare(String(y??''));
        return sort.dir === 'asc' ? n : -n;
      });
    }
    if (!data.length){ wrap.innerHTML = empty || Empty({title:'Nothing here yet'}); return; }
    wrap.innerHTML = `<table class="data"><thead><tr>${cols.map(c =>
      `<th class="${c.sortable!==false?'sortable':''} ${sort.key===c.key?'sorted':''}"
           data-k="${c.key}" style="${c.width?`width:${c.width}`:''};${c.align==='right'?'text-align:right':''}">
        ${esc(c.label)}${c.sortable!==false?`<span class="arrow">${sort.key===c.key?(sort.dir==='asc'?'▲':'▼'):'▲'}</span>`:''}
      </th>`).join('')}</tr></thead><tbody>${
      data.map((r,i) => `<tr data-i="${i}" class="${onRow?'clickable':''}">${cols.map(c =>
        `<td class="${c.align==='right'?'num':''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')
    }</tbody></table>`;

    $$('th.sortable', wrap).forEach(th => th.onclick = () => {
      const k = th.dataset.k;
      sort = { key:k, dir: sort.key === k && sort.dir === 'asc' ? 'desc' : 'asc' };
      draw();
    });
    if (onRow) $$('tbody tr', wrap).forEach(tr => tr.onclick = e => {
      if (e.target.closest('button,a,input,select')) return;
      onRow(data[+tr.dataset.i]);
    });
  };
  draw();
  return wrap;
}

/* ── modal ─────────────────────────────────────────────────────────────── */
export function Modal({title, subtitle, body, footer, wide, onMount}){
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.innerHTML = `<div class="modal ${wide?'wide':''}" role="dialog" aria-modal="true">
    <div class="modal-head">
      <div style="flex:1;min-width:0"><h3>${esc(title)}</h3>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div>
      <button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
    </div>
    <div class="modal-body">${body}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
  </div>`;
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  scrim.onclick = e => { if (e.target === scrim) close(); };
  $$('[data-close]', scrim).forEach(b => b.onclick = close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(scrim);
  scrim.querySelector('input,textarea,select,button:not([data-close])')?.focus();
  if (onMount) onMount(scrim, close);
  return { el: scrim, close };
}

export function confirmModal({title, body, confirmLabel='Confirm', danger, onConfirm}){
  return Modal({
    title, body: `<p style="font-size:13.4px;color:var(--text-2);line-height:1.6">${body}</p>`,
    footer: `<button class="btn" data-close>Cancel</button>
             <button class="btn ${danger?'btn-danger':'btn-primary'}" data-yes>${esc(confirmLabel)}</button>`,
    onMount: (el, close) => { $('[data-yes]', el).onclick = () => { close(); onConfirm(); }; }
  });
}

/* ── toast ─────────────────────────────────────────────────────────────── */
export function toast(title, body='', kind='ok'){
  let host = $('.toasts');
  if (!host){ host = document.createElement('div'); host.className = 'toasts'; document.body.appendChild(host); }
  const ic = {ok:'checkCircle', bad:'xCircle', warn:'alertTri', info:'info'}[kind];
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.innerHTML = `${icon(ic,'ti')}<div style="min-width:0"><b>${esc(title)}</b>${body?`<span>${esc(body)}</span>`:''}</div>`;
  host.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 200); }, 3600);
}

/* ── dropzone ──────────────────────────────────────────────────────────── */
export function Dropzone({accept, multiple=true, title, body, formats=[], onFiles}){
  const dz = document.createElement('div');
  dz.className = 'dropzone';
  dz.setAttribute('tabindex','0');
  dz.innerHTML = `<div class="dz-icon">${icon('uploadCloud')}</div>
    <h4>${esc(title)}</h4><p>${esc(body)}</p>
    <div class="formats">${formats.map(f => `<span class="chip">${esc(f)}</span>`).join('')}</div>
    <input type="file" hidden ${multiple?'multiple':''} accept="${accept||''}">`;
  const input = $('input', dz);
  dz.onclick = () => input.click();
  dz.onkeydown = e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); input.click(); } };
  input.onchange = () => { if (input.files.length) onFiles([...input.files]); input.value = ''; };
  ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => {
    const f = [...(e.dataTransfer?.files || [])];
    if (f.length) onFiles(f);
  });
  return dz;
}

/* ── page thumbnails (placeholder renders of scanned pages) ────────────── */
export function PageThumbs(count, seed='p', active=0){
  return `<div class="pages">${Array.from({length:count}, (_,i) => {
    const lines = 8 + Math.floor(hashRand(seed + i) * 4);
    return `<div class="page-thumb ${i===active?'on':''}" data-page="${i}">
      <div class="lines">${Array.from({length:lines}, (_,j) =>
        `<i style="width:${55 + Math.floor(hashRand(seed+i+'-'+j)*45)}%"></i>`).join('')}</div>
      <div class="pn">Page ${i+1}</div></div>`;
  }).join('')}</div>`;
}

/* ── charts (hand-rolled inline SVG, theme-aware) ──────────────────────── */
/**
 * @param max  Fix the axis top. Pass 100 for percentage data — normalising to
 *             the data's own peak renders the highest value as a full bar,
 *             which reads as "maximum" when it may be 76%.
 */
export function BarChart({data, height=190, unit='', horizontal=false, max: fixedMax}){
  const max = fixedMax ?? Math.max(...data.map(d => d.value), 1);
  const W = 100, n = data.length;
  if (horizontal){
    return `<div class="stack" style="gap:11px">${data.map(d => `
      <div>
        <div class="row" style="justify-content:space-between;margin-bottom:5px">
          <span style="font-size:12.4px;font-weight:560;color:var(--text-2)">${esc(d.label)}</span>
          <span style="font-size:12.4px;font-weight:670;font-variant-numeric:tabular-nums">${d.value}${esc(unit)}</span>
        </div>
        <div class="bar ${d.tone||toneOf(pct(d.value,max))}" style="height:8px">
          <i style="width:${pct(d.value,max)}%"></i></div>
      </div>`).join('')}</div>`;
  }
  const gap = 2.2, bw = (W - gap*(n-1)) / n;
  return `<svg class="chart" viewBox="0 0 100 ${height/2}" preserveAspectRatio="none" style="height:${height}px">
    ${[0,.25,.5,.75,1].map(g => `<line class="grid-line" x1="0" x2="100" y1="${(height/2)*g*0.82}" y2="${(height/2)*g*0.82}" vector-effect="non-scaling-stroke"/>`).join('')}
    ${data.map((d,i) => {
      const h = (d.value / max) * (height/2) * 0.8;
      return `<rect class="b" x="${i*(bw+gap)}" y="${(height/2)*0.82 - h}" width="${bw}" height="${Math.max(h,.6)}" rx="1.2">
        <title>${esc(d.label)}: ${d.value}${esc(unit)}</title></rect>`;
    }).join('')}
  </svg>
  <div style="display:flex;gap:2.2%;margin-top:7px">${data.map(d =>
    `<span style="flex:1;text-align:center;font-size:10.4px;color:var(--muted);font-weight:560">${esc(d.label)}</span>`).join('')}</div>`;
}

export function LineChart({data, height=200, unit=''}){
  const max = Math.max(...data.map(d => d.value)) * 1.12 || 1;
  const min = Math.min(...data.map(d => d.value)) * 0.85;
  const W = 100, H = height / 2, pad = 3;
  const x = i => (i / (data.length - 1)) * W;
  const y = v => H - pad - ((v - min) / (max - min || 1)) * (H - pad*2);
  const pts = data.map((d,i) => `${x(i)},${y(d.value)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 100 ${H}" preserveAspectRatio="none" style="height:${height}px">
    <defs><linearGradient id="gradFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--brand-600)" stop-opacity=".28"/>
      <stop offset="100%" stop-color="var(--brand-600)" stop-opacity="0"/>
    </linearGradient></defs>
    ${[0,.33,.66,1].map(g => `<line class="grid-line" x1="0" x2="100" y1="${pad + g*(H-pad*2)}" y2="${pad + g*(H-pad*2)}" vector-effect="non-scaling-stroke"/>`).join('')}
    <polygon class="area" points="0,${H} ${pts} 100,${H}"/>
    <polyline class="line" points="${pts}" vector-effect="non-scaling-stroke"/>
    ${data.map((d,i) => `<circle class="pt" cx="${x(i)}" cy="${y(d.value)}" r="1.5" vector-effect="non-scaling-stroke">
      <title>${esc(d.label)}: ${d.value}${esc(unit)}</title></circle>`).join('')}
  </svg>
  <div style="display:flex;margin-top:7px">${data.map((d,i) =>
    `<span style="flex:1;text-align:${i===0?'left':i===data.length-1?'right':'center'};font-size:10.4px;color:var(--muted);font-weight:560">${
      i % Math.ceil(data.length/6) === 0 || i === data.length-1 ? esc(d.label) : ''}</span>`).join('')}</div>`;
}
