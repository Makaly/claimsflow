'use strict';

/**
 * Premium onboarding / control page served by the agent at http://127.0.0.1:PORT/.
 *
 * This is the "futuristic premium" surface from the hybrid plan: a thin native
 * installer puts the service on the machine, and the rich experience lives here
 * as a self-contained HTML page (no external requests, works offline). It polls
 * the agent's own endpoints to show live status, detected scanners, and a driver
 * center that fetches OFFICIAL vendor drivers.
 *
 * Drop a real AI-generated hero image at  assets/hero.webp  (served at
 * /assets/hero.webp) and it layers over the animated gradient automatically;
 * with no file present the page falls back to the pure-CSS aurora background.
 */

function renderWelcome({ version, port, claimsflowUrl }) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ClaimsFlow Scan Agent</title>
<style>
  :root{
    --bg:#05070f; --bg2:#0a1226; --card:rgba(255,255,255,.04); --stroke:rgba(255,255,255,.10);
    --txt:#e8eefc; --muted:#8ea3c8; --accent:#3b82f6; --accent2:#06b6d4; --good:#10b981;
    --warn:#f59e0b; --bad:#ef4444; --radius:18px; font-synthesis:none;
  }
  *{box-sizing:border-box} html,body{margin:0;height:100%}
  body{
    font:15px/1.55 "Segoe UI",system-ui,-apple-system,sans-serif;color:var(--txt);
    background:var(--bg);overflow-x:hidden;-webkit-font-smoothing:antialiased;
  }
  /* Animated aurora background (CSS fallback when no hero image present) */
  .aurora{position:fixed;inset:0;z-index:-2;background:
    radial-gradient(60% 50% at 15% 10%,rgba(59,130,246,.28),transparent 60%),
    radial-gradient(50% 45% at 85% 20%,rgba(6,182,212,.22),transparent 60%),
    radial-gradient(70% 60% at 50% 100%,rgba(99,102,241,.18),transparent 60%),
    linear-gradient(180deg,var(--bg),var(--bg2));
    animation:drift 22s ease-in-out infinite alternate}
  @keyframes drift{to{filter:hue-rotate(24deg)}}
  .grid{position:fixed;inset:0;z-index:-1;opacity:.5;
    background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),
                     linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);
    background-size:46px 46px;mask:radial-gradient(80% 70% at 50% 0,#000,transparent)}
  .hero-img{position:fixed;inset:0;z-index:-1;object-fit:cover;width:100%;height:100%;
    opacity:0;transition:opacity .8s;mix-blend-mode:screen}
  .hero-img.loaded{opacity:.45}

  .wrap{max-width:980px;margin:0 auto;padding:54px 24px 80px}
  header{display:flex;align-items:center;gap:16px;margin-bottom:8px}
  .logo{width:54px;height:54px;border-radius:15px;display:grid;place-items:center;font-weight:800;
    background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-size:20px;
    box-shadow:0 8px 30px rgba(59,130,246,.45),inset 0 1px 0 rgba(255,255,255,.4)}
  h1{font-size:30px;margin:0;letter-spacing:-.5px;font-weight:700}
  .sub{color:var(--muted);font-size:14px;margin-top:2px}
  .pill{margin-left:auto;display:inline-flex;align-items:center;gap:8px;padding:8px 14px;
    border-radius:999px;background:var(--card);border:1px solid var(--stroke);font-size:13px}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--muted);box-shadow:0 0 0 0 rgba(16,185,129,.6)}
  .dot.on{background:var(--good);animation:pulse 2s infinite}
  .dot.off{background:var(--bad)}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,.5)}70%{box-shadow:0 0 0 8px rgba(16,185,129,0)}}

  .lede{color:var(--muted);max-width:620px;margin:18px 0 30px;font-size:15.5px}

  .cards{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:760px){.cards{grid-template-columns:1fr}}
  .card{background:var(--card);border:1px solid var(--stroke);border-radius:var(--radius);
    padding:22px;backdrop-filter:blur(14px);position:relative;overflow:hidden}
  .card::before{content:"";position:absolute;inset:0 0 auto 0;height:1px;
    background:linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent)}
  .card h2{margin:0 0 4px;font-size:16px;display:flex;align-items:center;gap:9px}
  .card .hint{color:var(--muted);font-size:13px;margin-bottom:14px}
  .span2{grid-column:1/-1}

  .row{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--stroke)}
  .row:first-of-type{border-top:0}
  .row .name{font-weight:600}.row .meta{color:var(--muted);font-size:12.5px}
  .badge{font-size:11px;padding:3px 9px;border-radius:999px;border:1px solid var(--stroke);color:var(--muted)}
  .badge.ok{color:var(--good);border-color:rgba(16,185,129,.4)}
  .badge.driverless{color:var(--accent2);border-color:rgba(6,182,212,.4)}
  .spacer{flex:1}
  button{font:inherit;cursor:pointer;border:0;border-radius:11px;padding:9px 15px;font-weight:600;
    color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent2));transition:.15s;white-space:nowrap}
  button:hover{transform:translateY(-1px);box-shadow:0 6px 22px rgba(59,130,246,.4)}
  button.ghost{background:transparent;border:1px solid var(--stroke);color:var(--txt)}
  button:disabled{opacity:.5;cursor:default;transform:none;box-shadow:none}
  .cta{display:flex;gap:12px;margin-top:26px;flex-wrap:wrap}
  .cta button{padding:13px 22px;font-size:15px}
  .empty{color:var(--muted);font-size:13.5px;padding:8px 0}
  .feat{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
  .feat span{font-size:12px;color:var(--muted);background:rgba(255,255,255,.04);
    border:1px solid var(--stroke);padding:5px 11px;border-radius:999px}
  code{background:rgba(255,255,255,.06);padding:2px 7px;border-radius:6px;font-size:12.5px}
  .toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(120%);
    background:#0f1a33;border:1px solid var(--stroke);padding:13px 20px;border-radius:12px;
    transition:.3s;box-shadow:0 12px 40px rgba(0,0,0,.5);max-width:90vw}
  .toast.show{transform:translateX(-50%) translateY(0)}
  footer{margin-top:40px;color:var(--muted);font-size:12.5px;text-align:center}
  .spin{display:inline-block;width:13px;height:13px;border:2px solid rgba(255,255,255,.3);
    border-top-color:#fff;border-radius:50%;animation:sp .7s linear infinite;vertical-align:-2px}
  @keyframes sp{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="aurora"></div><div class="grid"></div>
<img class="hero-img" src="/assets/hero.webp" alt="" onload="this.classList.add('loaded')" onerror="this.remove()">

<div class="wrap">
  <header>
    <div class="logo">CF</div>
    <div>
      <h1>ClaimsFlow Scan Agent</h1>
      <div class="sub">CIC Insurance Group PLC · v${version}</div>
    </div>
    <span class="pill"><span class="dot" id="statusDot"></span><span id="statusText">connecting…</span></span>
  </header>

  <p class="lede">Your scanner is now connected to ClaimsFlow. This agent runs quietly as a Windows
  service and bridges any TWAIN, WIA, ISIS, eSCL or network scanner to the ClaimsFlow web app —
  entirely over <code>localhost</code>, never the internet.</p>

  <div class="cards">
    <div class="card">
      <h2>🖨️ Detected scanners</h2>
      <div class="hint">Live from the agent. Click Refresh after plugging in a device.</div>
      <div id="scanners"><div class="empty"><span class="spin"></span> scanning…</div></div>
      <div style="margin-top:14px"><button class="ghost" onclick="loadScanners()">Refresh</button></div>
    </div>

    <div class="card">
      <h2>🛡️ Active interfaces</h2>
      <div class="hint">Standard protocols the agent uses to reach your hardware.</div>
      <div id="drivers"><div class="empty"><span class="spin"></span> checking…</div></div>
    </div>

    <div class="card span2">
      <h2>⚙️ Driver center</h2>
      <div class="hint">We never bundle locked vendor drivers. Instead the agent detects your hardware
      and fetches the manufacturer's <b>official</b> driver — signed, straight from the vendor.</div>
      <div id="recommend"><div class="empty"><span class="spin"></span> analysing connected hardware…</div></div>
    </div>
  </div>

  <div class="cta">
    <button onclick="location.href='${claimsflowUrl}'">Open ClaimsFlow →</button>
    <button class="ghost" onclick="location.href='/diagnostics'">View diagnostics</button>
  </div>

  <footer>Listening on http://127.0.0.1:${port} · localhost only · © 2026 CIC Insurance Group PLC</footer>
</div>

<div class="toast" id="toast"></div>

<script>
const $=s=>document.querySelector(s);
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(t._);t._=setTimeout(()=>t.classList.remove('show'),3200);}
function esc(s){return (s??'').toString().replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

async function loadHealth(){
  try{
    const h=await (await fetch('/health')).json();
    $('#statusDot').className='dot on';$('#statusText').textContent='Agent online';
    const map=[['Native (WIA/SANE)',h.drivers.wia||h.drivers.sane],['TWAIN / ISIS (NAPS2)',h.drivers.naps2],['eSCL / AirScan',h.drivers.escl]];
    $('#drivers').innerHTML=map.map(([k,v])=>
      '<div class="row"><span class="name">'+k+'</span><span class="spacer"></span><span class="badge '+(v?'ok':'')+'">'+(v?'● ready':'○ not set up')+'</span></div>').join('');
  }catch(e){$('#statusDot').className='dot off';$('#statusText').textContent='Agent offline';}
}

async function loadScanners(){
  $('#scanners').innerHTML='<div class="empty"><span class="spin"></span> scanning…</div>';
  try{
    const d=await (await fetch('/scanners')).json();
    const list=d.devices||[];
    if(!list.length){$('#scanners').innerHTML='<div class="empty">No scanners found yet. Make sure the device is on and connected, then Refresh.</div>';return;}
    $('#scanners').innerHTML=list.map(s=>{
      const dl=/escl|airscan/i.test(s.driver||s.id||'');
      return '<div class="row"><div><div class="name">'+esc(s.name||s.model||s.id)+'</div>'+
        '<div class="meta">'+esc(s.vendor||'')+' · '+esc(s.driver||'')+'</div></div>'+
        '<span class="spacer"></span><span class="badge '+(dl?'driverless':'ok')+'">'+(dl?'driverless':'ready')+'</span></div>';
    }).join('');
  }catch(e){$('#scanners').innerHTML='<div class="empty">Could not reach the agent.</div>';}
}

async function loadRecommend(){
  try{
    const r=await (await fetch('/drivers/recommend')).json();
    if(r.error){$('#recommend').innerHTML='<div class="empty">'+esc(r.error)+'</div>';return;}
    const recs=r.recommendations||[];
    const wg=r.wingetAvailable?'':' <span class="badge">winget unavailable — links open vendor sites</span>';
    $('#recommend').innerHTML=recs.map(x=>{
      const matched=x.matchedDevices&&x.matchedDevices.length?' · detected: '+esc(x.matchedDevices.join(', ')):'';
      const btn=(x.method==='winget'&&r.wingetAvailable)
        ? '<button data-k="'+esc(x.key)+'" onclick="install(this)">Install</button>'
        : (x.url?'<button class="ghost" onclick="location.href=\\''+esc(x.url)+'\\'">Vendor site ↗</button>':'');
      const tag=x.redistributable?'<span class="badge ok">bundled-ok</span>':'<span class="badge">official only</span>';
      return '<div class="row"><div><div class="name">'+esc(x.label)+' '+tag+'</div>'+
        '<div class="meta">'+esc(x.note)+matched+'</div></div><span class="spacer"></span>'+btn+'</div>';
    }).join('')+(wg?'<div style="margin-top:10px">'+wg+'</div>':'');
  }catch(e){$('#recommend').innerHTML='<div class="empty">Driver center unavailable on this platform.</div>';}
}

async function install(btn){
  const key=btn.dataset.k;btn.disabled=true;const old=btn.textContent;btn.innerHTML='<span class="spin"></span> installing…';
  try{
    const res=await (await fetch('/drivers/install?key='+encodeURIComponent(key),{method:'POST'})).json();
    if(res.ok){toast('✓ Installed '+key+'. Click Refresh to see new devices.');btn.textContent='Installed ✓';}
    else if(res.url){toast('Opening vendor download…');location.href=res.url;btn.disabled=false;btn.textContent=old;}
    else{toast('Install failed: '+(res.error||res.message||'unknown'));btn.disabled=false;btn.textContent=old;}
  }catch(e){toast('Install request failed');btn.disabled=false;btn.textContent=old;}
}

loadHealth();loadScanners();loadRecommend();
setInterval(loadHealth,8000);
</script>
</body>
</html>`;
}

module.exports = { renderWelcome };
