(() => {
const $ = s => document.querySelector(s);
function el(tag, cls, text){ const e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; }
async function api(path, opt){
  const r = await fetch(path, { credentials:'same-origin', cache:'no-store', ...(opt||{}), headers:{'content-type':'application/json'} });
  if (r.status === 401) { location.href = '/login?next=/admin'; throw new Error('Signed out'); }
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(j.error || r.statusText); e.status = r.status; throw e; }
  return j;
}
const fmt = t => t ? new Date(t).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '–';
function ago(t){ if(!t) return '–'; const d=(Date.now()-t)/1000; if(d<60) return 'just now'; if(d<3600) return Math.round(d/60)+' min ago'; if(d<86400) return Math.round(d/3600)+' h ago'; return Math.round(d/86400)+' d ago'; }
const ACT = { login:'Signed in', logout:'Signed out', session:'Opened the app', view:'Opened view', search:'Searched', chain:'Opened chain',
  insight:'Opened insights', all_stocks:'Browsed all stocks', filter_save:'Saved a filter', filter_load:'Loaded a filter', filter_delete:'Deleted a filter',
  filter_default:'Set default filter', watch_add:'Watched a contract', watch_remove:'Stopped watching', settings_saved:'Saved settings', consent:'Accepted terms', data_export:'Downloaded own data' };
const act = t => ACT[t] || t;
const main = $('#main');
let ST = null, DATA = null, timer = null;

async function start(){
  try { ST = await api('/api/admin?a=status'); } catch (e) { main.replaceChildren(el('p','err','Could not load: '+e.message)); return; }
  $('#who').textContent = ST.email || '';
  if (!ST.admin) return noAccess();
  if (!ST.totpConfigured) return setup();
  if (!ST.verified) return codeGate();
  $('#lock').hidden = false;
  dashboard();
}

function gate(title, text){ const g=el('section','gate'); g.append(el('h2',null,title)); if(text) g.append(el('p',null,text)); main.replaceChildren(g); return g; }
function noAccess(){
  const g = gate('No access', `${ST.email} is not an admin of this site.`);
  const a = el('a','btn','Back to the app'); a.href='/'; g.append(a);
}

function codeInput(){ const i=el('input','code'); i.inputMode='numeric'; i.autocomplete='one-time-code'; i.maxLength=6; i.placeholder='000000'; i.setAttribute('aria-label','6-digit code');
  i.addEventListener('input',()=>{ i.value=i.value.replace(/\D/g,'').slice(0,6); }); return i; }

function codeGate(){
  const g = gate('Enter your code', 'Open Google Authenticator on your phone and enter the 6-digit code for Options Screener.');
  const i = codeInput(), err = el('div','err'), b = el('button','btn pri','Verify'); b.style.width='100%'; b.style.justifyContent='center';
  const go = async () => { if (i.value.length !== 6) { err.textContent='Enter all 6 digits.'; return; }
    b.disabled = true; err.textContent='';
    try { await api('/api/admin?a=verify',{method:'POST',body:JSON.stringify({code:i.value})}); start(); }
    catch(e){ err.textContent=e.message; i.value=''; i.focus(); } finally { b.disabled=false; } };
  i.addEventListener('input',()=>{ if(i.value.length===6) go(); }); b.onclick=go;
  g.append(i, err, b); i.focus();
}

async function setup(){
  const g = gate('Set up Google Authenticator', 'The admin portal asks for a code from your phone every 12 hours. Set it up once:');
  let s; try { s = await api('/api/admin?a=setup',{method:'POST',body:'{}'}); } catch(e){ g.append(el('p','err',e.message)); return; }
  const ol = el('ol');
  for (const [b,t] of [['Install Google Authenticator',' on your phone (App Store / Google Play).'],['Tap +, then “Scan a QR code”',' and scan the code below. Or choose “Enter a setup key” and type the key.'],['Enter the 6-digit code',' the app shows for Options Screener.']]){ const li=el('li'); li.append(el('b',null,b), t); ol.append(li); }
  const qr = el('div','qr'); const key = el('div','secret', s.secret.replace(/(.{4})/g,'$1 ').trim());
  const i = codeInput(), err = el('div','err'), b = el('button','btn pri','Confirm and finish'); b.style.width='100%'; b.style.justifyContent='center';
  g.append(ol, qr, key, i, err, b);
  try { new QRCode(qr, { text: s.uri, width: 184, height: 184, colorDark:'#000000', colorLight:'#ffffff', correctLevel: QRCode.CorrectLevel.M }); }
  catch { qr.replaceWith(el('p','m','The QR code could not be drawn here; use the setup key instead.')); }
  const go = async () => { if (i.value.length !== 6) { err.textContent='Enter all 6 digits.'; return; }
    b.disabled = true; err.textContent='';
    try { const r = await api('/api/admin?a=setup',{method:'POST',body:JSON.stringify({secret:s.secret,code:i.value})});
      if (r.stored) { start(); return; }
      // No database yet: the key goes into Vercel.
      const done = gate('One more step', 'The code works. Because the database is not connected yet, save the key in Vercel:');
      const ol2 = el('ol'); for (const t of ['Open Vercel → optionscreener → Settings → Environment Variables.', 'Add a variable named ADMIN_TOTP_SECRET with the setup key you scanned (without spaces).', 'Save and redeploy. Then open this page again and enter a code.']) ol2.append(el('li',null,t));
      done.append(ol2, el('div','secret', s.secret));
    } catch(e){ err.textContent=e.message; i.value=''; i.focus(); } finally { b.disabled=false; } };
  b.onclick=go; i.focus();
}

$('#lock').onclick = async () => { await api('/api/admin?a=verify',{method:'DELETE'}).catch(()=>{}); clearInterval(timer); $('#lock').hidden=true; start(); };

/* ---------- dashboard ---------- */
async function dashboard(){
  main.replaceChildren(el('p','m','Loading activity…'));
  await load(); clearInterval(timer); timer = setInterval(() => { if(!document.hidden) load(); }, 30000);
}
async function load(){
  try { DATA = await api('/api/admin?a=overview'); }
  catch(e){ if(e.status===403){ clearInterval(timer); start(); return; } main.replaceChildren(el('p','err','Could not load: '+e.message)); return; }
  render();
}
function render(){
  const D = DATA, now = Date.now(), day = 864e5;
  const frag = document.createDocumentFragment();
  if (!D.store) frag.append(el('div','warn','Activity is not being recorded yet: the database (Upstash Redis) is not connected. Connect it in Vercel → Storage, then redeploy.'));
  const users = D.users || [], ev = D.events || [];
  const stats = el('div','stats');
  const stat = (k,v,s) => { const d=el('div','stat'); d.append(el('div','k',k), el('div','v',String(v))); if(s) d.append(el('div','s',s)); stats.append(d); };
  stat('Users', users.length, 'signed in at least once');
  stat('Active today', users.filter(u=>u.last&&now-u.last<day).length, 'last 24 hours');
  stat('Active this week', users.filter(u=>u.last&&now-u.last<7*day).length, 'last 7 days');
  stat('Pro subscribers', users.filter(u=>u.plan==='Pro').length, 'active subscriptions');
  stat('Actions today', ev.filter(e=>now-e.t<day).length+(ev.length>=500?'+':''), 'from the latest 500');
  frag.append(stats);
  if (D.site) frag.append(el('p','note',`Who can sign in: ${D.site.access} · Market data: ${D.site.provider} · Refreshes every 30 s`));

  const grid = el('div','grid');
  // users
  const uBox = el('section'); const uh = el('div','sechead'); uh.append(el('h3',null,'Users'), el('span','sp'));
  const q = el('input'); q.placeholder='Search name or email'; q.style.width='220px'; uh.append(q);
  const uw = el('div','tw'); const ut = el('table'); ut.innerHTML='<thead><tr><th>User</th><th>Plan</th><th>Last active</th><th class="n">Sign-ins</th><th class="n">Actions</th><th class="n">Filters</th><th class="n">Watching</th><th>Last action</th><th>Country</th><th>First seen</th></tr></thead>';
  const ub = el('tbody'); ut.append(ub); uw.append(ut); uBox.append(uh, uw);
  const paintUsers = () => { const s=q.value.trim().toLowerCase(); ub.replaceChildren();
    const list = users.filter(u=>!s||u.email.includes(s)||(u.name||'').toLowerCase().includes(s));
    if(!list.length){ const tr=el('tr'), td=el('td','empty', D.store?'No users yet':'No data until the database is connected'); td.colSpan=10; tr.append(td); ub.append(tr); return; }
    for (const u of list){ const tr=el('tr','click'); tr.title='Show activity';
      const c=el('td','u'); c.append(el('b',null,u.name||u.email), el('span',null,u.name?u.email:'')); tr.append(c); tr.append(el('td',u.plan==='Pro'?'g':'m',u.plan||'Free'));
      const la=el('td',u.last&&now-u.last<15*60e3?'g':'',ago(u.last)); la.title=fmt(u.last); tr.append(la);
      for (const v of [u.logins,u.events,u.presets,u.tracked]) tr.append(el('td','n',String(v||0)));
      tr.append(el('td','m',act(u.lastType)), el('td','m',u.country||'–'), el('td','d',fmt(u.first)));
      tr.onclick=()=>openUser(u); ub.append(tr); } };
  q.addEventListener('input', paintUsers); paintUsers();
  // activity
  const aBox = el('section'); const ah = el('div','sechead'); ah.append(el('h3',null,'Latest activity'), el('span','sp'));
  const sel = el('select'); sel.append(new Option('All actions','')); for (const [k,v] of Object.entries(ACT)) sel.append(new Option(v,k)); ah.append(sel);
  const aw = el('div','tw'); const at = el('table'); at.innerHTML='<thead><tr><th>Time</th><th>User</th><th>Action</th><th>Detail</th></tr></thead>';
  const ab = el('tbody'); at.append(ab); aw.append(at); aBox.append(ah, aw);
  const nameOf = e => (users.find(u=>u.email===e)||{}).name || e;
  const paintEv = () => { ab.replaceChildren(); const list = ev.filter(e=>!sel.value||e.type===sel.value);
    if(!list.length){ const tr=el('tr'), td=el('td','empty','Nothing yet'); td.colSpan=4; tr.append(td); ab.append(tr); return; }
    for (const e of list){ const tr=el('tr','click'); const t=el('td','d',ago(e.t)); t.title=fmt(e.t);
      tr.append(t, el('td',null,nameOf(e.e)), el('td',null,act(e.type)), el('td','m',e.d||''));
      tr.onclick=()=>openUser(users.find(u=>u.email===e.e)||{email:e.e}); ab.append(tr); } };
  sel.onchange = paintEv; paintEv();
  grid.append(uBox, aBox); frag.append(grid);
  main.replaceChildren(frag);
}

/* ---------- one user ---------- */
const ov=$('#ov'), dr=$('#drawer');
function closeUser(){ dr.classList.remove('on'); ov.classList.remove('on'); }
ov.onclick=closeUser; $('#dClose').onclick=closeUser; document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeUser(); });
async function openUser(u){
  $('#dTitle').textContent = u.name || u.email; const body=$('#dBody'); body.replaceChildren(el('p','m','Loading…'));
  dr.classList.add('on'); ov.classList.add('on');
  let d; try { d = await api('/api/admin?a=overview&email='+encodeURIComponent(u.email)); } catch(e){ body.replaceChildren(el('p','err',e.message)); return; }
  const sec = t => { const s=el('div','sec'); s.append(el('h4',null,t)); body.append(s); return s; };
  body.replaceChildren();
  const s1 = sec(u.email); const kv=el('div','kv'); const pr=u.profile||{};
  if (pr.picture && /^https:\/\//.test(pr.picture)) { const im=el('img','pic'); im.src=pr.picture; im.alt=''; im.referrerPolicy='no-referrer'; im.onerror=()=>im.remove(); s1.append(im); }
  const loc=[pr.city,pr.region,u.country].filter(Boolean).join(', ');
  for (const [k,v] of [['Name',[pr.givenName,pr.familyName].filter(Boolean).join(' ')||u.name||'–'],['Plan',u.plan||'Free'],['First seen',fmt(u.first)],['Last sign-in',pr.lastLogin?fmt(Date.parse(pr.lastLogin)):'–'],['Last active',ago(u.last)],['Sign-ins',u.logins??'–'],['Actions',u.events??'–'],['Location',loc||'–'],['IP address',pr.ip||'–'],['Language',pr.locale||'–'],['Google account ID',pr.googleId||'–'],['Workspace domain',pr.domain||'–'],['Terms accepted',u.consent?`${u.consent.version} · ${u.consent.at?fmt(Date.parse(u.consent.at)):''}`:'Not yet'],['Saved filters',d.presets.length]]){ const x=el('div'); x.append(el('div','k',k), el('div','v',String(v))); kv.append(x); }
  s1.append(kv);
  if (pr.device) s1.append(el('p','m',pr.device));
  const s2 = sec('Stock watchlist'); s2.append(d.watch ? chips(d.watch.split(/[,\s]+/).filter(Boolean)) : el('p','m','Default list'));
  const s3 = sec('Saved filters'); s3.append(d.presets.length ? chips(d.presets.map(p=>p.name)) : el('p','m','None'));
  const s4 = sec('Watched contracts'); s4.append(d.tracked.length ? chips(d.tracked.map(t=>t.replace(/^O:/,''))) : el('p','m','None'));
  const s5 = sec('Activity'); const t=el('table'); t.innerHTML='<thead><tr><th>Time</th><th>Action</th><th>Detail</th></tr></thead>'; const tb=el('tbody');
  for (const e of d.events){ const tr=el('tr'); tr.append(el('td','d',fmt(e.t)), el('td',null,act(e.type)), el('td','m',e.d||'')); tb.append(tr); }
  if(!d.events.length){ const tr=el('tr'), td=el('td','empty','No activity recorded'); td.colSpan=3; tr.append(td); tb.append(tr); }
  t.append(tb); s5.append(t);
}
function chips(list){ const c=el('div','chips'); for (const x of list) c.append(el('span','tag',x)); return c; }

start();
})();
