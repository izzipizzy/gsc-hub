import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/guard';

// Per-op progress log for the bulk sitemap/Bing/IndexNow submits. One page per
// op (?op=sitemap|bing|indexnow); runs every GSC site a few at a time, staggered,
// shows ✓/✗ per site. Failed rows are clickable to retry.
//
// Progress persists to localStorage (keyed by op): an accidental refresh RESUMES
// instead of re-submitting everything (re-submitting to Bing just hits
// ThrottleUser). "Стоп" drains the queue; "Заново" clears and restarts.
const OPS = ['sitemap', 'bing', 'indexnow'];

export const GET: RequestHandler = async ({ url, locals }) => {
  requireAdmin(locals);
  const op = url.searchParams.get('op') || '';
  if (!OPS.includes(op)) throw error(400, 'op required (sitemap|bing|indexnow)');

  const title = { sitemap: 'Submit all sitemaps (Google)', bing: 'Submit all to Bing', indexnow: 'IndexNow all' }[op];

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{margin:0;font:14px system-ui,sans-serif;background:#0b1020;color:#e2e8f0}
  #bar{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:10px 14px;background:#0f172a;border-bottom:1px solid #1e293b;font-weight:600;z-index:10}
  #bar #t{flex:1}
  #bar button{font:inherit;font-weight:600;color:#e2e8f0;background:#1e293b;border:1px solid #334155;border-radius:6px;padding:4px 12px;cursor:pointer}
  #bar button:hover{background:#334155}
  #rows{padding:8px 14px}
  .row{display:flex;gap:10px;align-items:center;padding:4px 0;border-bottom:1px solid #111827;font-size:13px}
  .row .d{flex:1;word-break:break-all;color:#cbd5e1}
  .row .s{min-width:200px;text-align:right;color:#94a3b8}
  .ok .s{color:#4ade80}.bad .s{color:#f87171;cursor:pointer}
</style></head><body>
<div id="bar"><span id="t">${title} — загрузка списка…</span><button id="retryfail" title="Повторить все упавшие">Повторить ошибки</button><button id="stop" title="Остановить запуск новых, очистить очередь">Стоп</button><button id="rerun" title="Очистить прогресс и начать заново">Заново</button></div>
<div id="rows"></div>
<script>
const OP=${JSON.stringify(op)}, CONC=3, GAP=1500, LS='submit-all:'+OP;
const CFG={
  sitemap:{url:'/properties/sitemap-submit', body:e=>({account:e.account,site:e.site}),
           fmt:r=>'✓ submitted '+(r.submitted?r.submitted.length:0)+((r.failed&&r.failed.length)?(' · ✗ '+r.failed.length):''),
           good:r=>!(r.failed&&r.failed.length)},
  bing:{url:'/properties/bing-sitemap', body:e=>({site:e.site}), fmt:r=>r.ok!==false?('✓ '+(r.submitted||'submitted')):('✗ '+(r.error||'fail')), good:r=>r.ok!==false},
  indexnow:{url:'/properties/indexnow', body:e=>({site:e.site}), fmt:r=>'✓ '+(r.submitted||0)+' URLs', good:r=>r.ok!==false},
}[OP];
const bar=document.getElementById('t'), rowsEl=document.getElementById('rows');
function loadState(){ try{ return JSON.parse(localStorage.getItem(LS)||'{}'); }catch(e){ return {}; } }
function saveState(){ try{ localStorage.setItem(LS, JSON.stringify(state)); }catch(e){} }
let state=loadState();
let sites=[], queue=[], running=0, finished=0, stopped=false;
const rows={}, entries={};

document.getElementById('rerun').onclick=function(){ localStorage.removeItem(LS); location.reload(); };
document.getElementById('stop').onclick=function(){
  stopped=true; queue=[];
  for(const e of sites){ if(!state[e.site] && rows[e.site]){ rows[e.site].querySelector('.s').textContent='— отменено'; finished++; } }
  updateBar();
};
document.getElementById('retryfail').onclick=function(){
  stopped=false;
  for(const site in state){ if(state[site] && !state[site].good) retry(site); }
};

function updateBar(){ bar.textContent='${title} — готово '+finished+' / '+sites.length+' · в работе '+running+(stopped?' · остановлено':''); }
function row(domain){ const r=document.createElement('div'); r.className='row'; r.innerHTML='<div class="d">'+domain+'</div><div class="s">…</div>'; rowsEl.appendChild(r); return r; }
function showResult(r,good,text,site){
  const s=r.querySelector('.s'); s.textContent=text; r.classList.remove('ok','bad'); r.classList.add(good?'ok':'bad');
  s.onclick = good ? null : function(){ retry(site); };
  s.title = good ? '' : 'Повторить';
}
function finish(site,r,good,text){ showResult(r,good,text,site); state[site]={good:good,text:text}; saveState(); finished++; running--; updateBar(); }
function retry(site){
  const st=state[site]; if(!st||st.good) return;
  const r=rows[site]; delete state[site]; saveState(); finished--;
  r.classList.remove('bad'); const s=r.querySelector('.s'); s.textContent='…'; s.onclick=null; s.title='';
  queue.push(entries[site]); updateBar();
}
function runOne(e){
  running++; const r=rows[e.site]; updateBar();
  fetch(CFG.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(CFG.body(e))})
   .then(function(res){ return res.ok?res.json():res.text().then(function(t){ return Promise.reject(t); }); })
   .then(function(j){ finish(e.site, r, CFG.good(j), CFG.fmt(j)); })
   .catch(function(err){ finish(e.site, r, false, '✗ '+String(err).slice(0,90)); });
}

function tick(){
  if(stopped) return;
  if(running<CONC && queue.length){ runOne(queue.shift()); }
}
setInterval(tick, GAP);

function init(list){
  sites=list;
  for(const e of sites){
    const r=row(e.domain); rows[e.site]=r; entries[e.site]=e;
    const st=state[e.site];
    if(st){ showResult(r, st.good, st.text, e.site); finished++; }
    else { queue.push(e); }
  }
  updateBar(); tick();
}
fetch('/properties/sites-list').then(function(r){return r.json();}).then(function(j){ init(j.sites||[]); })
 .catch(function(e){ bar.textContent='Ошибка списка сайтов: '+e; });
</script></body></html>`;

  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
};
