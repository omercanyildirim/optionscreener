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
  filter_default:'Set default filter', watch_add:'Watched a contract', watch_remove:'Stopped watching', settings_saved:'Saved settings', consent:'Accepted terms', data_export:'Downloaded own data', payment:'Payment', marketing:'Email preference', comp:'Free Pro' };
const act = t => ACT[t] || t;
const main = $('#main');
let ST = null, DATA = null, PAY = null, TAB = 'users', timer = null;
const money = (v, cur='USD') => v==null ? '–' : new Intl.NumberFormat('en-US',{style:'currency',currency:cur||'USD'}).format(v);
const day1 = t => t ? new Date(t).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '–';

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
async function loadPay(){ try { PAY = await api('/api/admin?a=payments'); } catch(e){ if(e.status===403){ clearInterval(timer); start(); return; } PAY = { error: e.message }; } }
async function load(){
  if (TAB==='payments') await loadPay();
  try { DATA = await api('/api/admin?a=overview'); }
  catch(e){ if(e.status===403){ clearInterval(timer); start(); return; } main.replaceChildren(el('p','err','Could not load: '+e.message)); return; }
  render();
}
function tabs(){ const t=el('div','tabs'); t.setAttribute('role','tablist');
  for (const [k,label] of [['users','Users and activity'],['payments','Payments']]){ const b=el('button',TAB===k?'on':'',label); b.setAttribute('role','tab'); b.setAttribute('aria-selected',String(TAB===k));
    b.onclick=async()=>{ if(TAB===k) return; TAB=k; if(k==='payments'&&!PAY){ main.replaceChildren(tabs(), el('p','m','Loading payments from Paddle…')); await loadPay(); } render(); }; t.append(b); }
  return t; }
