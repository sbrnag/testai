/* Hash router. Patterns use :params — '/exams/:id' matches '#/exams/ex_1'. */
const routes = [];
let notFound = () => '<div class="view"><h1>Not found</h1></div>';
let onNavigate = () => {};
let current = null;

export function route(pattern, handler, meta = {}){
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:([\w]+)/g, (_,k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ pattern, rx, keys, handler, meta });
}
export const setNotFound = fn => { notFound = fn; };
export const onRoute = fn => { onNavigate = fn; };
export const path = () => (location.hash.slice(1) || '/').split('?')[0];
export const query = () => Object.fromEntries(new URLSearchParams((location.hash.split('?')[1] || '')));
export const go = to => { location.hash = to; };
export const back = () => history.back();
export const currentRoute = () => current;

export function match(p = path()){
  for (const r of routes){
    const m = p.match(r.rx);
    if (m) return { route:r, params: Object.fromEntries(r.keys.map((k,i) => [k, decodeURIComponent(m[i+1])])) };
  }
  return null;
}

let token = 0;
export async function render(host){
  const p = path();
  const hit = match(p);
  const mine = ++token;
  current = hit ? { ...hit.route.meta, path:p, params:hit.params } : { path:p, title:'Not found' };
  onNavigate(current);

  host.scrollTop = 0;
  window.scrollTo({ top:0 });
  try {
    const out = hit ? await hit.route.handler(hit.params, query()) : await notFound();
    if (mine !== token) return;                 // a newer navigation won
    host.replaceChildren();
    if (typeof out === 'string') host.innerHTML = out;
    else if (out instanceof Node) host.appendChild(out);
  } catch (err){
    if (mine !== token) return;
    console.error(err);
    host.innerHTML = `<div class="view"><div class="card"><div class="card-body">
      <h3 style="margin-bottom:6px">Something went wrong</h3>
      <p style="color:var(--muted);font-size:13px">${err.message}</p></div></div></div>`;
  }
}

export function start(host){
  addEventListener('hashchange', () => render(host));
  if (!location.hash) location.hash = '/';
  render(host);
}