function render(){ if (TAB==='payments') return renderPay();
  const D = DATA, now = Date.now(), day = 864e5;
  const frag = document.createDocumentFragment(); frag.append(tabs());
  if (!D.store) frag.append(el('div','warn','Activity is not being recorded yet: the database (Upstash Redis) is not connected. Connect it in Vercel → Storage, then redeploy.'));
  const users = D.users || [], ev = D.events || [];
  const stats = el('div','stats');
  const stat = (k,v,s) => { const d=el('div','stat'); d.append(el('div','k',k), el('div','v',String(v))); if(s) d.append(el('div','s',s)); stats.append(d); };
  stat('Users', users.length, 'signed in at least once');
  stat('Active today', users.filter(u=>u.last&&now-u.last<day).length, 'last 24 hours');
  stat('Active this week', users.filter(u=>u.last&&now-u.last<7*day).length, 'last 7 days');
  stat('Pro subscribers', users.filter(u=>u.plan==='Pro').length, 'active subscriptions');
  stat('Email opt-ins', users.filter(u=>u.marketing).length, 'agreed to product emails');
  stat('Actions today', ev.filter(e=>now-e.t<day).length+(ev.length>=500?'+':''), 'from the latest 500');
  frag.append(stats);
  if (D.site) frag.append(el('p','note',`Who can sign in: ${D.site.access} · Market data: ${D.site.provider} · Refreshes every 30 s`));

  const grid = el('div','grid');
  // users
  const uBox = el('section'); const uh = el('div','sechead'); uh.append(el('h3',null,'Users'), el('span','sp'));
  const q = el('input'); q.placeholder='Search name or email'; q.style.width='220px';
  const csv = el('button','btn','Export email opt-ins'); csv.title='CSV of users who agreed to product emails, with when and how they agreed';
  csv.onclick=()=>{ const rows=[['email','name','opted_in_at','how']].concat(users.filter(u=>u.marketing).map(u=>[u.email,u.name||'',u.marketingAt||'',u.marketingHow||'']));
    const blob=new Blob([rows.map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join('\n')],{type:'text/csv'});
    const a=el('a'); a.href=URL.createObjectURL(blob); a.download='optionscreener-email-optins.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); };
  uh.append(q, csv);
  const uw = el('div','tw'); const ut = el('table'); ut.innerHTML='<thead><tr><th>User</th><th>Plan</th><th>Emails</th><th>Last active</th><th class="n">Sign-ins</th><th class="n">Actions</th><th class="n">Filters</th><th class="n">Watching</th><th>Last action</th><th>Country</th><th>First seen</th></tr></thead>';
  const ub = el('tbody'); ut.append(ub); uw.append(ut); uBox.append(uh, uw);
  const paintUsers = () => { const s=q.value.trim().toLowerCase(); ub.replaceChildren();
    const list = users.filter(u=>!s||u.email.includes(s)||(u.name||'').toLowerCase().includes(s));
    if(!list.length){ const tr=el('tr'), td=el('td','empty', D.store?'No users yet':'No data until the database is connected'); td.colSpan=11; tr.append(td); ub.append(tr); return; }
    for (const u of list){ const tr=el('tr','click'); tr.title='Show activity';
      const c=el('td','u'); c.append(el('b',null,u.name||u.email), el('span',null,u.name?u.email:'')); tr.append(c); tr.append(el('td',/^Pro/.test(u.plan)?'g':'m',u.plan||'Free')); tr.append(el('td',u.marketing?'g':'d',u.marketing?'Yes':'No'));
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

/* ---------- payments (live from Paddle) ---------- */
const PADDLE_UI='https://vendors.paddle.com';
const pLink=(path,label)=>{ const a=el('a','plink',label); a.href=PADDLE_UI+path; a.target='_blank'; a.rel='noopener'; a.title='Open in Paddle'; a.onclick=e=>e.stopPropagation(); return a; };
const TXS = { completed:'Paid', paid:'Paid', past_due:'Past due', canceled:'Canceled', billed:'Billed' };
const SUBS = { active:'Active', past_due:'Past due', canceled:'Canceled', paused:'Paused', trialing:'Trial' };
function userByEmail(e){ return ((DATA&&DATA.users)||[]).find(u=>u.email===e) || { email:e }; }
function renderPay(){
  const frag = document.createDocumentFragment(); frag.append(tabs()); const P = PAY || {};
  if (P.error){ frag.append(el('p','err','Could not load payments: '+P.error)); main.replaceChildren(frag); return; }
  if (!P.configured){ frag.append(el('div','warn','Payments cannot be shown: PADDLE_API_KEY is not set in Vercel.')); main.replaceChildren(frag); return; }
  if (P.env==='sandbox') frag.append(el('div','warn','Sandbox: these are test payments, not real money. Real payments appear here once the site switches to Paddle production.'));
  else { const lv=el('div','live'); lv.append(el('b',null,'Live'), document.createTextNode(' Real payments from your Paddle account. ')); const a=el('a',null,'Open Paddle dashboard'); a.href=PADDLE_UI; a.target='_blank'; a.rel='noopener'; lv.append(a); frag.append(lv); }
  const T = P.totals, stats = el('div','stats');
  const stat = (k,v,s) => { const d=el('div','stat'); d.append(el('div','k',k), el('div','v',String(v))); if(s) d.append(el('div','s',s)); stats.append(d); };
  stat('Monthly recurring revenue', money(T.mrr), `${T.active} active subscription${T.active===1?'':'s'}`);
  stat('Active subscribers', T.active, [T.canceling?`${T.canceling} canceling`:'', T.pastDue?`${T.pastDue} past due`:'', T.canceled?`${T.canceled} canceled`:''].filter(Boolean).join(', ')||'none canceling');
  stat('Revenue this month', money(T.monthRevenue), `${T.monthCount} payment${T.monthCount===1?'':'s'}, incl. ${money(T.monthTax)} tax`);
  stat('Net this month', money(T.monthEarnings), `after tax and ${money(T.monthFees)} Paddle fees`);
  stat('Expected next 30 days', money(T.next30||0), `${T.next30Count||0} renewal${T.next30Count===1?'':'s'}, ${money(T.next7||0)} in the next 7 days`);
  stat('All time', money(T.allRevenue), `${money(T.allEarnings)} net${T.refunded?`, ${money(T.refunded)} refunded`:''}`);
  frag.append(stats);
  // upcoming payments (renewals Paddle will charge)
  const uBox = el('section'); const uh = el('div','sechead'); uh.append(el('h3',null,'Upcoming payments'), el('span','sp'),
    el('span','m',(T.upcomingCount||0)+' scheduled'+(T.endingCount?` · ${T.endingCount} ending (${money(T.endingLost)}/mo less)`:'')));
  const uw = el('div','tw'); const ut = el('table'); ut.innerHTML='<thead><tr><th>Date</th><th>When</th><th>Customer</th><th class="n">Amount</th><th>Plan</th><th>Status</th></tr></thead>';
  const ub = el('tbody'); ut.append(ub); uw.append(ut); uBox.append(uh, uw);
  const inDays = a => { const d = Math.round((Date.parse(a) - Date.now()) / 864e5); return d < 0 ? 'overdue' : d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`; };
  const upRows = [...(P.upcoming||[]).map(x=>({...x, kind:x.retry?'retry':'renew'})), ...(P.ending||[]).map(x=>({...x, kind:'end'}))].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  if(!upRows.length){ const tr=el('tr'), td=el('td','empty','No upcoming payments yet. Renewals show here once someone subscribes.'); td.colSpan=6; tr.append(td); ub.append(tr); }
  for (const x of upRows){ const tr=el('tr','click'); tr.title='Show customer';
    const st = x.kind==='end' ? 'Ends, will not renew' : x.kind==='retry' ? 'Past due, Paddle retrying' : 'Will renew';
    tr.append(el('td','d',day1(x.at)), el('td','m',inDays(x.at)), el('td',null,x.email||x.customerId||'–'),
      el('td',x.kind==='end'?'n m':'n',x.kind==='end'?'–':money(x.amount,x.currency)), el('td','m',x.kind==='end'?'–':'Pro, '+(x.interval==='month'?'monthly':x.interval)), el('td',x.kind==='renew'?'g':'r',st));
    tr.onclick=()=>openUser(userByEmail(x.email)); ub.append(tr); }
  const un = el('p','note','Amounts are the plan price before any sales tax Paddle adds for the customer’s country.'); un.style.marginTop='10px';
  uBox.append(un); uBox.style.marginBottom='30px'; frag.append(uBox);
  frag.append(el('p','note','Live from Paddle · Paddle pays out the net amount monthly to your bank account · Refreshes every 30 s'));
  // payments
  const pBox = el('section'); const ph = el('div','sechead'); ph.append(el('h3',null,'Payments'), el('span','sp'));
  const q = el('input'); q.placeholder='Search email or invoice'; q.style.width='220px'; ph.append(q);
  const pw = el('div','tw'); const pt = el('table'); pt.innerHTML='<thead><tr><th>Date</th><th>Customer</th><th>Type</th><th class="n">Amount</th><th class="n">Tax</th><th class="n">Paddle fee</th><th class="n">Net</th><th>Method</th><th>Status</th><th>Invoice</th><th></th></tr></thead>';
  const pb = el('tbody'); pt.append(pb); pw.append(pt); pBox.append(ph, pw);
  const paint = () => { const f=q.value.trim().toLowerCase(); pb.replaceChildren();
    const list = P.transactions.filter(t=>!f||t.email.toLowerCase().includes(f)||(t.invoice||'').toLowerCase().includes(f));
    if(!list.length){ const tr=el('tr'), td=el('td','empty','No payments yet'); td.colSpan=11; tr.append(td); pb.append(tr); return; }
    for (const t of list){ const tr=el('tr','click'); tr.title='Show customer';
      const c=el('td','u'); c.append(el('b',null,t.name||t.email||'–'), el('span',null,t.name?t.email:''));
      const st = t.refunded ? `Refunded ${money(t.refunded,t.currency)}` : (TXS[t.status]||t.status);
      const inv = el('td'); if (t.invoice && ['paid','completed'].includes(t.status)) { const a=el('a',null,t.invoice); a.href='/api/admin?a=invoice&txn='+encodeURIComponent(t.id); a.target='_blank'; a.rel='noopener'; a.onclick=e=>e.stopPropagation(); inv.append(a); } else inv.textContent='–';
      tr.append(el('td','d',fmt(Date.parse(t.at))), c, el('td','m',t.origin==='subscription_recurring'?'Renewal':'New'), el('td','n',money(t.total,t.currency)), el('td','n m',money(t.tax,t.currency)),
        el('td','n m',money(t.fee,t.currency)), el('td','n g',money(t.earnings,t.currency)), el('td','m',t.method||'–'), el('td',t.refunded||t.status==='past_due'?'r':'g',st), inv, (()=>{ const d=el('td'); if(P.env!=='sandbox') d.append(pLink('/transactions-v2/'+encodeURIComponent(t.id),'Paddle')); return d; })());
      tr.onclick=()=>openUser(userByEmail(t.email)); pb.append(tr); } };
  q.addEventListener('input', paint); paint();
  // subscriptions
  const sBox = el('section'); const sh = el('div','sechead'); sh.append(el('h3',null,'Subscriptions'));
  const sw = el('div','tw'); const stb = el('table'); stb.innerHTML='<thead><tr><th>Customer</th><th>Status</th><th class="n">Price</th><th>Since</th><th>Next payment</th><th></th></tr></thead>';
  const sb = el('tbody'); stb.append(sb); sw.append(stb); sBox.append(sh, sw);
  if(!P.subscriptions.length){ const tr=el('tr'), td=el('td','empty','No subscriptions yet'); td.colSpan=6; tr.append(td); sb.append(tr); }
  for (const x of P.subscriptions){ const tr=el('tr','click');
    const st = x.cancelAt ? `Ends ${day1(x.cancelAt)}` : (SUBS[x.status]||x.status);
    tr.append(el('td',null,x.email||x.customerId), el('td',x.status==='active'&&!x.cancelAt?'g':x.status==='past_due'?'r':'m',st), el('td','n',`${money(x.amount,x.currency)}/${x.interval}`),
      el('td','d',day1(x.startedAt)), el('td','d',x.status==='active'&&!x.cancelAt?day1(x.nextBill):'–'), (()=>{ const d=el('td'); if(P.env!=='sandbox') d.append(pLink('/subscriptions-v2/'+encodeURIComponent(x.id),'Paddle')); return d; })());
    tr.onclick=()=>openUser(userByEmail(x.email)); sb.append(tr); }
  pBox.style.marginBottom='30px'; frag.append(pBox, sBox);
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
  // plan: subscription or free Pro given by the admin
  const sp = sec('Plan'); const sub = u.sub;
  if (sub && ['active','trialing','past_due'].includes(sub.status)) sp.append(el('p',null,`Paying subscriber (${sub.status})${sub.cancelAt?`, ends ${day1(sub.cancelAt)}`:sub.nextBill?`, next payment ${day1(sub.nextBill)}`:''}.`));
  else if (sub) sp.append(el('p','m',`Subscription ${sub.status}.`));
  const compBox = el('div','comp');
  const paintComp = c => { compBox.replaceChildren();
    if (c) { compBox.append(el('p','g',`Free Pro is on${c.until?` until ${day1(c.until)}`:' with no end date'}${c.note?` · ${c.note}`:''}.`));
      const off=el('button','btn','Remove free Pro'); off.onclick=()=>saveComp(false); compBox.append(off); }
    else { compBox.append(el('p','m','Give this user Pro without payment. Leave the end date empty for no end.'));
      const row=el('div','crow'); const until=el('input'); until.type='date'; until.min=new Date(Date.now()+864e5).toISOString().slice(0,10); until.setAttribute('aria-label','End date (optional)');
      const nt=el('input'); nt.placeholder='Note (optional), e.g. beta tester'; nt.maxLength=200;
      const on=el('button','btn pri','Give free Pro'); on.onclick=()=>saveComp(true, until.value?new Date(until.value+'T23:59:59Z').toISOString():null, nt.value); row.append(until, nt, on); compBox.append(row); }
    compBox.append(err); };
  const err = el('div','err');
  async function saveComp(on, until, note){ err.textContent='';
    try { const r = await api('/api/admin?a=comp',{method:'POST',body:JSON.stringify({email:u.email,on,until,note})}); u.comp=r.comp; u.plan=on?'Pro (free)':(u.sub&&['active','trialing','past_due'].includes(u.sub.status)?'Pro':'Free'); paintComp(r.comp); load(); }
    catch(e){ err.textContent=e.message; } }
  paintComp(u.comp); sp.append(compBox);
  // personal discount (Paddle discount code, single use, applied automatically at this user's checkout)
  const sd = sec('Discount'); const dBox = el('div','comp'); const dErr = el('div','err'); sd.append(dBox, dErr);
  const paintDisc = d => { dBox.replaceChildren();
    if (d) {
      const p1 = el('p','g'); p1.append(document.createTextNode(`${d.label}. Code `), el('b','code1',d.code), document.createTextNode(d.expiresAt?`, expires ${day1(d.expiresAt)} if unused.`:', no expiry.'));
      dBox.append(p1, el('p','m',`Applied automatically when this user opens checkout. Single use${d.note?` · ${d.note}`:''}.`));
      const row=el('div','crow'); const cp=el('button','btn','Copy code'); cp.onclick=async()=>{ try{ await navigator.clipboard.writeText(d.code); cp.textContent='Copied'; }catch(e){} };
      const rm=el('button','btn','Remove discount'); rm.onclick=()=>saveDisc({remove:true}); row.append(cp, rm); dBox.append(row); return; }
    dBox.append(el('p','m','Give this user a discount on Pro. It is applied automatically at their checkout and works only once.'));
    const row=el('div','crow');
    const type=el('select'); type.innerHTML='<option value="percentage">% off</option><option value="flat">$ off</option>'; type.setAttribute('aria-label','Discount type');
    const amt=el('input'); amt.type='number'; amt.min='1'; amt.max='100'; amt.step='1'; amt.value='20'; amt.style.width='80px'; amt.setAttribute('aria-label','Amount');
    type.onchange=()=>{ if(type.value==='flat'){ amt.max='9.98'; amt.step='0.5'; amt.min='0.5'; amt.value='5'; } else { amt.max='100'; amt.step='1'; amt.min='1'; amt.value='20'; } };
    const months=el('select'); months.innerHTML='<option value="0">First payment</option><option value="3">First 3 months</option><option value="6">First 6 months</option><option value="12">First 12 months</option><option value="">Every payment</option>'; months.setAttribute('aria-label','Applies to');
    const days=el('select'); days.innerHTML='<option value="7">Expires in 7 days</option><option value="30" selected>Expires in 30 days</option><option value="90">Expires in 90 days</option><option value="">No expiry</option>'; days.setAttribute('aria-label','Expiry');
    row.append(type, amt, months, days);
    const row2=el('div','crow'); const nt=el('input'); nt.placeholder='Note (optional), e.g. early user'; nt.maxLength=200;
    const go=el('button','btn pri','Create discount'); go.onclick=()=>{ go.disabled=true; saveDisc({type:type.value, amount:Number(amt.value), months:months.value===''?null:Number(months.value), days:days.value===''?null:Number(days.value), note:nt.value}).finally(()=>{go.disabled=false;}); };
    row2.append(nt, go); dBox.append(row, row2); };
  async function saveDisc(body){ dErr.textContent='';
    try { const r = await api('/api/admin?a=discount',{method:'POST',body:JSON.stringify({email:u.email, ...body})}); paintDisc(r.discount); }
    catch(e){ dErr.textContent=e.message; } }
  dBox.append(el('p','m','Loading…'));
  api('/api/admin?a=discount&email='+encodeURIComponent(u.email)).then(r=>paintDisc(r.discount)).catch(e=>{ dBox.replaceChildren(); dErr.textContent=e.message; });
  const sm = sec('Email updates'); sm.append(el('p',u.marketing?'g':'m', u.marketing?`Agreed to product emails on ${fmt(Date.parse(u.marketingAt))} (${u.marketingHow||'–'}).`:'Has not agreed to product emails. Payment and account emails are still sent.'));
  const spay = sec('Payments');
  const mine = PAY && PAY.transactions ? PAY.transactions.filter(t=>t.email===u.email) : null;
  if (!mine) { const b=el('button','btn','Load payments from Paddle'); b.onclick=async()=>{ b.disabled=true; await loadPay(); openUser(u); }; spay.append(b); }
  else if (!mine.length) spay.append(el('p','m','No payments'));
  else { const t=el('table'); t.innerHTML='<thead><tr><th>Date</th><th class="n">Amount</th><th>Status</th><th>Invoice</th></tr></thead>'; const tb=el('tbody');
    for (const x of mine){ const tr=el('tr'); const inv=el('td'); if(x.invoice){ const a=el('a',null,x.invoice); a.href='/api/admin?a=invoice&txn='+encodeURIComponent(x.id); a.target='_blank'; a.rel='noopener'; inv.append(a); } else inv.textContent='–';
      tr.append(el('td','d',fmt(Date.parse(x.at))), el('td','n',money(x.total,x.currency)), el('td',x.refunded?'r':'g',x.refunded?'Refunded':(TXS[x.status]||x.status)), inv); tb.append(tr); }
    t.append(tb); spay.append(t); }
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
