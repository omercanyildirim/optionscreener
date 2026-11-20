(() => {
'use strict';
const $ = s => document.querySelector(s);
const el = (tag, cls, txt) => { const e=document.createElement(tag); if(cls) e.className=cls; if(txt!=null) e.textContent=txt; return e; };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let DEMO = location.protocol==='file:' || new URLSearchParams(location.search).has('demo');
const CFG = { maxDte:60, strikePct:15, maxContracts:3000, pollMs:2000, fullMs:60000, maxFlows:1500, provider:null, flowDte:60, flowPct:15 };
const ETFS = new Set(['SPY','QQQ','IWM','DIA','XLF','XLE','XLK','XLV','XLI','XLY','XLP','XLU','XLB','XLRE','SMH','SOXX','TLT','HYG','LQD','GLD','SLV','USO','UNG','EEM','EFA','FXI','KWEB','ARKK','VXX','UVXY','SQQQ','TQQQ','SPXL','SOXL','IBIT','GDX','XBI','KRE']);

/* ---------- preferences: local cache + per-user cloud copy ---------- */
function store(k,v){ try{ if(v===undefined) return localStorage.getItem(k); localStorage.setItem(k,v); }catch(e){ return null; } }
const FLOW0 = { sym:'', exclude:'', watchOnly:false, stockType:'all', spotMin:'', spotMax:'', earnings:'any',
  cp:'all', tSweep:true, tSplit:true, tBlock:true, tOther:true, minSize:'', minPrice:'', minPrem:'', maxPrem:'', side:'any', dir:'any',
  dteMin:'', dteMax:'', money:'any', otmMin:'', otmMax:'', volGtOi:false, volOiMin:'', oiMin:'', repeatMin:'', repeatPremMin:'' };
const SCR0 = { type:'all', dteMin:'', dteMax:'', dMin:'', dMax:'', oi:'', vol:'', spr:'', ivMin:'', ivMax:'', unusual:false };
const PDEF = { und:'SPY', watch:'SPY,QQQ,IWM,AAPL,MSFT,NVDA,TSLA,AMZN,META,AMD', sortKey:'vol', sortDir:-1, flowSort:'t', flowDir:-1,
  tracked:[], presets:[], defaultPreset:null, activePreset:null, flow:{...FLOW0}, scr:{...SCR0}, view:'flow', bigMin:'1000000' };
let P = Object.assign({}, PDEF);
try{ const s=JSON.parse(store('os.prefs2')||'{}'); P=Object.assign({},PDEF,s,{flow:{...FLOW0,...(s.flow||{})},scr:{...SCR0,...(s.scr||{})}}); }catch(e){}
if(!Array.isArray(P.tracked)) P.tracked=[]; if(!Array.isArray(P.presets)) P.presets=[];
const CLOUD = { configured:false, ready:false, saving:false, timer:null, err:null };
function saveP(cloudToo){ store('os.prefs2', JSON.stringify(P)); if(cloudToo) cloudSave(); }
function cloudPayload(){ return { presets:P.presets, tracked:P.tracked, watch:P.watch, defaultPreset:P.defaultPreset }; }
function cloudSave(){
  if(DEMO_LOCAL()) { paintSaveState(); return; }
  if(!CLOUD.configured||!CLOUD.ready) { paintSaveState(); return; }
  clearTimeout(CLOUD.timer); CLOUD.timer=setTimeout(async()=>{ CLOUD.saving=true; paintSaveState();
    try{ const r=await fetch('/api/userdata',{method:'PUT',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(cloudPayload())});
      const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||r.statusText); CLOUD.err=null; }
    catch(e){ CLOUD.err=e.message; }
    CLOUD.saving=false; paintSaveState(); },700); }
const DEMO_LOCAL = () => location.protocol==='file:';
async function cloudLoad(){
  if(DEMO_LOCAL()) return;
  try{ const r=await fetch('/api/userdata',{credentials:'same-origin',cache:'no-store'}); const j=await r.json();
    CLOUD.configured=!!j.configured;
    if(!CLOUD.configured){ paintSaveState(); return; }
    if(!r.ok) throw new Error(j.error||r.statusText);
    const d=j.data;
    if(d){ P.presets=d.presets||[]; P.tracked=d.tracked||[]; if(d.watch) P.watch=d.watch; P.defaultPreset=d.defaultPreset||null; saveP(false); CLOUD.ready=true; }
    else { CLOUD.ready=true; if(P.presets.length||P.tracked.length) cloudSave(); } // first use: upload what this browser has
  }catch(e){ CLOUD.err=e.message; }
  paintSaveState();
}
function paintSaveState(){
  const t = DEMO_LOCAL() ? 'Local preview: saved in this browser.'
    : !CLOUD.configured ? 'Database not connected yet: filters are saved in this browser for now.'
    : CLOUD.err ? 'Could not save: '+CLOUD.err
    : CLOUD.saving ? 'Saving…' : 'Filters are saved to your account and synced across devices.';
  $('#saveState').textContent=t; $('#saveState').style.color=CLOUD.err?'var(--red)':'';
}

/* ---------- state ---------- */
const S = { flowSeen:new Set(), prevTrade:new Map(), active:[], uni:null, uniMap:new Map(), und:P.und, uPrice:null, uChg:null, uChgPct:null, contracts:new Map(), selExp:null, dirty:new Set(),
  cellMap:new Map(), starMap:new Map(), chainRows:[], scrRows:new Map(), scrTop:[], lastScr:0, scrForce:true,
  stocks:new Map(), stRows:new Map(), stDirty:new Set(), trk:new Map(), trkU:new Map(), trkRows:new Map(), trkForce:true,
  flows:[], flowDirty:true, repeat:new Map(), newIds:new Set(), lastFlowRender:0, prevVol:new Map(), flowRot:0,
  upd:0, rate:0, lastUpd:null, timers:[], flowTimers:[], polling:false, loadingFull:false, charts:{}, lastCharts:0, lastItm:null, gen:0, delayed:null, fails:0 };

/* ---------- formatting ---------- */
const ok = v => v!=null && isFinite(v);
const f2 = v => ok(v) ? v.toFixed(2) : '–';
const f3 = v => ok(v) ? v.toFixed(3) : '–';
const f4 = v => ok(v) ? v.toFixed(4) : '–';
const fInt = v => ok(v) ? Math.round(v).toLocaleString('en-US') : '–';
const fPct = v => ok(v) ? v.toFixed(1)+'%' : '–';
const fSPct = v => ok(v) ? (v>0?'+':'')+v.toFixed(2)+'%' : '–';
const fIV = v => ok(v) ? (v*100).toFixed(1)+'%' : '–';
const fK = v => ok(v) ? (Number.isInteger(v)? String(v) : v.toFixed(2)) : '–';
const fMoney = v => !ok(v)?'–': v>=1e9?'$'+(v/1e9).toFixed(1)+'B': v>=1e6?'$'+(v/1e6).toFixed(1)+'M': v>=1e3?'$'+Math.round(v/1e3)+'K':'$'+Math.round(v);
const fExp = e => { const [y,m,d]=e.split('-'); return `${MONTHS[+m-1]} ${+d} '${y.slice(2)}`; };
const fExpN = e => { const [y,m,d]=e.split('-'); return `${+m}/${+d}/${y.slice(2)}`; };
const etDay = t => new Date(t).toLocaleDateString('en-US',{timeZone:'America/New_York',month:'numeric',day:'numeric'});
const fTime = t => (etDay(t)!==etDay(Date.now())?etDay(t)+' ':'')+new Date(t).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',second:'2-digit'});
const fDate = t => new Date(t).toLocaleDateString('en-US',{timeZone:'America/New_York'});
const iso = d => d.toISOString().slice(0,10);
const dteCache = new Map();
function dteOf(exp){ let v=dteCache.get(exp); if(v==null){ v=Math.max(0,Math.ceil((Date.parse(exp+'T21:00:00Z')-Date.now())/864e5)); dteCache.set(exp,v);} return v; }
const spreadOf = c => (c.bid>0&&c.ask>0) ? (c.ask-c.bid)/((c.ask+c.bid)/2)*100 : null;
const volOiOf = c => (c.oi>0&&c.vol!=null) ? c.vol/c.oi : null;
const uPriceOf = c => c.und===S.und ? S.uPrice : (S.trkU.get(c.und)||{}).price;
const otmOf = c => { const p=uPriceOf(c); return ok(p) ? (c.type==='C'?(c.strike-p):(p-c.strike))/p*100 : null; };
const labelOf = c => `${c.und} ${fExp(c.exp)} ${fK(c.strike)}${c.type}`;
const optTicker = (und,exp,type,k) => `O:${und}${exp.slice(2).replace(/-/g,'')}${type}${String(Math.round(k*1000)).padStart(8,'0')}`;
function parseTicker(t){ const m=/^O:([A-Z.]+?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(t||''); return m?{und:m[1],exp:`20${m[2]}-${m[3]}-${m[4]}`,type:m[5],strike:+m[6]/1000}:null; }
function setCell(td,v,fmt,flash){ const old=td._v; td._v=v; td.textContent=fmt(v);
  if(flash&&ok(old)&&ok(v)&&old!==v){ td.classList.remove('fu','fd'); void td.offsetWidth; td.classList.add(v>old?'fu':'fd'); } }
const num = v => v===''||v==null ? null : +v;
const symSet = s => new Set(String(s||'').toUpperCase().split(/[,\s]+/).filter(Boolean));

/* ---------- status ---------- */
function setStatus(st,text){ const m={demo:['Sample data','demo'],loading:['Loading',''],live:['Live','live'],delayed:['15-min delayed','delayed'],error:['Connection problem','err'],paused:['Paused','']};
  let [t,c]=m[st]||[st,'']; if(st==='delayed'&&CFG.provider==='alpaca'){ t='Free data feed'; }
  $('#status').textContent=text||t; $('#status').title=CFG.provider==='alpaca'&&(st==='delayed')?'Alpaca free plan: stock prices from IEX, option prices from the indicative feed (trades delayed about 15 min).':''; $('#dot').className='dot '+c; }
/* ---------- activity log (shown to admins; nothing is sent in sample mode) ---------- */
const TQ=[]; let tLast='';
function track(type,detail){ if(DEMO) return; const k=type+'|'+(detail||''); if(k===tLast) return; tLast=k; TQ.push({type,detail:String(detail||'').slice(0,120)}); if(TQ.length>=20) flushTrack(); }
function flushTrack(beacon){ if(!TQ.length) return; const body=JSON.stringify({events:TQ.splice(0,30)});
  if(beacon&&navigator.sendBeacon){ navigator.sendBeacon('/api/track',new Blob([body],{type:'application/json'})); return; }
  fetch('/api/track',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body,keepalive:true}).catch(()=>{}); }
setInterval(()=>flushTrack(),10000);
document.addEventListener('visibilitychange',()=>{ if(document.hidden) flushTrack(true); });
function note(msg,err){ const e=$('#msg'); e.textContent=msg||''; e.className=err?'err':''; }

/* ---------- server API (Massive key stays on the server) ---------- */
async function getJSON(u){
  // One quick retry on a dropped connection (Wi-Fi blip, laptop waking up, a deploy switching over).
  let r; for(let i=0;i<2&&!r;i++){ try{ r=await fetch(u,{credentials:'same-origin',cache:'no-store'}); }catch(e){ if(i) throw new Error('Could not reach the server'); await new Promise(z=>setTimeout(z,800)); } }
  if(r.status===401){ location.href='/login?next='+encodeURIComponent(location.pathname+location.search); throw new Error('Session expired'); }
  if(r.status===402){ let j={}; try{ j=await r.json(); }catch(e){} if(j.error==='free_limit'){ wallUp(j); throw new Error('Free plan limit reached'); } throw new Error(j.error||'Pro feature'); }
  if(!r.ok){ let m=r.statusText; try{ const j=await r.json(); m=j.message||j.error||m; }catch(e){} if(r.status===403) m+=' (your data plan may not include this)'; throw new Error(`${r.status}: ${m}`); }
  return r.json();
}
function massive(path,params){ const u=new URL('/api/massive',location.origin); u.searchParams.set('path',path);
  if(params) for(const [k,v] of Object.entries(params)) if(v!==''&&v!=null) u.searchParams.set(k,v);
  return getJSON(u).then(j=>{ const m=path.match(/^v3\/snapshot\/options\/([^/]+)$/); if(m) countFree(m[1]); return j; }); }
async function fetchChainFor(und,ref,exp,maxC,win){
  const now=new Date(), p={limit:250}, dte=win?win.dte:CFG.maxDte, pct=win?win.pct:CFG.strikePct;
  if(exp) p.expiration_date=exp; else { p['expiration_date.gte']=iso(now); p['expiration_date.lte']=iso(new Date(now.getTime()+dte*864e5)); }
  if(ok(ref)&&pct<100){ p['strike_price.gte']=(ref*(1-pct/100)).toFixed(2); p['strike_price.lte']=(ref*(1+pct/100)).toFixed(2); }
  let j=await massive(`v3/snapshot/options/${und}`,p); const out=[...(j.results||[])]; let n=1;
  while(j.next_url && out.length<(maxC||CFG.maxContracts) && n<60){ j=await getJSON(new URL(j.next_url,location.origin)); out.push(...(j.results||[])); n++; }
  return out;
}
const fetchChain = exp => fetchChainFor(S.und, S.uPrice, exp);
function ingestOption(r,map){
  const d=r.details||{}, t=d.ticker; if(!t) return null;
  let c=map.get(t); if(!c){ const pt=parseTicker(t)||{}; c={t,und:pt.und||S.und,type:d.contract_type==='put'?'P':'C',strike:d.strike_price,exp:d.expiration_date}; map.set(t,c); }
  const q=r.last_quote||{}, tr=r.last_trade||{}, g=r.greeks||{}, day=r.day||{};
  let ch=0; const set=(k,v)=>{ if(v!=null&&isFinite(v)&&c[k]!==v){ c[k]=v; ch++; } };
  set('bid',q.bid); set('ask',q.ask); set('bidSize',q.bid_size); set('askSize',q.ask_size); set('mid',q.midpoint ?? ((q.bid!=null&&q.ask!=null)?(q.bid+q.ask)/2:null)); set('last',tr.price ?? day.close);
  set('vol',day.volume); set('oi',r.open_interest); set('iv',r.implied_volatility);
  set('delta',g.delta); set('gamma',g.gamma); set('theta',g.theta); set('vega',g.vega);
  set('chgPct',day.change_percent); set('be',r.break_even_price);
  if(q.timeframe) S.delayed = q.timeframe!=='REAL-TIME';
  if(tr.sip_timestamp){ c.tradeT=tr.sip_timestamp/1e6; c.tradeSize=tr.size; c.cond=(tr.conditions||[])[0]||''; }
  if(map===S.contracts||map===S.trk){ const ot=Math.max(tsMs(q.sip_timestamp||q.last_updated)||0, c.tradeT||0); if(ot&&ot<=Date.now()+60e3&&ot>(S.optT||0)) S.optT=ot; }
  const ua=r.underlying_asset; if(ua&&ok(ua.price)){ c.spot=ua.price; if(c.und===S.und && !S.stocks.get(S.und)?.price) S.uPrice=ua.price; const u=S.trkU.get(c.und)||{}; u.price=ua.price; S.trkU.set(c.und,u); }
  if(ch){ S.upd+=ch; S.dirty.add(t); }
  return c;
}

/* ---------- stocks ---------- */
const watchList = () => [...new Set(P.watch.split(/[,\s]+/).map(s=>s.trim().toUpperCase()).filter(Boolean).concat([S.und]))];
function ingestStock(t){ const sym=t.ticker; if(!sym) return; let s=S.stocks.get(sym); if(!s){ s={sym}; S.stocks.set(sym,s); }
  const lt=t.lastTrade||{}, lq=t.lastQuote||{}, day=t.day||{}, pd=t.prevDay||{}, mn=t.min||{};
  const before=s.price, price=lt.p||mn.c||day.c||pd.c; if(ok(price)) s.price=price;
  const lts=tsMs(lt.t); if(lts&&lts<=Date.now()+60e3&&lts>(S.stockT||0)) S.stockT=lts;
  if(ok(pd.c)) s.prev=pd.c; if(ok(lq.p)) s.bid=lq.p; if(ok(lq.P)) s.ask=lq.P; if(ok(lq.s)) s.bidSize=lq.s; if(ok(lq.S)) s.askSize=lq.S; if(lq.t) s.quoteT=tsMs(lq.t);
  if(day.v>0) s.vol=day.v; if(day.h>0) s.high=day.h; if(day.l>0) s.low=day.l; if(day.vw>0) s.vwap=day.vw;
  if(before!==s.price) S.upd++; stockDerived(s); }
function stockDerived(s){ if(ok(s.price)&&ok(s.prev)){ s.chg=s.price-s.prev; s.chgPct=s.chg/s.prev*100; }
  if(s.sym===S.und && ok(s.price)){ S.uPrice=s.price; S.uChg=s.chg; S.uChgPct=s.chgPct; }
  const u=S.trkU.get(s.sym); if(u){ u.price=s.price; u.chgPct=s.chgPct; } S.stDirty.add(s.sym); }
async function fetchStocks(){ const syms=[...new Set(watchList().concat(trackedUnderlyings()))];
  const j=await massive('v2/snapshot/locale/us/markets/stocks/tickers',{tickers:syms.join(',')}); (j.tickers||[]).forEach(ingestStock); }

/* ---------- tracked contracts ---------- */
const trackedUnderlyings = () => [...new Set(P.tracked.map(t=>(parseTicker(t)||{}).und).filter(Boolean))];
const isTracked = t => P.tracked.includes(t);
function toggleTrack(t, contract){
  track(isTracked(t)?'watch_remove':'watch_add',String(t).replace(/^O:/,''));
  if(isTracked(t)) P.tracked=P.tracked.filter(x=>x!==t);
  else { if(P.tracked.length>=50){ note('You can watch at most 50 contracts.',true); return; } P.tracked.push(t); }
  saveP(true); for(const td of S.starMap.get(t)||[]) paintStar(td,t);
  const r=S.scrRows.get(t); if(r) paintStar(r.star,t);
  if(isTracked(t)){ const c=S.contracts.get(t)||contract; if(c) S.trk.set(t,c); } else S.trk.delete(t);
  S.trkForce=true; updTrkCount(); if(!DEMO) fetchTracked().catch(()=>{}); }
function paintStar(td,t){ const on=isTracked(t); td.textContent=on?'★':'☆'; td.classList.toggle('on',on); td.title=on?'Remove from watchlist':'Add to watchlist'; }
function starCell(t,contract){ const td=el('td','star'); paintStar(td,t); td.onclick=e=>{ e.stopPropagation(); toggleTrack(t,contract); }; return td; }
function updTrkCount(){ document.querySelector('[data-view=tracked] .tip').textContent=`My watchlist${P.tracked.length?' ('+P.tracked.length+')':''}`; }
async function fetchTracked(){ if(!P.tracked.length||DEMO) return;
  const j=await getJSON('/api/tracked?c='+encodeURIComponent(P.tracked.join(',')));
  (j.results||[]).forEach(r=>ingestOption(r,S.trk));
  if(j.errors&&j.errors.length) note(`Could not load ${j.errors.length} watched contract(s) (e.g. ${j.errors[0].ticker}: ${j.errors[0].error}).`,true); }

/* ============================================================
   OPTIONS FLOW
   ============================================================ */
const TYPE_KEY = {Sweep:'tSweep',Split:'tSplit',Block:'tBlock'};
const TYPE_CLS = {Sweep:'c-yellow',Split:'c-purple',Block:'c-blue','Multi-leg':'c-cyan'};
const SIDE_TXT = {AA:'Above ask',A:'Ask',M:'Mid',B:'Bid',BB:'Below bid'};
function flowKey(f){ return f.ticker; }
function addFlow(f,isNew){
  f.id=f.id||(Math.random().toString(36).slice(2)); f.prem=f.size*f.price*100; f.ticker=f.ticker||optTicker(f.sym,f.exp,f.cp,f.strike);
  f.dte=dteOf(f.exp); f.etf=ETFS.has(f.sym);
  f.otm = f.cp==='C' ? (f.strike-f.spot)/f.spot*100 : (f.spot-f.strike)/f.spot*100;
  f.bull = (f.cp==='C'&&(f.side==='A'||f.side==='AA')) || (f.cp==='P'&&(f.side==='B'||f.side==='BB'));
  f.bear = (f.cp==='P'&&(f.side==='A'||f.side==='AA')) || (f.cp==='C'&&(f.side==='B'||f.side==='BB'));
  S.flows.unshift(f); if(S.flows.length>CFG.maxFlows){ const old=S.flows.pop(); const r=S.repeat.get(flowKey(old)); if(r){ r.n--; r.prem-=old.prem; } }
  const r=S.repeat.get(flowKey(f))||{n:0,prem:0}; r.n++; r.prem+=f.prem; S.repeat.set(flowKey(f),r);
  if(isNew){ S.newIds.add(f.id); setTimeout(()=>S.newIds.delete(f.id),1800); }
  S.flowDirty=true; S.upd++;
}
function passFlow(f,F){
  if(F.sym){ const s=symSet(F.sym); if(s.size&&!s.has(f.sym)) return false; }
  if(F.exclude&&symSet(F.exclude).has(f.sym)) return false;
  if(F.watchOnly&&!watchList().includes(f.sym)) return false;
  if(F.stockType==='etf'&&!f.etf) return false; if(F.stockType==='stock'&&f.etf) return false;
  if(num(F.spotMin)!=null&&f.spot<num(F.spotMin)) return false; if(num(F.spotMax)!=null&&f.spot>num(F.spotMax)) return false;
  if(F.earnings!=='any'){ const e=f.earn;
    if(F.earnings==='before_exp'&&!(e!=null&&e<=f.dte)) return false;
    if(F.earnings==='within7'&&!(e!=null&&e<=7)) return false;
    if(F.earnings==='none'&&e!=null&&e<=f.dte) return false; }
  if(F.cp!=='all'&&f.cp!==F.cp) return false;
  if(!F[TYPE_KEY[f.type]||'tOther']) return false;
  if(num(F.minSize)!=null&&f.size<num(F.minSize)) return false;
  if(num(F.minPrice)!=null&&f.price<num(F.minPrice)) return false;
  if(num(F.minPrem)!=null&&f.prem<num(F.minPrem)) return false;
  if(num(F.maxPrem)!=null&&f.prem>num(F.maxPrem)) return false;
  const sd=f.side;
  if(F.side==='ask'&&!(sd==='A'||sd==='AA')) return false; if(F.side==='aboveAsk'&&sd!=='AA') return false;
  if(F.side==='bid'&&!(sd==='B'||sd==='BB')) return false; if(F.side==='belowBid'&&sd!=='BB') return false; if(F.side==='mid'&&sd!=='M') return false;
  if(F.dir==='bull'&&!f.bull) return false; if(F.dir==='bear'&&!f.bear) return false;
  if(num(F.dteMin)!=null&&f.dte<num(F.dteMin)) return false; if(num(F.dteMax)!=null&&f.dte>num(F.dteMax)) return false;
  if(F.money==='otm'&&!(f.otm>0)) return false; if(F.money==='itm'&&!(f.otm<0)) return false;
  if(num(F.otmMin)!=null&&f.otm<num(F.otmMin)) return false; if(num(F.otmMax)!=null&&f.otm>num(F.otmMax)) return false;
  if(F.volGtOi&&!(f.vol>f.oi)) return false;
  if(num(F.volOiMin)!=null&&!(f.oi>0&&f.vol/f.oi>=num(F.volOiMin))) return false;
  if(num(F.oiMin)!=null&&!((f.oi||0)>=num(F.oiMin))) return false;
  const rep=S.repeat.get(flowKey(f))||{n:1,prem:f.prem};
  if(num(F.repeatMin)!=null&&rep.n<num(F.repeatMin)) return false;
  if(num(F.repeatPremMin)!=null&&rep.prem<num(F.repeatPremMin)) return false;
  return true;
}
const FCOLS=[
  {k:'t',h:'Time (ET)',v:f=>f.t,r:f=>fTime(f.t),cls:()=> 't-dim'},
  {k:'sym',h:'Ticker',v:f=>f.sym,r:f=>f.sym,cls:f=>f.cp==='C'?'c-green':'c-red'},
  {k:'exp',h:'Expiry',v:f=>f.exp,r:f=>fExpN(f.exp)},
  {k:'strike',h:'Strike',v:f=>f.strike,r:f=>fK(f.strike),n:1},
  {k:'cp',h:'C / P',v:f=>f.cp,r:f=>f.cp==='C'?'Call':'Put'},
  {k:'spot',h:'Spot',v:f=>f.spot,r:f=>f2(f.spot),n:1},
  {k:'size',h:'Size',v:f=>f.size,r:f=>fInt(f.size),n:1,cls:f=>f.size>f.oi?'c-cyan':''},
  {k:'price',h:'Price',v:f=>f.price,r:f=>'$'+f2(f.price),n:1},
  {k:'side',h:'Side',v:f=>f.side,r:f=>SIDE_TXT[f.side]||'–',cls:f=>f.side==='AA'||f.side==='A'?'c-green':f.side==='M'?'c-muted':'c-red'},
  {k:'prem',h:'Premium',v:f=>f.prem,r:f=>fMoney(f.prem),n:1,cls:f=>f.cp==='C'?'c-green':'c-red'},
  {k:'type',h:'Type',v:f=>f.type,r:f=>f.type,cls:f=>TYPE_CLS[f.type]||'c-muted'},
  {k:'vol',h:'Volume',v:f=>f.vol,r:f=>fInt(f.vol),n:1},
  {k:'oi',h:'OI',v:f=>f.oi,r:f=>fInt(f.oi),n:1},
  {k:'rep',h:'Repeat',v:f=>(S.repeat.get(flowKey(f))||{}).n||1,r:f=>{ const n=(S.repeat.get(flowKey(f))||{}).n||1; return n>1?'×'+n:''; },n:1,cls:()=> 'c-muted'}];
function buildFlowHead(){ const tr=el('tr');
  for(const c of FCOLS){ const th=el('th',c.n?'num':'',c.h+(P.flowSort===c.k?(P.flowDir>0?' ▲':' ▼'):'')); if(P.flowSort===c.k) th.classList.add('on');
    th.onclick=()=>{ if(P.flowSort===c.k) P.flowDir*=-1; else { P.flowSort=c.k; P.flowDir=-1; } saveP(); buildFlowHead(); S.flowDirty=true; }; tr.appendChild(th); }
  tr.appendChild(el('th')); $('#flowHead').replaceChildren(tr); }
let FILTERED=[];
function renderFlow(){
  const F=P.flow; FILTERED=isPro()?S.flows.filter(f=>passFlow(f,F)):teaserFlows();
  const col=FCOLS.find(c=>c.k===P.flowSort)||FCOLS[0], dir=P.flowDir;
  const list = col.k==='t'&&dir<0 ? FILTERED : [...FILTERED].sort((a,b)=>{ const x=col.v(a),y=col.v(b); return (typeof x==='string'?x.localeCompare(y):x-y)*dir; });
  const tb=$('#flowBody'), frag=document.createDocumentFragment(), max=400;
  for(const f of list.slice(0,max)){
    const tr=el('tr'); if(f.prem>=1e6) tr.className='hot'; else if(f.type==='Sweep'&&f.side==='AA') tr.className='gold';
    if(S.newIds.has(f.id)) tr.classList.add('new');
    for(const c of FCOLS){ const td=el('td',(c.n?'num ':'')+(c.cls?c.cls(f):''),c.r(f)); tr.appendChild(td); }
    const mt=el('td','num'); const mb=el('button','more','⋯'); mb.title='Actions'; mb.onclick=e=>{ e.stopPropagation(); flowMenu(e,f); }; mt.appendChild(mb); tr.appendChild(mt);
    tr.style.cursor='pointer'; tr.onclick=()=>openInsight({kind:'contract',t:f.ticker,f}); tr.children[1].classList.add('clickable'); tr.children[1].onclick=e=>{ e.stopPropagation(); openInsight({kind:'stock',sym:f.sym}); };
    frag.appendChild(tr); }
  if(!list.length){ const tr=el('tr'); const td=el('td','empty',S.flows.length?'No trades match your filters':'Loading flow…'); td.colSpan=FCOLS.length+1; tr.appendChild(td); frag.appendChild(tr); }
  tb.replaceChildren(frag);
  renderFlowStats(); renderFeed(); S.flowDirty=false;
}
function split(a,b){ const t=(a||0)+(b||0); if(!t) return '<div class="split"></div>';
  return `<div class="split"><i style="flex-grow:${a/t};background:var(--call)"></i><i style="flex-grow:${b/t};background:var(--put)"></i></div>`; }
function renderFlowStats(){
  let cP=0,pP=0,cN=0,pN=0,bull=0,bear=0;
  for(const f of FILTERED){ if(f.cp==='C'){cP+=f.prem;cN++;} else {pP+=f.prem;pN++;} if(f.bull) bull+=f.prem; if(f.bear) bear+=f.prem; }
  const tot=cP+pP, dirTot=bull+bear, score=dirTot?(bull-bear)/dirTot:0;
  const sent=score>.1?'Upside-leaning':score<-.1?'Downside-leaning':'Balanced', scol=score>.1?'var(--call)':score<-.1?'var(--put)':'var(--text)';
  const pc=cP?pP/cP:null;
  $('#stats').innerHTML=
    `<div class="card"><div class="k">Flow balance</div><div class="v" style="color:${scol}">${sent}</div><div class="meter"><b style="left:${((score+1)/2*100).toFixed(1)}%"></b></div><div class="s">${fMoney(bull)} upside, ${fMoney(bear)} downside</div></div>`+
    `<div class="card"><div class="k">Put/call premium ratio</div><div class="v">${pc!=null?pc.toFixed(2):'–'}</div>${split(cP,pP)}<div class="s">${fInt(cN)} calls, ${fInt(pN)} puts</div></div>`+
    `<div class="card"><div class="k">Call premium</div><div class="v c-green">${fMoney(cP)}</div>${split(cP,0)}<div class="s">${tot?Math.round(cP/tot*100):0}% of total, ${fInt(cN)} trades</div></div>`+
    `<div class="card"><div class="k">Put premium</div><div class="v c-red">${fMoney(pP)}</div>${split(0,pP)}<div class="s">${tot?Math.round(pP/tot*100):0}% of total, ${fInt(pN)} trades</div></div>`;
}
function renderFeed(){
  const min=+P.bigMin||1e6, list=FILTERED.filter(f=>f.prem>=min).slice(0,40), box=$('#feedList');
  if(!list.length){ box.innerHTML=`<div class="fcard none">No trades above ${fMoney(min)} yet</div>`; return; }
  box.replaceChildren(...list.map(f=>{ const c=el('div','fcard');
    c.innerHTML=`<div class="l1"><span class="sym ${f.cp==='C'?'c-green':'c-red'}">${f.sym}</span><span class="ct">${fK(f.strike)}${f.cp} ${fExpN(f.exp)}</span><span class="pr">${fMoney(f.prem)}</span></div>
    <div class="l2"><span class="tp ${TYPE_CLS[f.type]||''}">${f.type}</span><span>${fInt(f.size)}×</span><span style="margin-left:auto">${fTime(f.t)}</span></div>`;
    c.onclick=()=>openInsight({kind:'contract',t:f.ticker,f}); return c; })); }
let menuEl=null;
function closeMenu(){ if(menuEl){ menuEl.remove(); menuEl=null; } }
function flowMenu(e,f){ closeMenu(); menuEl=el('div','menu');
  const add=(t,fn)=>{ const b=el('button',null,t); b.onclick=()=>{ closeMenu(); fn(); }; menuEl.appendChild(b); };
  add(`Open ${f.sym} chain`,()=>openInChain(f.sym,f.exp));
  add(isTracked(f.ticker)?'Remove from watchlist':'Watch this contract',()=>toggleTrack(f.ticker,{t:f.ticker,und:f.sym,type:f.cp,strike:f.strike,exp:f.exp,last:f.price,vol:f.vol,oi:f.oi}));
  add(`Show only ${f.sym}`,()=>{ P.flow.sym=f.sym; flowChanged(); });
  add(`Hide ${f.sym}`,()=>{ P.flow.exclude=[...symSet(P.flow.exclude),f.sym].join(','); flowChanged(); });
  add(`This contract: ${fK(f.strike)}${f.cp} ${fExpN(f.exp)} (${(S.repeat.get(flowKey(f))||{n:1}).n} trades)`,()=>{ P.flow.sym=f.sym; P.flow.cp=f.cp; flowChanged(); });
  document.body.appendChild(menuEl);
  const r=e.target.getBoundingClientRect(); menuEl.style.top=Math.min(innerHeight-menuEl.offsetHeight-8,r.bottom+4)+'px'; menuEl.style.left=Math.max(8,r.right-menuEl.offsetWidth)+'px'; }
document.addEventListener('click',e=>{ if(menuEl&&!menuEl.contains(e.target)) closeMenu(); });
function openInChain(sym,exp){ S.pendingExp=exp; view('chain'); if(sym!==S.und) load(sym); else { S.selExp=exp; buildExpSel(); buildChain(true); } }

/* ---------- live flow ----------
   Alpaca: each contract's latest trade (size, price, exchange condition) from chain snapshots, scanned
   across your watchlist plus the most active stocks. Sweeps come from OPRA's intermarket-sweep conditions.
   Other providers: approximated from volume changes between snapshots. */
const SWEEP_C=new Set(['S','b','d']), MULTI_C=new Set('fghijklmnopqrst'.split('')), CANCEL_C=new Set(['A','C','E','G']);
async function refreshActive(){ if(CFG.provider!=='alpaca'||DEMO) return; try{ const j=await getJSON('/api/universe?active=20'); S.active=j.symbols||[]; }catch(e){} }
const flowSyms = () => [...new Set(watchList().concat(S.active||[]))];
function sideOf(price,c){ if(ok(c.ask)&&price>c.ask) return 'AA'; if(ok(c.ask)&&price>=c.ask) return 'A'; if(ok(c.bid)&&price<c.bid) return 'BB'; if(ok(c.bid)&&price<=c.bid) return 'B'; return 'M'; }
async function liveFlowTick(){
  if(DEMO||document.hidden||S.flowBusy||!isPro()) return; const syms=flowSyms(); if(!syms.length) return;
  const sym=syms[S.flowRot++%syms.length]; const st=S.stocks.get(sym)||{};
  S.flowBusy=true; let res; try{ res=await fetchChainFor(sym, st.price, null, 1500, {dte:CFG.flowDte,pct:CFG.flowPct}); }catch(e){ return; } finally{ S.flowBusy=false; }
  const now=Date.now(), tmp=new Map(), first=!S.flowSeen.has(sym); S.flowSeen.add(sym);
  for(const r of res){ const c=ingestOption(r,tmp); if(!c) continue;
    if(CFG.provider==='alpaca'){
      if(!c.tradeT||!ok(c.last)||!(c.tradeSize>0)) continue;
      const prevT=S.prevTrade.get(c.t); S.prevTrade.set(c.t,c.tradeT);
      if(prevT!=null&&c.tradeT<=prevT) continue;
      if(CANCEL_C.has(c.cond)) continue;
      const size=c.tradeSize, price=c.last, prem=size*price*100;
      S.newestTrade=Math.max(S.newestTrade||0,c.tradeT);
      if(first&&(now-c.tradeT>30*3600e3||prem<25000)) continue; // first scan: larger prints from the last session
      const type=SWEEP_C.has(c.cond)?'Sweep':MULTI_C.has(c.cond)?'Multi-leg':(size>=500||prem>=250000)?'Block':'Other';
      addFlow({t:c.tradeT,sym,exp:c.exp,strike:c.strike,cp:c.type,spot:c.spot||st.price||0,size,price,side:sideOf(price,c),type,vol:c.vol||0,oi:c.oi||0,earn:null,ticker:c.t},!first);
      continue; }
    if(!ok(c.vol)) continue; const prev=S.prevVol.get(c.t); S.prevVol.set(c.t,c.vol);
    if(prev==null||c.vol<=prev) continue; const size=c.vol-prev, price=c.last||c.mid; if(!ok(price)||price<=0) continue;
    const prem=size*price*100;
    addFlow({t:now,sym,exp:c.exp,strike:c.strike,cp:c.type,spot:c.spot||st.price||0,size,price,side:sideOf(price,c),type:(size>=500||prem>=250000)?'Block':'Other',vol:c.vol,oi:c.oi||0,earn:null,ticker:c.t},true); }
  if(first) S.flows.sort((x,y)=>y.t-x.t);
  if(CFG.provider==='alpaca'&&S.newestTrade&&etDay(S.newestTrade)!==etDay(now)&&cur==='flow')
    note(`Alpaca's free options feed has not sent today's trades yet. Showing the latest available prints (${etDay(S.newestTrade)}).`);
}

/* ============================================================
   FILTER DRAWER + PRESETS
   ============================================================ */
const FSECTIONS=[
  {t:'Stock',f:[
    {k:'sym',l:'Tickers',type:'text',ph:'e.g. SPY, NVDA'},
    {k:'exclude',l:'Exclude',type:'text',ph:'e.g. TSLA'},
    {k:'watchOnly',l:'Only my watchlist',type:'bool'},
    {k:'stockType',l:'Type',type:'select',o:[['all','All'],['stock','Stock'],['etf','ETF']]},
    {k:'spot',l:'Spot price ($)',type:'range',a:'spotMin',b:'spotMax'}]},
  {t:'Events',f:[
    {k:'earnings',l:'Earnings',type:'select',o:[['any','Any'],['before_exp','Earnings before expiry'],['within7','Earnings within 7 days'],['none','No earnings before expiry']]},
    {k:'note',type:'note',txt:'Earnings dates are available in sample data; live availability depends on your Massive plan.'}]},
  {t:'Trade',f:[
    {k:'cp',l:'Option type',type:'select',o:[['all','Call + Put'],['C','Call'],['P','Put']]},
    {k:'types',l:'Trade type',type:'checks',o:[['tSweep','Sweep'],['tSplit','Split'],['tBlock','Block'],['tOther','Other / multi-leg']]},
    {k:'side',l:'Execution side',type:'select',o:[['any','Any'],['ask','At or above ask'],['aboveAsk','Above ask'],['mid','Mid'],['bid','At or below bid'],['belowBid','Below bid']]},
    {k:'dir',l:'Direction',type:'select',o:[['any','Any'],['bull','Upside-leaning (calls bought / puts sold)'],['bear','Downside-leaning (puts bought / calls sold)']]},
    {k:'minSize',l:'Min size',type:'num'},
    {k:'minPrice',l:'Min price ($)',type:'num',step:'0.05'},
    {k:'prem',l:'Premium ($)',type:'range',a:'minPrem',b:'maxPrem'}]},
  {t:'Contract',f:[
    {k:'dte',l:'Days to expiry',type:'range',a:'dteMin',b:'dteMax'},
    {k:'money',l:'Moneyness',type:'select',o:[['any','Any'],['otm','OTM (out of the money)'],['itm','ITM (in the money)']]},
    {k:'otm',l:'OTM %',type:'range',a:'otmMin',b:'otmMax'}]},
  {t:'Volume & open interest',f:[
    {k:'volGtOi',l:'Volume > OI',type:'bool'},
    {k:'volOiMin',l:'Min volume / OI',type:'num',step:'0.1'},
    {k:'oiMin',l:'Min OI',type:'num'}]},
  {t:'Repeat trades (today)',f:[
    {k:'repeatMin',l:'Min repeat count',type:'num'},
    {k:'repeatPremMin',l:'Total premium ≥ ($)',type:'num'},
    {k:'note2',type:'note',txt:'Adds up all of today\'s trades in the same contract.'}]}];
function buildDrawer(){
  const body=$('#dbody'); body.innerHTML='';
  for(const sec of FSECTIONS){ const box=el('div','fsec'); box.appendChild(el('h4',null,sec.t));
    for(const f of sec.f){
      if(f.type==='note'){ box.appendChild(el('div','c-muted',f.txt)).style.fontSize='12px'; continue; }
      const row=el('div','frow'); row.appendChild(el('span',null,f.l)); let ctl;
      if(f.type==='text'||f.type==='num'){ ctl=el('input'); ctl.type=f.type==='num'?'number':'text'; if(f.step) ctl.step=f.step; if(f.ph) ctl.placeholder=f.ph; ctl.dataset.k=f.k; }
      else if(f.type==='bool'){ ctl=el('input'); ctl.type='checkbox'; ctl.dataset.k=f.k; }
      else if(f.type==='select'){ ctl=el('select'); for(const [v,t] of f.o){ const o=el('option',null,t); o.value=v; ctl.appendChild(o); } ctl.dataset.k=f.k; }
      else if(f.type==='range'){ ctl=el('div','pair'); for(const [k,ph] of [[f.a,'min'],[f.b,'max']]){ const i=el('input'); i.type='number'; i.placeholder=ph; i.dataset.k=k; ctl.appendChild(i); } }
      else if(f.type==='checks'){ ctl=el('div','checks'); for(const [k,t] of f.o){ const lb=el('label'); const i=el('input'); i.type='checkbox'; i.dataset.k=k; lb.append(i,t); ctl.appendChild(lb); } }
      row.appendChild(ctl); box.appendChild(row); }
    body.appendChild(box); }
  body.querySelectorAll('[data-k]').forEach(i=>i.addEventListener('input',()=>{ P.flow[i.dataset.k]= i.type==='checkbox'?i.checked:i.value; flowChanged(true); }));
}
function fillDrawer(){ $('#dbody').querySelectorAll('[data-k]').forEach(i=>{ const v=P.flow[i.dataset.k]; if(i.type==='checkbox') i.checked=!!v; else i.value=v??''; }); }
function activeCount(F){ let n=0; for(const k in FLOW0){ if(JSON.stringify(F[k])!==JSON.stringify(FLOW0[k])) n++; } return n; }
function flowChanged(fromDrawer){ saveP(); S.flowDirty=true; if(!fromDrawer) fillDrawer(); const n=activeCount(P.flow);
  $('#fcount').hidden=!n; $('#fcount').textContent=n; $('#dcount').textContent=n?`${n} active filter${n>1?'s':''}`:'No filters'; paintPresetDirty(); }
function openDrawer(){ fillDrawer(); renderPresetSel(); $('#drawer').classList.add('on'); $('#overlay').classList.add('on'); }
function closeDrawer(){ $('#drawer').classList.remove('on'); $('#overlay').classList.remove('on'); }
$('#openFilters').onclick=openDrawer; $('#dClose').onclick=closeDrawer; $('#overlay').onclick=()=>{ closeDrawer(); closeInsight(); };
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ closeDrawer(); closeInsight(); } });
$('#dReset').onclick=()=>{ P.flow={...FLOW0}; P.activePreset=null; flowChanged(); renderPresetSel(); };
$('#clearAll').onclick=()=>{ P.flow={...FLOW0}; P.scr={...SCR0}; P.activePreset=null; fillScr(); flowChanged(); renderPresetSel(); S.scrForce=true; };

const newId = () => 'p'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
function currentPreset(){ return P.presets.find(p=>p.id===P.activePreset)||null; }
function renderPresetSel(){
  for(const sel of [$('#presetSel'),$('#quickPreset')]){ sel.innerHTML='';
    const o0=el('option',null,sel.id==='quickPreset'?'Saved filters':'— Choose a saved filter —'); o0.value=''; sel.appendChild(o0);
    for(const p of P.presets){ const o=el('option',null,p.name+(p.id===P.defaultPreset?' ★':'')); o.value=p.id; sel.appendChild(o); }
    sel.value=P.activePreset||''; }
  const has=!!currentPreset(); for(const id of ['pSave','pDelete','pDefault']) $('#'+id).disabled=!has;
  $('#pDefault').textContent = has&&P.defaultPreset===P.activePreset ? 'Remove default' : 'Set as default';
  paintPresetDirty(); paintSaveState(); }
function paintPresetDirty(){ const p=currentPreset(); const dirty=p&&(JSON.stringify({...FLOW0,...p.flow})!==JSON.stringify(P.flow)||JSON.stringify({...SCR0,...p.screener})!==JSON.stringify(P.scr));
  $('#pSave').textContent=dirty?'Save changes •':'Save changes'; }
function applyPreset(id){ const p=P.presets.find(x=>x.id===id); if(!p) return; track('filter_load',p.name);
  P.flow={...FLOW0,...p.flow}; P.scr={...SCR0,...p.screener}; P.activePreset=id; fillScr(); flowChanged(); S.scrForce=true; renderPresetSel(); note(`Applied "${p.name}".`); }
$('#pLoad').onclick=()=>{ const id=$('#presetSel').value; if(id) applyPreset(id); };
$('#presetSel').onchange=e=>{ if(e.target.value) applyPreset(e.target.value); };
$('#quickPreset').onchange=e=>{ if(e.target.value) applyPreset(e.target.value); else { P.activePreset=null; renderPresetSel(); } };
$('#pNew').onclick=()=>{ const name=$('#pName').value.trim(); if(!name){ $('#pName').focus(); $('#pName').placeholder='Enter a name first'; return; } track('filter_save',name);
  if(P.presets.length>=50){ note('You can save at most 50 filters.',true); return; }
  const p={id:newId(),name,flow:{...P.flow},screener:{...P.scr},updatedAt:Date.now()}; P.presets.push(p); P.activePreset=p.id; $('#pName').value='';
  saveP(true); renderPresetSel(); note(`Saved "${name}".`); };
$('#pSave').onclick=()=>{ const p=currentPreset(); if(!p) return; track('filter_save',p.name); p.flow={...P.flow}; p.screener={...P.scr}; p.updatedAt=Date.now(); saveP(true); renderPresetSel(); note(`Updated "${p.name}".`); };
$('#pDelete').onclick=()=>{ const p=currentPreset(); if(!p) return; track('filter_delete',p.name); P.presets=P.presets.filter(x=>x.id!==p.id); if(P.defaultPreset===p.id) P.defaultPreset=null; P.activePreset=null; saveP(true); renderPresetSel(); note(`Deleted "${p.name}".`); };
$('#pDefault').onclick=()=>{ const p=currentPreset(); if(!p) return; track('filter_default',p.name); P.defaultPreset = P.defaultPreset===p.id ? null : p.id; saveP(true); renderPresetSel(); };

/* ============================================================
   CHAIN / SCREENER / TRACKED / STOCKS / CHARTS
   ============================================================ */
const CC=[['oi',fInt,0],['vol',fInt,1],['iv',fIV,1],['delta',f2,1],['bid',f2,1],['ask',f2,1],['last',f2,1]];
const PC=[...CC].reverse();
const expiries = () => [...new Set([...S.contracts.values()].map(c=>c.exp))].sort();
function buildExpSel(){ const ex=expiries(), sel=$('#expSel');
  if(!ex.includes(S.selExp)) S.selExp=ex.find(e=>dteOf(e)>=1)||ex[0]||null;
  sel.innerHTML=''; for(const e of ex){ const o=el('option',null,`${fExp(e)} · ${dteOf(e)}d`); o.value=e; o.selected=e===S.selExp; sel.appendChild(o); } }
function buildChain(scroll){
  const tb=$('#chainBody'); tb.innerHTML=''; S.cellMap.clear(); S.starMap.clear(); S.chainRows=[];
  if(!S.selExp){ tb.innerHTML='<tr><td colspan="17" class="empty">No data</td></tr>'; $('#chainInfo').textContent=''; return; }
  const by=new Map(); for(const c of S.contracts.values()) if(c.exp===S.selExp){ const r=by.get(c.strike)||{}; r[c.type]=c; by.set(c.strike,r); }
  const ks=[...by.keys()].sort((a,b)=>a-b), frag=document.createDocumentFragment();
  const star=(c,tr)=>{ if(!c){ tr.appendChild(el('td')); return; } const td=starCell(c.t); tr.appendChild(td); const a=S.starMap.get(c.t)||[]; a.push(td); S.starMap.set(c.t,a); };
  for(const k of ks){ const r=by.get(k), tr=el('tr'), row={tr,k,c:[],p:[]};
    const side=(c,cols,arr)=>{ for(const [f,fmt,fl] of cols){ const td=el('td'); arr.push(td); if(c){ S.cellMap.set(c.t+'|'+f,[td,fmt,fl]); setCell(td,c[f],fmt,false); } tr.appendChild(td); } };
    star(r.C,tr); side(r.C,CC,row.c); tr.appendChild(el('td','k',fK(k))); side(r.P,PC,row.p); star(r.P,tr);
    row.c.forEach(td=>{ if(r.C){ td.style.cursor='pointer'; td.onclick=()=>openInsight({kind:'contract',t:r.C.t}); } }); row.p.forEach(td=>{ if(r.P){ td.style.cursor='pointer'; td.onclick=()=>openInsight({kind:'contract',t:r.P.t}); } });
    S.chainRows.push(row); frag.appendChild(tr); }
  tb.appendChild(frag); $('#chainInfo').textContent=`${S.und} · ${ks.length} strikes`;
  S.lastItm=null; updateItm();
  if(scroll){ S.atmScroll=true; scrollAtm(); }
}
// Centre the at-the-money strike. If the chain is hidden (another view is open) it is done when the chain is shown.
function scrollAtm(){ const w=$('#chainWrap'); if(!S.atmScroll||!w||!w.clientHeight) return; const a=S.chainRows.find(r=>r.tr.classList.contains('atm')); if(!a) return;
  S.atmScroll=false; if(w.scrollHeight>w.clientHeight+4) w.scrollTop=Math.max(0,a.tr.offsetTop-w.clientHeight/2); else a.tr.scrollIntoView({block:'center'}); }
function updateItm(){ const p=S.uPrice; if(!ok(p)||p===S.lastItm||!S.chainRows.length) return; S.lastItm=p;
  let best=null,bd=Infinity; for(const r of S.chainRows){ const d=Math.abs(r.k-p); if(d<bd){bd=d;best=r;} }
  for(const r of S.chainRows){ r.tr.classList.toggle('atm',r===best); r.c.forEach(td=>td.classList.toggle('itm',r.k<p)); r.p.forEach(td=>td.classList.toggle('itm',r.k>p)); } }
function updChain(c){ for(const [f] of CC){ const e=S.cellMap.get(c.t+'|'+f); if(e) setCell(e[0],c[f],e[1],e[2]); } }
function renderUStats(){
  let cv=0,pv=0,co=0,po=0; for(const c of S.contracts.values()){ if(c.type==='C'){cv+=c.vol||0;co+=c.oi||0;} else {pv+=c.vol||0;po+=c.oi||0;} }
  let atm=null; if(S.selExp&&ok(S.uPrice)){ let best=null,bd=Infinity; for(const c of S.contracts.values()) if(c.exp===S.selExp){ const d=Math.abs(c.strike-S.uPrice); if(d<bd){bd=d;best=c.strike;} }
    const v=[...S.contracts.values()].filter(c=>c.exp===S.selExp&&c.strike===best&&ok(c.iv)).map(c=>c.iv); if(v.length) atm=v.reduce((a,b)=>a+b)/v.length; }
  const cls=S.uChg>0?'c-green':S.uChg<0?'c-red':'';
  $('#ustats').innerHTML=`<div class="card"><div class="k">${S.und}</div><div class="v">${f2(S.uPrice)}</div><div class="s ${cls}">${ok(S.uChg)?(S.uChg>0?'+':'')+S.uChg.toFixed(2)+' ('+fSPct(S.uChgPct)+')':'Underlying'}</div></div>`+
    `<div class="card"><div class="k">ATM IV</div><div class="v">${fIV(atm)}</div><div class="s">${S.selExp?fExp(S.selExp):''}</div></div>`+
    `<div class="card"><div class="k">Put/call volume</div><div class="v">${pv&&cv?(pv/cv).toFixed(2):'–'}</div>${split(cv,pv)}<div class="s">${fInt(cv)} calls, ${fInt(pv)} puts</div></div>`+
    `<div class="card"><div class="k">Put/call open interest</div><div class="v">${po&&co?(po/co).toFixed(2):'–'}</div>${split(co,po)}<div class="s">${fInt(co)} calls, ${fInt(po)} puts</div></div>`; }

const SCR=[
  {k:'label',h:'Contract',g:labelOf,f:x=>x,s:1},
  {k:'dte',h:'DTE',g:c=>dteOf(c.exp),f:fInt,n:1},
  {k:'bid',h:'Bid',f:f2,fl:1,n:1},{k:'ask',h:'Ask',f:f2,fl:1,n:1},{k:'mid',h:'Mid',f:f2,fl:1,n:1},
  {k:'spread',h:'Spread',g:spreadOf,f:fPct,n:1},{k:'last',h:'Last',f:f2,fl:1,n:1},{k:'chgPct',h:'Day %',f:fSPct,n:1},
  {k:'vol',h:'Volume',f:fInt,fl:1,n:1},{k:'oi',h:'OI',f:fInt,n:1},{k:'volOi',h:'Vol/OI',g:volOiOf,f:f2,n:1},
  {k:'iv',h:'IV',f:fIV,fl:1,n:1},{k:'delta',h:'Δ',f:f3,fl:1,n:1},{k:'gamma',h:'Γ',f:f4,n:1},{k:'theta',h:'Θ',f:f3,n:1},{k:'vega',h:'Vega',f:f3,n:1},
  {k:'be',h:'Breakeven',f:f2,n:1},{k:'otm',h:'OTM',g:otmOf,f:fPct,n:1}];
SCR.forEach(c=>{ if(!c.g) c.g=x=>x[c.k]; });
const IDX_CHG=SCR.findIndex(c=>c.k==='chgPct'), IDX_VOI=SCR.findIndex(c=>c.k==='volOi');
function buildScrHead(){ const tr=el('tr'); tr.appendChild(el('th'));
  for(const c of SCR){ const th=el('th',c.n?'num':'',c.h+(P.sortKey===c.k?(P.sortDir>0?' ▲':' ▼'):'')); if(P.sortKey===c.k) th.classList.add('on');
    th.onclick=()=>{ if(P.sortKey===c.k) P.sortDir*=-1; else { P.sortKey=c.k; P.sortDir=c.s?1:-1; } saveP(); buildScrHead(); S.scrForce=true; }; tr.appendChild(th); }
  $('#scrHead').replaceChildren(tr); }
function passScr(c){ const f=P.scr;
  if(f.type!=='all'&&c.type!==f.type) return false;
  const d=dteOf(c.exp); if(num(f.dteMin)!=null&&d<num(f.dteMin)) return false; if(num(f.dteMax)!=null&&d>num(f.dteMax)) return false;
  const ad=ok(c.delta)?Math.abs(c.delta):null; if(num(f.dMin)!=null&&(ad==null||ad<num(f.dMin))) return false; if(num(f.dMax)!=null&&(ad==null||ad>num(f.dMax))) return false;
  if(num(f.oi)!=null&&!((c.oi||0)>=num(f.oi))) return false; if(num(f.vol)!=null&&!((c.vol||0)>=num(f.vol))) return false;
  if(num(f.spr)!=null){ const s=spreadOf(c); if(s==null||s>num(f.spr)) return false; }
  const iv=ok(c.iv)?c.iv*100:null; if(num(f.ivMin)!=null&&(iv==null||iv<num(f.ivMin))) return false; if(num(f.ivMax)!=null&&(iv==null||iv>num(f.ivMax))) return false;
  if(f.unusual){ const r=volOiOf(c); if(r==null||r<3||(c.vol||0)<100) return false; } return true; }
function renderScreener(){
  const col=SCR.find(c=>c.k===P.sortKey)||SCR[8], dir=P.sortDir;
  const list=[...S.contracts.values()].filter(passScr).sort((a,b)=>{ const x=col.g(a),y=col.g(b); if(x==null&&y==null) return 0; if(x==null) return 1; if(y==null) return -1; return (typeof x==='string'?x.localeCompare(y):x-y)*dir; });
  const top=list.slice(0,200), prev=S.scrTop.join('|'); S.scrTop=top.map(c=>c.t);
  $('#scrInfo').textContent=`${S.und} · ${list.length.toLocaleString('en-US')} results${list.length>200?' · top 200':''}`;
  const tb=$('#scrBody'), keep=new Set(S.scrTop); for(const [t,r] of S.scrRows) if(!keep.has(t)){ r.tr.remove(); S.scrRows.delete(t); }
  const trs=[]; for(const c of top){ let r=S.scrRows.get(c.t);
    if(!r){ const tr=el('tr'); const star=starCell(c.t); tr.appendChild(star);
      const tds=SCR.map(sc=>{ const td=el('td',sc.n?'num':''); tr.appendChild(td); return td; });
      tr.style.cursor='pointer'; tr.onclick=()=>openInsight({kind:'contract',t:c.t}); r={tr,tds,star}; S.scrRows.set(c.t,r); }
    updScr(c,r); trs.push(r.tr); }
  const e=tb.querySelector('.empty'); if(e) e.parentNode.remove();
  if(prev!==S.scrTop.join('|')||tb.children.length!==trs.length) tb.append(...trs);
  if(!top.length) tb.innerHTML='<tr><td colspan="19" class="empty">No contracts match your filters</td></tr>'; }
function updScr(c,r){ SCR.forEach((sc,i)=>setCell(r.tds[i],sc.g(c),sc.f,!!sc.fl));
  const vo=volOiOf(c); r.tds[IDX_VOI].classList.toggle('c-yellow',vo!=null&&vo>=3&&(c.vol||0)>=100);
  r.tds[IDX_CHG].classList.toggle('c-green',c.chgPct>0); r.tds[IDX_CHG].classList.toggle('c-red',c.chgPct<0); }
const sMap={sType:'type',sDteMin:'dteMin',sDteMax:'dteMax',sDMin:'dMin',sDMax:'dMax',sOi:'oi',sVol:'vol',sSpr:'spr',sIvMin:'ivMin',sIvMax:'ivMax',sUnusual:'unusual'};
function fillScr(){ for(const [id,k] of Object.entries(sMap)){ const e=$('#'+id); e[e.type==='checkbox'?'checked':'value']=P.scr[k]; } }
for(const [id,k] of Object.entries(sMap)){ const e=$('#'+id); e.addEventListener('input',()=>{ P.scr[k]=e.type==='checkbox'?e.checked:e.value; saveP(); S.scrForce=true; paintPresetDirty(); }); }

const TRK=[
  {k:'label',h:'Contract',g:c=>`${fExp(c.exp)} ${fK(c.strike)} ${c.type==='C'?'Call':'Put'}`,f:x=>x},
  {k:'dte',h:'DTE',g:c=>dteOf(c.exp),f:fInt,n:1},
  {k:'bid',h:'Bid',f:f2,fl:1,n:1},{k:'ask',h:'Ask',f:f2,fl:1,n:1},{k:'mid',h:'Mid',f:f2,fl:1,n:1},{k:'last',h:'Last',f:f2,fl:1,n:1},
  {k:'chgPct',h:'Day %',f:fSPct,n:1},{k:'vol',h:'Volume',f:fInt,fl:1,n:1},{k:'oi',h:'OI',f:fInt,n:1},
  {k:'iv',h:'IV',f:fIV,fl:1,n:1},{k:'delta',h:'Δ',f:f3,fl:1,n:1},{k:'theta',h:'Θ',f:f3,n:1},{k:'be',h:'Breakeven',f:f2,n:1},{k:'otm',h:'OTM',g:otmOf,f:fPct,n:1}];
TRK.forEach(c=>{ if(!c.g) c.g=x=>x[c.k]; });
function buildTrkHead(){ const tr=el('tr'); tr.appendChild(el('th')); for(const c of TRK) tr.appendChild(el('th',c.n?'num':'',c.h)); $('#trkHead').replaceChildren(tr); }
function renderTracked(){
  const tb=$('#trkBody'); tb.innerHTML=''; S.trkRows.clear();
  if(!P.tracked.length){ tb.innerHTML=`<tr><td colspan="${TRK.length+1}" class="empty">You are not watching any contracts yet</td></tr>`; return; }
  const groups=new Map(); for(const t of P.tracked){ const pt=parseTicker(t); if(!pt) continue; if(!groups.has(pt.und)) groups.set(pt.und,[]);
    let c=S.trk.get(t)||S.contracts.get(t); if(!c){ c={t,und:pt.und,type:pt.type,strike:pt.strike,exp:pt.exp}; S.trk.set(t,c); } groups.get(pt.und).push(c); }
  for(const [und,list] of [...groups].sort((a,b)=>a[0].localeCompare(b[0]))){
    const g=el('tr','grp'); const gtd=el('td'); gtd.colSpan=TRK.length+1; g.appendChild(gtd); g._und=und; tb.appendChild(g); paintGroup(g);
    list.sort((a,b)=>a.exp.localeCompare(b.exp)||a.strike-b.strike||a.type.localeCompare(b.type));
    for(const c of list){ const tr=el('tr'); tr.appendChild(starCell(c.t));
      const tds=TRK.map(sc=>{ const td=el('td',sc.n?'num':''); tr.appendChild(td); return td; });
      tr.style.cursor='pointer'; tr.onclick=()=>openInsight({kind:'contract',t:c.t});
      S.trkRows.set(c.t,{tr,tds,g}); tb.appendChild(tr); updTrk(c); } } }
function paintGroup(g){ const u=S.trkU.get(g._und)||{}, s=S.stocks.get(g._und)||{}; const price=s.price??u.price, chg=s.chgPct??u.chgPct;
  g.firstChild.innerHTML=`<b>${g._und}</b>${f2(price)} <span class="${chg>0?'c-green':chg<0?'c-red':''}">${fSPct(chg)}</span>`; }
function updTrk(c){ const r=S.trkRows.get(c.t); if(!r) return; TRK.forEach((sc,i)=>setCell(r.tds[i],sc.g(c),sc.f,!!sc.fl));
  const i=TRK.findIndex(x=>x.k==='chgPct'); r.tds[i].classList.toggle('c-green',c.chgPct>0); r.tds[i].classList.toggle('c-red',c.chgPct<0); }

const ST=[{k:'sym',h:'Ticker',f:x=>x},{k:'price',h:'Price',f:f2,fl:1,n:1},{k:'chg',h:'Change',f:v=>ok(v)?(v>0?'+':'')+v.toFixed(2):'–',n:1},{k:'chgPct',h:'%',f:fSPct,n:1},
  {k:'bid',h:'Bid',f:f2,fl:1,n:1},{k:'ask',h:'Ask',f:f2,fl:1,n:1},{k:'high',h:'Day high',f:f2,n:1},{k:'low',h:'Day low',f:f2,n:1},{k:'vwap',h:'VWAP',f:f2,n:1},{k:'vol',h:'Volume',f:fInt,fl:1,n:1},
  {k:'n',h:'Watching',g:s=>P.tracked.filter(t=>parseTicker(t)?.und===s.sym).length||null,f:v=>v?v+' contract'+(v>1?'s':''):'',n:1}];
ST.forEach(c=>{ if(!c.g) c.g=x=>x[c.k]; });
function buildStocks(){ const h=el('tr'); for(const c of ST) h.appendChild(el('th',c.n?'num':'',c.h)); $('#stHead').replaceChildren(h);
  const tb=$('#stBody'); tb.innerHTML=''; S.stRows.clear();
  for(const sym of watchList()){ if(!S.stocks.has(sym)) S.stocks.set(sym,{sym});
    const tr=el('tr'); tr.style.cursor='pointer'; tr.title='Insights and news'; tr.onclick=()=>openInsight({kind:'stock',sym});
    const tds=ST.map(c=>{ const td=el('td',c.n?'num':''); tr.appendChild(td); return td; });
    S.stRows.set(sym,{tr,tds}); tb.appendChild(tr); updStock(sym); } }
function updStock(sym){ const s=S.stocks.get(sym), r=S.stRows.get(sym); if(!s||!r) return;
  ST.forEach((c,i)=>setCell(r.tds[i],c.g(s),c.f,!!c.fl)); for(const i of [2,3]){ r.tds[i].classList.toggle('c-green',s.chg>0); r.tds[i].classList.toggle('c-red',s.chg<0); }
  r.tds[0].style.fontWeight=sym===S.und?'700':''; r.tds[0].style.color=''; }

/* ---------- all stocks (whole market, from /api/universe) ---------- */
const UNI_COLS=[{k:'s',h:'Ticker'},{k:'n',h:'Name'},{k:'p',h:'Price',n:1,f:f2},{k:'c',h:'%',n:1,f:fSPct},{k:'v',h:'Volume',n:1,f:fInt},{k:'dv',h:'$ volume',n:1,f:v=>v?fMoney(v):'–'},{k:'o',h:'Options',n:1,f:v=>v?'Yes':''}];
const UNI_MAX=400; let uniSort={k:'dv',d:-1}, uniTimer=null;
function stMode(all){ if(all&&!P.stAll) track('all_stocks'); P.stAll=!!all; saveP(); $('#stModeW').classList.toggle('on',!all); $('#stModeA').classList.toggle('on',all);
  $('#stWatchL').hidden=all; $('#stAllCtl').hidden=!all; $('#stWrap').hidden=all; $('#uniWrap').hidden=!all;
  clearInterval(uniTimer); if(all){ loadUni(); uniTimer=setInterval(()=>{ if(cur==='stocks'&&P.stAll&&!document.hidden) loadUni(); },90e3); } }
async function loadUni(){
  if(DEMO){ if(!S.uni){ const rows=Object.keys(UNIV).map(sym=>{ const p=DSPOT[sym]||UNIV[sym], v=Math.round(1e6+Math.random()*6e7); return {s:sym,n:NAMES_DEMO[sym]||sym,p,c:+((Math.random()-.5)*6).toFixed(2),v,dv:Math.round(p*v),o:1}; });
      S.uni={rows,at:Date.now()}; } renderUni(); return; }
  if(!S.uni) $('#uniBody').innerHTML='<tr><td colspan="7" class="empty">Loading every listed stock…</td></tr>';
  try{ const j=await getJSON('/api/universe'); if(j.configured===false){ $('#uniBody').innerHTML='<tr><td colspan="7" class="empty">The full stock list needs an Alpaca key on the server.</td></tr>'; return; }
    S.uni=j; S.uniMap=new Map(j.rows.map(r=>[r.s,r])); renderUni(); }
  catch(e){ if(!S.uni){ const td=el('td','empty','Could not load the stock list: '+e.message); td.colSpan=7; const tr=el('tr'); tr.appendChild(td); $('#uniBody').replaceChildren(tr); } } }
function renderUni(){ if(!S.uni) return;
  const h=el('tr'); for(const c of UNI_COLS){ const th=el('th',(c.n?'num ':'')+(uniSort.k===c.k?'on':''),c.h+(uniSort.k===c.k?(uniSort.d<0?' ▼':' ▲'):''));
    th.onclick=()=>{ uniSort=uniSort.k===c.k?{k:c.k,d:-uniSort.d}:{k:c.k,d:c.n?-1:1}; renderUni(); }; h.appendChild(th); } $('#uniHead').replaceChildren(h);
  const q=$('#uniQ').value.trim().toUpperCase(), opt=$('#uniOpt').checked;
  let rows=S.uni.rows.filter(r=>(!opt||r.o)&&(!q||r.s.startsWith(q)||(q.length>1&&r.n.toUpperCase().includes(q))));
  const k=uniSort.k, d=uniSort.d; rows.sort((a,b)=>{ const x=a[k],y=b[k]; if(x==null&&y==null) return 0; if(x==null) return 1; if(y==null) return -1; return (typeof x==='string'?x.localeCompare(y):x-y)*d; });
  if(q) rows.sort((a,b)=>(b.s===q)-(a.s===q));
  const total=rows.length; rows=rows.slice(0,UNI_MAX);
  $('#uniInfo').textContent=`${fInt(total)} of ${fInt(S.uni.rows.length)} stocks`+(total>UNI_MAX?` · showing top ${UNI_MAX}, filter to narrow`:'')+(S.uni.at?` · ${new Date(S.uni.at).toLocaleTimeString('en-US')}`:'');
  const frag=document.createDocumentFragment();
  for(const r of rows){ const tr=el('tr'); tr.style.cursor='pointer'; tr.title=r.o?'Insights and news · ⋯ for the option chain':'Insights and news';
    for(const c of UNI_COLS){ const v=r[c.k]; const td=el('td',c.n?'num':'',c.f?c.f(v):(v??''));
      if(c.k==='c') td.className+=v>0?' c-green':v<0?' c-red':''; if(c.k==='s') td.style.fontWeight='600';
      if(c.k==='n'){ td.style.maxWidth='280px'; td.style.overflow='hidden'; td.style.textOverflow='ellipsis'; td.className+=' c-muted'; }
      if(c.k==='o'&&v){ td.textContent=''; const b=el('button','btn','Chain'); b.style.padding='2px 10px'; b.onclick=e=>{ e.stopPropagation(); view('chain'); load(r.s); }; td.appendChild(b); }
      tr.appendChild(td); }
    tr.onclick=()=>openInsight({kind:'stock',sym:r.s}); frag.appendChild(tr); }
  $('#uniBody').replaceChildren(frag); if(!rows.length) $('#uniBody').innerHTML='<tr><td colspan="7" class="empty">No stocks match this filter</td></tr>'; }
const NAMES_DEMO={SPY:'SPDR S&P 500 ETF',QQQ:'Invesco QQQ Trust',AAPL:'Apple Inc.',MSFT:'Microsoft Corporation',NVDA:'NVIDIA Corporation',TSLA:'Tesla, Inc.',AMZN:'Amazon.com, Inc.',META:'Meta Platforms, Inc.'};
let uniQT=0; $('#uniQ').addEventListener('input',()=>{ clearTimeout(uniQT); uniQT=setTimeout(renderUni,120); }); $('#uniOpt').onchange=renderUni;
$('#stModeW').onclick=()=>stMode(false); $('#stModeA').onclick=()=>stMode(true);

function renderCharts(){
  if(typeof Chart==='undefined'){ $('.charts').innerHTML='<p class="c-muted">Could not load the chart library.</p>'; return; }
  const rows=[...S.contracts.values()].filter(c=>c.exp===S.selExp), ks=[...new Set(rows.map(c=>c.strike))].sort((a,b)=>a-b);
  const pick=(t,f)=>ks.map(k=>{ const c=rows.find(r=>r.strike===k&&r.type===t); return c&&ok(c[f])?c[f]:null; });
  const opt={animation:false,responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#878d96',boxWidth:10,boxHeight:10}}},
    scales:{x:{ticks:{color:'#878d96',maxRotation:0,autoSkip:true},grid:{display:false}},y:{ticks:{color:'#878d96'},grid:{color:'#23272d'}}}};
  const mk=(id,type,labels,ds)=>{ const ch=S.charts[id]; if(ch){ ch.data.labels=labels; ch.data.datasets.forEach((d,i)=>d.data=ds[i].data); ch.update('none'); return; } S.charts[id]=new Chart($('#'+id),{type,data:{labels,datasets:ds},options:opt}); };
  const lbl=ks.map(fK), pc=d=>d.map(v=>v==null?null:+(v*100).toFixed(2));
  mk('ivChart','line',lbl,[{label:'Call IV %',data:pc(pick('C','iv')),borderColor:'#4fd1a1',borderWidth:1.5,pointRadius:0,spanGaps:true},{label:'Put IV %',data:pc(pick('P','iv')),borderColor:'#f0716a',borderWidth:1.5,pointRadius:0,spanGaps:true}]);
  mk('oiChart','bar',lbl,[{label:'Call OI',data:pick('C','oi'),backgroundColor:'#4fd1a1'},{label:'Put OI',data:pick('P','oi'),backgroundColor:'#f0716a'}]);
  mk('vlChart','bar',lbl,[{label:'Call volume',data:pick('C','vol'),backgroundColor:'#4fd1a1'},{label:'Put volume',data:pick('P','vol'),backgroundColor:'#f0716a'}]);
  const b=new Map(); for(const f of FILTERED){ const m=Math.floor(f.t/6e4)*6e4; const x=b.get(m)||{c:0,p:0}; if(f.cp==='C') x.c+=f.prem; else x.p+=f.prem; b.set(m,x); }
  const mins=[...b.keys()].sort((a,c)=>a-c).slice(-60);
  mk('flowChart','bar',mins.map(m=>new Date(m).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'})),[{label:'Call premium',data:mins.map(m=>Math.round(b.get(m).c)),backgroundColor:'#4fd1a1'},{label:'Put premium',data:mins.map(m=>-Math.round(b.get(m).p)),backgroundColor:'#f0716a'}]);
  const e=S.selExp?` · ${S.und} ${fExp(S.selExp)}`:''; $('#ivTitle').textContent='IV smile'+e; $('#oiTitle').textContent='Open interest'+e; $('#vlTitle').textContent='Volume'+e; }

/* ---------- views + render loop ---------- */
const VTITLE={flow:'Options flow',chain:'Option chain',screener:'Contract screener',tracked:'My watchlist',stocks:'Stocks',charts:'Charts',community:'Community'};
/* ---------- plan (Pro via Paddle) ---------- */
const PRO_VIEWS=new Set(['flow','screener','charts','community']);
const isPro = () => !CFG.billing || !CFG.billing.paywall || CFG.billing.plan==='pro';
const locked = v => PRO_VIEWS.has(v) && !isPro();
function paintLocks(){ document.querySelectorAll('.rail [data-view]').forEach(b=>b.classList.toggle('lock',locked(b.dataset.view)));
  $('#acctBtn').classList.toggle('pro',!!(CFG.billing&&CFG.billing.plan==='pro')); }
/* ---------- paywall dialog: $9.99 offer + Paddle checkout embedded on the right ---------- */
const GATE_TXT={
  flow:['Options flow is part of Pro','See large options trades as they print: sweeps, blocks and big-trade highlights across your watchlist and the most active stocks.'],
  screener:['The contract screener is part of Pro','Screen every contract across all expiries and strikes by volume, open interest, IV and more.'],
  charts:['Charts are part of Pro','IV smile, open interest, volume and flow premium charts for any symbol.'],
  community:['The community is part of Pro','Talk options with other members: share the trades and flow you are watching, tag tickers, follow people and reply.'],
  insight:['Insights are part of Pro','Stock and contract insights with related news, one click away.'],
  upgrade:['Upgrade to Options Screener Pro','Unlimited symbols, the live options flow, the contract screener, charts and insights.'],
  limit:["You've used today's free symbols",n=>`The free plan includes ${n} symbols a day. Upgrade to Pro for unlimited options data, the live flow, the screener and charts.`]};
let GATE=null, coOpen=false, paddleReady=null;
function openGate(kind,limit){ const b=CFG.billing; if(!b||(!b.paddle&&b.checkout!=='soon')){ note('Payments are not set up yet.',true); return; }
  const whole=kind==='limit'||kind==='upgrade'||kind==='insight', [t,l]=GATE_TXT[kind]||GATE_TXT.upgrade;
  $('#gateT').textContent=t; $('#gateLead').textContent=typeof l==='function'?l(limit||(CFG.free&&CFG.free.limit)||3):l;
  $('#gateX').hidden=kind==='limit';
  { const d=b.discount, g=$('#gateDisc'); g.hidden=!d; g.textContent=d?`Your personal discount: ${d.label}. Applied automatically at checkout.`:''; }
  document.body.classList.toggle('gate-all',whole); document.body.classList.toggle('gate-main',!whole);
  $('#app').inert=whole; $('.main').inert=!whole; if(!whole) $('#feed').inert=true;
  $('#gate').hidden=false; closeAcct(); closeMenu(); if(GATE!==kind) track('view','Paywall: '+kind); GATE=kind; mountCheckout(); }
function closeGate(force){ if(!GATE||(GATE==='limit'&&!force)) return; GATE=null; $('#gate').hidden=true;
  document.body.classList.remove('gate-all','gate-main'); $('#app').inert=false; $('.main').inert=false; $('#feed').inert=false;
  if(coOpen){ try{ Paddle.Checkout.close(); }catch(e){} coOpen=false; } }
$('#gateX').onclick=()=>{ const k=GATE; closeGate(); if(PRO_VIEWS.has(k)) view('chain'); };
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&GATE&&GATE!=='limit') $('#gateX').click(); });
function loadPaddle(){ if(paddleReady) return paddleReady; const b=CFG.billing.paddle;
  paddleReady=new Promise((res,rej)=>{ const sc=document.createElement('script'); sc.src='https://cdn.paddle.com/paddle/v2/paddle.js'; sc.onerror=()=>{ paddleReady=null; rej(new Error('the payment provider did not respond')); };
    sc.onload=()=>{ try{ if(b.env==='sandbox') Paddle.Environment.set('sandbox'); Paddle.Initialize({ token:b.token, eventCallback:onPaddle }); res(); }catch(e){ rej(e); } };
    document.head.appendChild(sc); }); return paddleReady; }
async function mountCheckout(){ const st=$('#gateState'); $('.gbox').classList.remove('done'); if(coOpen) return;
  if(!CFG.billing.paddle){ st.className='gstate'; st.textContent='Pro checkout opens soon. Until then, the free plan includes '+((CFG.free&&CFG.free.limit)||3)+' symbols a day.'; return; }
  st.className='gstate'; st.textContent='Loading secure checkout…';
  try{ await loadPaddle(); const b=CFG.billing.paddle;
    Paddle.Checkout.open({ items:[{priceId:b.priceId,quantity:1}], customData:b.customData, ...(b.discount?{discountId:b.discount.id}:{}),
      customer:{ email:b.customData.email, ...(b.country?{address:{countryCode:b.country}}:{}) },
      settings:{ displayMode:'inline', frameTarget:'pay-frame', frameInitialHeight:420, frameStyle:'width:100%;min-width:260px;background-color:transparent;border:none;',
        theme:'dark', locale:'en', variant:'one-page', allowLogout:false, showAddDiscounts:false } });
    coOpen=true; }
  catch(e){ st.className='gstate err'; st.textContent='Checkout could not load: '+e.message+'. Try again in a moment.'; } }
function onPaddle(e){ if(!e||!e.name) return; const d=e.data||{}, st=$('#gateState');
  if(e.name==='checkout.loaded') st.textContent='';
  if((e.name==='checkout.loaded'||e.name==='checkout.updated')&&d.totals&&isFinite(+d.totals.total)){
    const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:d.currency_code||'USD'}).format(+v);
    $('#gateTotal').textContent=money(d.totals.total); $('#gateTax').textContent=+d.totals.tax?`Includes ${money(d.totals.tax)} tax`:''; }
  if(e.name==='checkout.error'){ st.className='gstate err'; st.textContent=(d&&d.detail)||'Checkout error. Please try again.'; }
  if(e.name==='checkout.completed') afterCheckout(d.transaction_id); }
// Unlock only after the server has confirmed the payment with Paddle (webhook or direct check).
async function afterCheckout(txn){ const st=$('#gateState'); $('.gbox').classList.add('done'); st.className='gstate'; st.textContent='Payment received. Confirming with Paddle…'; coOpen=false;
  for(let i=0;i<30;i++){
    let b=null; try{ const j=await getJSON('/api/billing?a=sync&txn='+encodeURIComponent(txn||'')); b=j.billing; }catch(e){ try{ b=await getJSON('/api/billing?a=status'); }catch(e2){} }
    if(b&&b.plan==='pro'){ st.textContent='Welcome to Pro. Unlocking everything…'; try{ sessionStorage.setItem('os_welcome','1'); }catch(e){} setTimeout(()=>location.reload(),900); return; }
    await new Promise(r=>setTimeout(r,2000)); }
  st.className='gstate err'; st.textContent='Your payment went through, but confirming it is taking longer than usual. Refresh the page in a minute; if Pro is still locked, email us and we will fix it right away.'; }
// Placeholder trades shown blurred behind the paywall on the flow view (never readable, never real).
let TEASER=null;
function teaserFlows(){ if(TEASER) return TEASER; const syms=['NVDA','SPY','TSLA','AAPL','QQQ','AMD','META','AMZN','MSFT','PLTR'], types=['Sweep','Block','Split','Single'], sides=['AA','A','M','B','BB'], now=Date.now();
  TEASER=Array.from({length:22},(_,i)=>{ const cp=Math.random()<.6?'C':'P', price=+(0.5+Math.random()*12).toFixed(2), size=Math.round(50+Math.random()*3000), spot=50+Math.random()*600;
    return { id:'tz'+i, t:now-i*47e3, sym:syms[i%syms.length], exp:'2026-12-19', strike:Math.round(spot/5)*5, cp, spot, size, price, side:sides[i%5], prem:price*size*100, type:types[i%4], vol:size*3, oi:size*2, ticker:'' }; });
  return TEASER; }
let amenu=null;
function closeAcct(){ if(amenu){ amenu.remove(); amenu=null; } }
function openAcct(){ closeAcct(); const b=CFG.billing||{}; amenu=el('div','amenu'); amenu.setAttribute('role','menu');
  const who=el('div','who'); who.append(el('b',null,CFG.name||CFG.email||''),el('span',null,CFG.name?CFG.email:''));
  if(b.configured){ const pro=b.plan==='pro'; const tag=el('span','plan'+(pro?' pro':''),pro?(b.status==='admin'?'Pro (admin)':b.status==='comp'?'Pro (complimentary)':'Pro'):'Free plan');
    if(pro&&b.status==='comp'&&b.compUntil) tag.textContent+=` · until ${new Date(b.compUntil).toLocaleDateString('en-US')}`; else if(pro&&b.cancelAt) tag.textContent+=` · ends ${new Date(b.cancelAt).toLocaleDateString('en-US')}`; else if(pro&&b.nextBill) tag.textContent+=` · renews ${new Date(b.nextBill).toLocaleDateString('en-US')}`;
    who.append(el('br'),tag); }
  amenu.append(who);
  if(b.configured&&b.plan!=='pro'){ const u=el('button',null,'Upgrade to Pro · $9.99/month'); u.onclick=()=>openGate('upgrade'); amenu.append(u); }
  if(b.configured&&b.plan==='pro'&&b.status==='admin'&&b.paddle&&b.paddle.env==='sandbox'){ const t=el('button',null,'Test checkout (sandbox, no real charge)'); t.onclick=()=>openGate('upgrade'); amenu.append(t); }
  if(b.canManage){ const m=el('a',null,'Manage subscription and card'); m.href='/api/billing?a=portal'; m.target='_blank'; m.rel='noopener'; amenu.append(m); }
  amenu.append(el('hr'));
  const mk=el('button','sw'); mk.append(el('span',null,'Email updates'), el('i',CFG.marketing?'on':'',CFG.marketing?'On':'Off'));
  mk.title='Product updates and offers by email. Payment and account emails are always sent.';
  mk.onclick=async()=>{ const on=!CFG.marketing; try{ const r=await fetch('/api/userdata?a=marketing&on='+(on?1:0),{method:'PUT',credentials:'same-origin'}); if(!r.ok) throw new Error();
      CFG.marketing=on; note(on?'You will receive product updates by email.':'Product emails are turned off.'); }catch(e){ note('Could not save your email preference.',true); } closeAcct(); };
  amenu.append(mk);
  const dl=el('a',null,'Download my data'); dl.href='/api/userdata?a=export'; dl.setAttribute('download',''); amenu.append(dl);
  const del=el('button',null,'Delete account'); del.onclick=deleteAccount; amenu.append(del);
  const o=el('a',null,'Sign out'); o.href='/api/auth/logout'; amenu.append(o);
  const lg=el('div','legal'); for(const [t,h] of [['Terms','/terms'],['Privacy','/privacy'],['Refunds','/refund']]){ const a=el('a',null,t); a.href=h; a.target='_blank'; lg.append(a); } amenu.append(lg);
  document.body.appendChild(amenu); }
async function deleteAccount(){ closeAcct();
  if(!confirm('Delete your account? Your saved filters, watchlist and history will be erased. This cannot be undone.')) return;
  try{ const r=await fetch('/api/userdata',{method:'DELETE',credentials:'same-origin'}); const j=await r.json().catch(()=>({}));
    if(!r.ok){ note(j.error||'Could not delete the account.',true); return; } location.href='/login?deleted=1'; }
  catch(e){ note('Could not reach the server.',true); } }
// Users who signed in before the current Terms / Privacy / Refund Policy accept them once before continuing.
function askConsent(){ return new Promise(res=>{ document.body.classList.add('gated'); $('#app').inert=true; $('#legal').hidden=false;
  const box=$('#legalAgree'), okb=$('#legalOk'); box.onchange=()=>{ okb.disabled=!box.checked; };
  okb.onclick=async()=>{ okb.disabled=true; $('#legalErr').textContent='';
    try{ const r=await fetch('/api/userdata?a=consent'+($('#legalMkt').checked?'&mkt=1':''),{method:'PUT',credentials:'same-origin'}); if($('#legalMkt').checked) CFG.marketing=true; if(!r.ok) throw new Error('HTTP '+r.status);
      $('#legal').hidden=true; document.body.classList.remove('gated'); $('#app').inert=false; res(); }
    catch(e){ $('#legalErr').textContent='Could not save: '+e.message; okb.disabled=false; } }; }); }
$('#acctBtn').onclick=e=>{ e.stopPropagation(); amenu?closeAcct():openAcct(); };
document.addEventListener('click',e=>{ if(amenu&&!amenu.contains(e.target)) closeAcct(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeAcct(); });
/* ---------- free plan: a few symbols a day, then the data is blurred and the upgrade screen shows ---------- */
function countFree(sym){ const f=CFG.free; if(!f||f.used.includes(sym)) return; f.used.push(sym); f.left=Math.max(0,f.limit-f.used.length); paintFree(); }
function paintFree(){ const e=$('#freeLeft'), f=CFG.free; if(!f||S.walled){ e.hidden=true; return; } e.hidden=false;
  e.textContent=f.left>0?`${f.left} of ${f.limit} free symbols left today`:`No free symbols left today`;
  e.title=`The free plan includes ${f.limit} symbols a day (option chains). Opening another symbol needs Pro, $9.99/month.`; }
$('#freeLeft').onclick=()=>openGate('upgrade');
function wallUp(j){ if(S.walled) return; S.walled=true;
  openGate('limit',(j&&j.limit)||(CFG.free&&CFG.free.limit)||3); setStatus('paused','Free plan limit reached'); note(''); paintFree(); }
let cur='flow';
function view(v){ if(cur!==v) track('view',VTITLE[v]||v); cur=v; P.view=v; saveP(); document.querySelectorAll('.rail [data-view]').forEach(b=>b.classList.toggle('on',b.dataset.view===v));
  $('#vtitle').textContent=VTITLE[v];
  if(locked(v)) openGate(v); else if(GATE&&GATE!=='limit') closeGate();
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('on',s.id==='v-'+v)); $('#vtitle').textContent=VTITLE[v];
  $('#app').classList.toggle('nofeed',v!=='flow'); $('#openFilters').style.display=v==='flow'?'':'none';
  document.body.classList.toggle('v-community',v==='community'); if(v==='community'&&!locked(v)&&window.OSCommunity) OSCommunity.show();
  if(v==='screener') S.scrForce=true; if(v==='charts') S.lastCharts=0; if(v==='tracked') S.trkForce=true; if(v==='flow') S.flowDirty=true; if(v==='chain'){ renderUStats(); requestAnimationFrame(scrollAtm); }
  if(S.flowNote){ if(v==='flow'&&!$('#msg').textContent) note(S.flowNote); else if(v!=='flow'&&$('#msg').textContent===S.flowNote) note(''); } }
document.querySelectorAll('.rail [data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
function flush(){ const now=performance.now();
  for(const t of S.dirty){ const c=S.contracts.get(t)||S.trk.get(t); if(!c) continue;
    if(c.und===S.und&&c.exp===S.selExp) updChain(S.contracts.get(t)||c);
    if(cur==='screener'){ const r=S.scrRows.get(t); if(r) updScr(c,r); }
    if(cur==='tracked') updTrk(S.trk.get(t)||c); }
  S.dirty.clear();
  for(const s of S.stDirty){ updStock(s); if(cur==='tracked') for(const r of S.trkRows.values()) if(r.g._und===s) paintGroup(r.g); } S.stDirty.clear();
  updateItm();
  if(cur==='flow'&&S.flowDirty&&now-S.lastFlowRender>500){ renderFlow(); S.lastFlowRender=now; }
  if(cur==='screener'&&(S.scrForce||now-S.lastScr>1500)){ renderScreener(); S.lastScr=now; S.scrForce=false; }
  if(cur==='tracked'&&S.trkForce){ renderTracked(); S.trkForce=false; }
  if(cur==='charts'&&now-S.lastCharts>3000){ FILTERED=S.flows.filter(f=>passFlow(f,P.flow)); renderCharts(); S.lastCharts=now; } }
setInterval(flush,250);
setInterval(()=>{ S.rate=S.upd; S.upd=0; $('#rate').textContent=S.lastUpd?`Refreshed ${new Date(S.lastUpd).toLocaleTimeString('en-US')}`:''; paintAsOf(); if(cur==='chain') renderUStats(); },1000);
// When the data itself is from: newest stock trade and newest option quote/trade seen, in New York time.
const tsMs = t => t==null?null : typeof t==='string'?Date.parse(t) : t>1e15?t/1e6 : t>1e12?t : t*1e3;
function paintAsOf(){ const e=$('#asof'); if(DEMO){ e.textContent=''; return; }
  const parts=[], stale=t=>etDay(t)!==etDay(Date.now())||Date.now()-t>30*60e3;
  if(S.stockT) parts.push(`<span class="${stale(S.stockT)?'c-yellow':''}">Stocks ${fTime(S.stockT)} ET</span>`);
  if(S.optT) parts.push(`<span class="${stale(S.optT)?'c-yellow':''}">Options ${fTime(S.optT)} ET</span>`);
  const h=parts.join('<span class="t-dim" style="margin:0 7px">·</span>'); if(e._h!==h){ e.innerHTML=h; e._h=h; }
  e.title='Time of the newest price received from the data feed (New York time). Yellow = older than 30 minutes or from a previous day.'; }
setInterval(()=>dteCache.clear(),3600e3);

/* ---------- live polling for the selected symbol ---------- */
async function poll(){
  if(DEMO||S.polling||S.walled) return; if(document.hidden){ setStatus('paused','Paused in background'); return; }
  S.polling=true; const gen=S.gen;
  const jobs=[fetchStocks(), S.selExp?fetchChain(S.selExp).then(r=>{ if(gen===S.gen) r.forEach(x=>ingestOption(x,S.contracts)); }):Promise.resolve(), fetchTracked()];
  const res=await Promise.allSettled(jobs); S.polling=false; if(gen!==S.gen) return;
  const err=res.find(r=>r.status==='rejected');
  if(err&&res.every(r=>r.status==='rejected')){ S.fails++; setStatus('error'); if(S.fails>2) note('Cannot load data: '+err.reason.message,true); return; }
  S.fails=0; S.lastUpd=Date.now(); setStatus(S.delayed?'delayed':'live');
  // A single failed request is retried on the next refresh; only say something if it keeps failing, and clear it once it works.
  S.partFails=err?(S.partFails||0)+1:0;
  if(err&&S.partFails>2) note('Some data could not be loaded: '+err.reason.message,true);
  else if(!err&&/could not be loaded|Cannot load data|Could not reach/.test($('#msg').textContent)) note('');
  if(expiries().length!==$('#expSel').options.length) buildExpSel(); }
async function fullRefresh(){ if(DEMO||S.loadingFull||document.hidden||S.walled) return; S.loadingFull=true; const gen=S.gen;
  try{ const r=await fetchChain(); if(gen===S.gen){ r.forEach(x=>ingestOption(x,S.contracts)); if(expiries().length!==$('#expSel').options.length) buildExpSel(); S.scrForce=true; } }
  catch(e){ note('Could not refresh the chain: '+e.message,true); } finally{ S.loadingFull=false; } }

/* ============================================================
   DEMO DATA (sample market, for previewing without a paid plan)
   ============================================================ */
const erf=x=>{ const s=Math.sign(x); x=Math.abs(x); const t=1/(1+.3275911*x); return s*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x)); };
const N=x=>.5*(1+erf(x/Math.SQRT2)), nd=x=>Math.exp(-x*x/2)/Math.sqrt(2*Math.PI);
function bs(Sp,K,T,v,type,r=.04){ T=Math.max(T,1/365); const d1=(Math.log(Sp/K)+(r+v*v/2)*T)/(v*Math.sqrt(T)), d2=d1-v*Math.sqrt(T), df=Math.exp(-r*T), call=type==='C';
  const price=call?Sp*N(d1)-K*df*N(d2):K*df*N(-d2)-Sp*N(-d1);
  return {price:Math.max(price,.01),delta:call?N(d1):N(d1)-1,gamma:nd(d1)/(Sp*v*Math.sqrt(T)),theta:(-Sp*nd(d1)*v/(2*Math.sqrt(T))+(call?-1:1)*r*K*df*N(call?d2:-d2))/365,vega:Sp*nd(d1)*Math.sqrt(T)/100}; }
const UNIV={SPY:665,QQQ:600,IWM:245,DIA:470,XLF:52,XLE:92,SMH:300,TLT:90,GLD:380,AAPL:255,MSFT:510,NVDA:185,TSLA:430,AMZN:225,META:720,AMD:240,GOOGL:280,NFLX:1150,AVGO:350,PLTR:180,COIN:330,MSTR:330,UBER:95,BA:215,JPM:300,BAC:52,INTC:37,MU:210,SOFI:28,HOOD:130,DIS:112,NKE:65,PYPL:68,XOM:115,WMT:105,COST:920,CRM:245,ORCL:230,SHOP:160,SMCI:45};
const WEIGHT=s=>({SPY:9,QQQ:7,NVDA:6,TSLA:6,IWM:4,AAPL:4,AMD:3,META:3,AMZN:3,MSFT:3,PLTR:3,COIN:2,MSTR:2,GOOGL:2,SMH:2}[s]||1);
const EARN={}; for(const s of Object.keys(UNIV)) EARN[s]=ETFS.has(s)?null:(Math.random()<.85?Math.floor(Math.random()*70):null);
const DSPOT={...UNIV};
const RND=(a,b)=>a+Math.random()*(b-a);
function pickW(){ const ks=Object.keys(UNIV); const tot=ks.reduce((a,k)=>a+WEIGHT(k),0); let r=Math.random()*tot; for(const k of ks){ r-=WEIGHT(k); if(r<=0) return k; } return 'SPY'; }
function nextFridays(n){ const out=[]; const d=new Date(); for(let i=0;i<400&&out.length<n;i++){ const x=new Date(d.getTime()+i*864e5); if(x.getUTCDay()===5) out.push(iso(x)); } return out; }
const DEXPS=nextFridays(30);
const strikeStep=p=>p>500?5:p>150?2.5:p>50?1:.5;
let lastDemoFlows=[];
function genFlow(t){
  let f;
  if(lastDemoFlows.length&&Math.random()<.15){ const b=lastDemoFlows[Math.floor(Math.random()*lastDemoFlows.length)]; f={...b}; delete f.id; }
  else { const sym=pickW(), spot=DSPOT[sym], cp=Math.random()<.56?'C':'P';
    const di=Math.min(DEXPS.length-1,Math.floor(Math.pow(Math.random(),2.2)*DEXPS.length)); const exp=DEXPS[di];
    const step=strikeStep(spot); const k=Math.max(step,Math.round(spot*(1+(cp==='C'?1:-1)*Math.abs(RND(-.04,.12)))/step)*step);
    f={sym,cp,exp,strike:+k.toFixed(2),earn:EARN[sym]}; }
  const spot=DSPOT[f.sym], T=dteOf(f.exp)/365, iv=RND(.22,.65);
  const theo=bs(spot,f.strike,T,iv,f.cp).price; const sp=Math.max(.01,theo*.03);
  const sideR=Math.random(); const side=sideR<.14?'AA':sideR<.5?'A':sideR<.63?'M':sideR<.9?'B':'BB';
  const price=Math.max(.01,+(theo+({AA:sp*1.2,A:sp/2,M:0,B:-sp/2,BB:-sp*1.2}[side])).toFixed(2));
  const size=Math.max(1,Math.round(Math.exp(RND(3,7.2))*(Math.random()<.05?RND(3,12):1)));
  const tr=Math.random(); const type=tr<.48?'Sweep':tr<.72?'Split':'Block';
  const oi=Math.round(Math.exp(RND(4,10))); const vol=size+Math.round(Math.exp(RND(3,9.5)));
  f={...f,t,spot,price,size,side,type,oi,vol};
  lastDemoFlows.push(f); if(lastDemoFlows.length>60) lastDemoFlows.shift();
  return f; }
function startDemoFlow(){
  S.flowTimers.forEach(clearTimeout); S.flowTimers=[]; S.flows=[]; S.repeat.clear();
  const now=Date.now(); const seed=[]; let t=now; for(let i=0;i<450;i++){ t-=RND(4000,45000); seed.push(t); }
  for(const ts of seed.reverse()) addFlow(genFlow(ts),false);
  const tick=()=>{ for(const s in DSPOT) DSPOT[s]*=1+(Math.random()-.5)*.0008; addFlow(genFlow(Date.now()),true); S.lastUpd=Date.now(); S.flowTimers.push(setTimeout(tick,RND(600,2600))); };
  tick(); }
function dPrice(c){ const m=Math.log(c.strike/S.uPrice); c.iv=Math.max(.08,c.base+.35*m*m-(c.type==='P'?.25*m:.1*m)+(Math.random()-.5)*.004);
  const g=bs(S.uPrice,c.strike,dteOf(c.exp)/365,c.iv,c.type), sp=Math.max(.01,g.price*.015+.02);
  c.mid=+g.price.toFixed(2); c.bid=Math.max(0,+(c.mid-sp/2).toFixed(2)); c.ask=+(c.mid+sp/2).toFixed(2);
  Object.assign(c,{delta:g.delta,gamma:g.gamma,theta:g.theta,vega:g.vega,be:c.type==='C'?c.strike+c.mid:c.strike-c.mid}); }
function startDemoChain(){
  for(const sym of watchList()){ const p=DSPOT[sym]||UNIV[sym]||50+Math.random()*300, prev=p*(1+(Math.random()-.5)*.03);
    const s={sym,price:p,prev,bid:p-.01,ask:p+.01,high:Math.max(p,prev)*1.008,low:Math.min(p,prev)*.992,vwap:(p+prev)/2,vol:Math.round(1e6+Math.random()*4e7)}; S.stocks.set(sym,s); stockDerived(s); }
  const step=strikeStep(S.uPrice), base=.14+Math.random()*.2, lo=S.uPrice*(1-CFG.strikePct/100), hi=S.uPrice*(1+CFG.strikePct/100);
  for(const exp of DEXPS.slice(0,9)) for(let k=Math.ceil(lo/step)*step;k<=hi;k+=step) for(const type of ['C','P']){
    const t=optTicker(S.und,exp,type,k), dist=Math.abs(k-S.uPrice)/S.uPrice;
    const c={t,und:S.und,type,strike:+k.toFixed(2),exp,base:base+dteOf(exp)/3000,oi:Math.round(Math.exp(-dist*25)*20000*Math.random()+50),vol:Math.round(Math.exp(-dist*30)*8000*Math.random())};
    if(Math.random()<.02) c.vol=c.oi*(3+Math.random()*4); dPrice(c); c.last=c.mid; c.chgPct=(Math.random()-.5)*40; S.contracts.set(t,c); }
  for(const t of P.tracked){ const c=S.contracts.get(t); if(c) S.trk.set(t,c); }
  const all=[...S.contracts.values()], s0=S.stocks.get(S.und);
  S.timers.push(setInterval(()=>{ s0.price*=1+(Math.random()-.5)*.0006; stockDerived(s0);
    const pool=all.filter(c=>c.exp===S.selExp||isTracked(c.t));
    for(let i=0;i<20;i++){ const c=pool.length&&Math.random()<.8?pool[Math.floor(Math.random()*pool.length)]:all[Math.floor(Math.random()*all.length)];
      dPrice(c); if(Math.random()<.3){ c.vol+=Math.ceil(Math.random()*20); c.last=Math.random()<.5?c.bid:c.ask; } S.dirty.add(c.t); S.upd++; }
    for(const s of S.stocks.values()) if(s!==s0&&Math.random()<.4){ s.price*=1+(Math.random()-.5)*.001; s.vol+=Math.round(Math.random()*500); stockDerived(s); S.upd++; }
    S.lastUpd=Date.now(); },500)); }

/* ---------- price chart of the current symbol (top of every view) ---------- */
// Regular-session bars only for intraday ranges; 1D compares with the previous close, longer ranges with their first bar.
const PCR={ '1D':{m:5,s:'minute',days:6,intra:true,keepDays:1}, '5D':{m:30,s:'minute',days:10,intra:true,keepDays:5},
  '1M':{m:30,s:'minute',days:31,intra:true}, '6M':{m:1,s:'day',days:183}, '1Y':{m:1,s:'day',days:366} };
const NYF=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const nyParts=t=>{ const o={}; for(const p of NYF.formatToParts(t)) o[p.type]=p.value; return { day:`${o.year}-${o.month}-${o.day}`, min:+o.hour*60+ +o.minute }; };
const PX={ chart:null, key:'', bars:[], ref:null, gen:0, timer:null };
const pcRange=()=>PCR[P.pcRange]?P.pcRange:'1D';
function pcLabel(t,r,long){ const d=new Date(t), o={timeZone:'America/New_York'};
  if(r==='1D') return d.toLocaleTimeString('en-US',{...o,hour:'numeric',minute:'2-digit'})+(long?' ET':'');
  if(r==='5D'||r==='1M') return long?d.toLocaleString('en-US',{...o,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET':d.toLocaleDateString('en-US',{...o,month:'short',day:'numeric'});
  return d.toLocaleDateString('en-US',{...o,month:'short',day:'numeric',...(long||r==='1Y'?{year:'numeric'}:{})}); }
function demoBars(r){ const c=PCR[r], n=r==='1D'?78:r==='5D'?65:r==='1M'?286:c.days*0.69|0, step=r==='1D'?3e5:r==='5D'||r==='1M'?18e5:864e5;
  let p=(S.uPrice||100)*(1-(Math.random()-.5)*.06); const t0=Date.now()-n*step, out=[];
  for(let i=0;i<n;i++){ p*=1+(Math.random()-.495)*(r==='1D'?.002:.01); out.push({t:t0+i*step,c:p}); } if(ok(S.uPrice)) out[out.length-1].c=S.uPrice; return out; }
async function pcLoad(force){
  const sec=$('#pchart'); if(!sec) return; const und=S.und, r=pcRange(), key=und+'|'+r;
  $('#pcSym').textContent=und||'–'; document.querySelectorAll('#pcRange button').forEach(b=>{ const on=b.dataset.r===r; b.classList.toggle('on',on); b.setAttribute('aria-pressed',String(on)); });
  pcHead(); if(!und||P.pcHide||S.walled) return; if(!force&&key===PX.key&&PX.bars.length) return;
  const gen=++PX.gen, c=PCR[r], empty=$('#pcEmpty');
  if(key!==PX.key){ empty.hidden=false; empty.textContent='Loading chart…'; }
  let bars;
  try{
    if(DEMO) bars=demoBars(r);
    else { const to=new Date(), from=new Date(to.getTime()-c.days*864e5);
      const j=await massive(`v2/aggs/ticker/${encodeURIComponent(und)}/range/${c.m}/${c.s}/${iso(from)}/${iso(to)}`, c.intra?null:{adjusted:'true',sort:'asc',limit:'5000'});
      bars=(j.results||[]).filter(b=>ok(b.c)&&ok(b.t)).map(b=>({t:b.t,c:b.c})); }
  }catch(e){ if(gen!==PX.gen) return; if(!PX.bars.length||key!==PX.key){ PX.bars=[]; pcDraw(); empty.hidden=false; empty.textContent='Chart not available: '+e.message; } return; }
  if(gen!==PX.gen) return;
  if(c.intra&&!DEMO){ bars=bars.filter(b=>{ const m=nyParts(b.t).min; return m>=570&&m<960; });
    if(c.keepDays){ const days=[...new Set(bars.map(b=>nyParts(b.t).day))].slice(-c.keepDays); bars=bars.filter(b=>days.includes(nyParts(b.t).day)); } }
  PX.key=key; PX.bars=bars;
  const prevClose=ok(S.uPrice)&&ok(S.uChg)?S.uPrice-S.uChg:null;
  PX.ref=r==='1D'&&ok(prevClose)?prevClose:bars.length?bars[0].c:null;
  if(!bars.length){ empty.hidden=false; empty.textContent=`No price history for ${und} in this range.`; } else empty.hidden=true;
  pcDraw(); pcHead();
}
function pcDraw(){
  const cv=$('#pcCanvas'); if(typeof Chart==='undefined'){ $('#pcEmpty').hidden=false; $('#pcEmpty').textContent='Could not load the chart library.'; return; }
  const r=pcRange(), b=PX.bars, last=b.length?b[b.length-1].c:null, up=!(ok(last)&&ok(PX.ref)&&last<PX.ref);
  const col=up?'#4fd1a1':'#f0716a', labels=b.map(x=>pcLabel(x.t,r,false)), data=b.map(x=>x.c);
  const grad=ctx=>{ const a=ctx.chart.chartArea; if(!a) return 'transparent'; const g=ctx.chart.ctx.createLinearGradient(0,a.top,0,a.bottom); g.addColorStop(0,up?'rgba(79,209,161,.20)':'rgba(240,113,106,.20)'); g.addColorStop(1,'rgba(0,0,0,0)'); return g; };
  const ds=[{data,borderColor:col,borderWidth:1.6,pointRadius:0,pointHoverRadius:3,pointHoverBackgroundColor:col,fill:true,backgroundColor:grad,tension:0}];
  if(r==='1D'&&ok(PX.ref)) ds.push({data:b.map(()=>PX.ref),borderColor:'#565c64',borderWidth:1,borderDash:[3,3],pointRadius:0,pointHoverRadius:0,fill:false,label:'prev'});
  if(PX.chart){ PX.chart.data.labels=labels; PX.chart.data.datasets=ds; PX.chart.update('none'); return; }
  PX.chart=new Chart(cv,{type:'line',data:{labels,datasets:ds},options:{responsive:true,maintainAspectRatio:false,animation:false,
    interaction:{mode:'index',intersect:false},
    plugins:{legend:{display:false},tooltip:{filter:i=>i.datasetIndex===0,displayColors:false,backgroundColor:'#1c2025',borderColor:'#2e333a',borderWidth:1,titleColor:'#878d96',bodyColor:'#e4e6e9',
      callbacks:{title:it=>it.length?pcLabel(PX.bars[it[0].dataIndex].t,pcRange(),true):'',label:i=>'$'+f2(i.parsed.y)}}},
    scales:{x:{grid:{display:false},border:{display:false},ticks:{color:'#565c64',maxRotation:0,autoSkip:true,maxTicksLimit:window.innerWidth<640?4:7,font:{size:11}}},
      y:{position:'right',grid:{color:'#1c2025'},border:{display:false},ticks:{color:'#565c64',maxTicksLimit:4,font:{size:11},callback:v=>f2(v)}}}}});
}
function pcHead(){
  const r=pcRange(), b=PX.bars, live=ok(S.uPrice)?S.uPrice:b.length?b[b.length-1].c:null; $('#pcPx').textContent=ok(live)?f2(live):'';
  let d=null, pct=null, tag='today';
  if(r==='1D'){ if(ok(S.uChg)){ d=S.uChg; pct=S.uChgPct; } else if(ok(live)&&ok(PX.ref)){ d=live-PX.ref; pct=d/PX.ref*100; } }
  else if(ok(live)&&b.length){ d=live-b[0].c; pct=d/b[0].c*100; tag=({'5D':'past 5 days','1M':'past month','6M':'past 6 months','1Y':'past year'})[r]; }
  const el=$('#pcChg'); el.className='pc-chg'+(ok(d)?(d>=0?' up':' dn'):'');
  el.textContent=ok(d)?`${d>=0?'+':''}${f2(d)} (${d>=0?'+':''}${ok(pct)?pct.toFixed(2):'–'}%) ${tag}`:'';
}
function pcShut(on){ P.pcHide=!!on; saveP(); $('#pchart').classList.toggle('shut',!!on); const t=$('#pcTog'); t.setAttribute('aria-expanded',String(!on)); t.title=on?'Show chart':'Hide chart'; if(!on) pcLoad(); }
$('#pcRange').onclick=e=>{ const b=e.target.closest('button[data-r]'); if(!b||b.dataset.r===pcRange()) return; P.pcRange=b.dataset.r; saveP(); track('chart_range',b.dataset.r); pcLoad(); };
$('#pcTog').onclick=()=>pcShut(!P.pcHide);
$('#pcSym').onclick=()=>{ if(S.und) openInsight({kind:'stock',sym:S.und}); };
if(P.pcHide) pcShut(true);
setInterval(()=>{ pcHead(); },2000);
setInterval(()=>{ if(!document.hidden&&!P.pcHide&&PCR[pcRange()].intra&&!S.walled) pcLoad(true); },60e3);

/* ---------- load an underlying (chain / screener) ---------- */
async function load(und){
  und=(und||'').trim().toUpperCase(); if(!und) return;
  S.gen++; const gen=S.gen; S.timers.forEach(clearInterval); S.timers=[];
  S.und=und; P.und=und; saveP(); track('chain',und); $('#tk').value='';
  // Reset everything tied to the previous symbol first, so the chart, the stats and the chain never show two symbols at once.
  S.contracts.clear(); S.dirty.clear(); S.scrRows.clear(); $('#scrBody').innerHTML=''; S.scrTop=[]; S.selExp=null; S.chainRows=[]; S.cellMap.clear(); S.starMap.clear();
  S.uPrice=null; S.uChg=null; S.uChgPct=null; S.delayed=null; S.optT=0; S.lastItm=null;
  $('#chainBody').innerHTML=`<tr><td colspan="17" class="empty">Loading ${und}…</td></tr>`; $('#chainInfo').textContent=und; $('#expSel').innerHTML='';
  if($('#scrInfo')) $('#scrInfo').textContent=und; renderUStats();
  PX.key=''; PX.bars=[]; $('#pcPx').textContent=''; $('#pcChg').textContent=''; pcLoad();
  buildStocks(); S.trkForce=true;
  if(DEMO){ S.uPrice=DSPOT[und]||UNIV[und]||100+Math.random()*200; startDemoChain(); takePending(); buildExpSel(); buildChain(true); S.scrForce=true; buildStocks(); return; }
  try{
    try{ await fetchStocks(); }catch(e){ note('Could not load stock data: '+e.message,true); }
    if(!ok(S.uPrice)){ try{ const j=await massive(`v2/aggs/ticker/${und}/prev`); const b=j.results&&j.results[0]; if(b) S.uPrice=b.c; }catch(e){} }
    const res=await fetchChain(); if(gen!==S.gen) return; res.forEach(x=>ingestOption(x,S.contracts));
    if(!res.length) note(`No options found for ${und}.`,true);
    S.lastUpd=Date.now(); setStatus(S.delayed?'delayed':'live');
  }catch(e){ if(gen!==S.gen) return; if(S.walled){ $('#chainBody').innerHTML=''; return; } setStatus('error'); note('Could not load data: '+e.message,true); $('#chainBody').innerHTML='<tr><td colspan="17" class="empty">No data</td></tr>'; return; }
  takePending(); buildExpSel(); buildChain(true); S.scrForce=true; buildStocks();
  fetchTracked().catch(()=>{});
  S.timers.push(setInterval(poll,CFG.pollMs), setInterval(fullRefresh,CFG.fullMs));
}
function takePending(){ if(S.pendingExp){ S.selExp=S.pendingExp; S.pendingExp=null; } }

/* ============================================================
   INSIGHT DRAWER (stock or contract) + NEWS (Exa, via /api/news)
   ============================================================ */
const NEWS = new Map(); // sym -> {at, data|promise}
let insState = null;
function closeInsight(){ clearInterval(bookTimer); $('#insight').classList.remove('on'); if(!$('#drawer').classList.contains('on')) $('#overlay').classList.remove('on'); insState=null; }
$('#insClose').onclick=closeInsight;
const safeUrl = u => /^https?:\/\//i.test(u||'') ? u : null;
function ago(iso){ if(!iso) return ''; const d=(Date.now()-Date.parse(iso))/1000; if(!isFinite(d)) return '';
  if(d<3600) return Math.max(1,Math.round(d/60))+'m ago'; if(d<86400) return Math.round(d/3600)+'h ago'; if(d<86400*30) return Math.round(d/86400)+'d ago';
  return new Date(iso).toLocaleDateString('en-US'); }
function sec(title,extra){ const s=el('div','sec'); const h=el('h4',null,title); if(extra) h.appendChild(extra); s.appendChild(h); return s; }
function kv(items){ const g=el('div','kv'); for(const [k,v,cls] of items){ const d=el('div'); d.append(el('div','k',k),el('div','v '+(cls||''),v)); g.appendChild(d); } return g; }
function pts(list){ const u=el('ul','pts'); for(const p of list){ if(!p) continue; const [txt,cls]=Array.isArray(p)?p:[p,'']; u.appendChild(el('li',cls,txt)); } return u; }
function btn(txt,fn,cls){ const b=el('button','btn '+(cls||''),txt); b.onclick=fn; return b; }
function stockSnap(sym){ const u=S.uniMap.get(sym); const s=S.stocks.get(sym)||(u?{sym,price:u.p,chgPct:u.c,vol:u.v,name:u.n}:{}); let price=s.price; if(!ok(price)){ const f=S.flows.find(x=>x.sym===sym); price=f?f.spot:(DEMO?DSPOT[sym]:null); } return {...s,price}; }
const INS_C=new Map(); // contracts opened in the drawer that are neither in the loaded chain nor watched
function contractFor(t,f){
  let c=S.contracts.get(t)||S.trk.get(t)||INS_C.get(t); const pt=parseTicker(t)||{};
  if(!c&&f) c={t,und:f.sym,type:f.cp,strike:f.strike,exp:f.exp,last:f.price,vol:f.vol,oi:f.oi};
  if(!c) c={t,und:pt.und,type:pt.type,strike:pt.strike,exp:pt.exp};
  return c; }
function payoffSvg(c,prem,spot){
  if(!ok(prem)||!ok(c.strike)) return null; const K=c.strike, call=c.type==='C';
  const ref=ok(spot)?spot:K, lo=Math.min(ref,K)*0.82, hi=Math.max(ref,K)*1.18, W=500, H=150, pad=26;
  const pl=x=>((call?Math.max(0,x-K):Math.max(0,K-x))-prem)*100;
  const xs=[...Array(81)].map((_,i)=>lo+(hi-lo)*i/80), ys=xs.map(pl); const ymin=Math.min(...ys), ymax=Math.max(...ys,1);
  const X=x=>pad+(x-lo)/(hi-lo)*(W-2*pad), Y=y=>H-pad-(y-ymin)/(ymax-ymin||1)*(H-2*pad);
  const path=xs.map((x,i)=>(i?'L':'M')+X(x).toFixed(1)+' '+Y(ys[i]).toFixed(1)).join(' ');
  const be=call?K+prem:K-prem;
  let s=`<svg class="payoff" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Profit and loss at expiry">`+
    `<line x1="${pad}" x2="${W-pad}" y1="${Y(0)}" y2="${Y(0)}" stroke="#3a4048" stroke-dasharray="3 3"/>`+
    `<path d="${path}" fill="none" stroke="${call?'#4fd1a1':'#f0716a'}" stroke-width="2"/>`;
  if(be>lo&&be<hi) s+=`<line x1="${X(be)}" x2="${X(be)}" y1="${pad-6}" y2="${H-pad}" stroke="#9fb4ff" stroke-width="1"/><text x="${X(be)+4}" y="${pad}" fill="#9fb4ff" font-size="11">Breakeven ${f2(be)}</text>`;
  if(ok(spot)&&spot>lo&&spot<hi) s+=`<circle cx="${X(spot)}" cy="${Y(pl(spot))}" r="3.5" fill="#e4e6e9"/><text x="${X(spot)+5}" y="${H-pad+16}" fill="#878d96" font-size="11">Spot ${f2(spot)}</text>`;
  s+=`<text x="${pad}" y="${H-6}" fill="#878d96" font-size="11">Max loss ${fMoney(prem*100)}</text></svg>`;
  const d=el('div'); d.innerHTML=s; return d; }

function openInsight(o){ if(!isPro()){ closeMenu(); openGate('insight'); return; } track('insight', o.kind==='stock'?o.sym:String(o.t||'').replace(/^O:/,''));
  closeMenu(); insState=o; const body=$('#insBody'); body.innerHTML='';
  $('#insight').classList.add('on'); $('#overlay').classList.add('on');
  const sym = o.kind==='stock' ? o.sym : (parseTicker(o.t)||{}).und || (o.f&&o.f.sym);
  if(!sym) return;
  const st=stockSnap(sym), symFlows=S.flows.filter(f=>f.sym===sym);
  if(o.kind==='stock') renderStockInsight(body,sym,st,symFlows); else renderContractInsight(body,o,sym,st);
  const newsSec=sec('Related news'); body.appendChild(newsSec); loadNews(sym,newsSec,o);
}
/* ---------- buying vs selling pressure (drawer) ---------- */
// 1) Top of book: best bid and ask with their sizes. Deeper levels are not available on this data feed.
function bookSec(title){ const s=sec(title,el('span','hint','Live')); s.classList.add('book'); const box=el('div'); s.appendChild(box); return {s,box}; }
function paintBook(box,q){ box.replaceChildren();
  if(!ok(q.bid)||!ok(q.ask)){ box.appendChild(el('div','c-muted','No quote right now (the market may be closed).')); return; }
  const bs=ok(q.bidSize)?q.bidSize:0, as=ok(q.askSize)?q.askSize:0, tot=bs+as, bp=tot?bs/tot*100:50;
  const row=el('div','bkrow');
  const L=el('div','bkside b'); L.append(el('span','k','Bid'), el('span','p',f2(q.bid)), el('span','s',tot?`× ${fInt(bs)}`:''));
  const R=el('div','bkside a'); R.append(el('span','s',tot?`${fInt(as)} ×`:''), el('span','p',f2(q.ask)), el('span','k','Ask'));
  row.append(L,R); box.appendChild(row);
  if(tot){ const bar=el('div','bkbar'); const b=el('i','b'), a=el('i','a'); b.style.flexGrow=bp; a.style.flexGrow=100-bp; bar.append(b,a); box.appendChild(bar); }
  const mid=(q.bid+q.ask)/2, spr=q.ask-q.bid, sp=mid?spr/mid*100:null;
  const lean=!tot?'Sizes not available.':bp>=60?`Bid side is heavier: ${Math.round(bp)}% of the size shown is on the bid.`:bp<=40?`Ask side is heavier: ${Math.round(100-bp)}% of the size shown is on the ask.`:'Bid and ask sizes are balanced.';
  box.appendChild(el('div','bknote',`Mid ${f2(mid)} · spread ${q.unit||'$'}${f2(spr)}${ok(sp)?` (${sp.toFixed(sp<1?2:1)}%)`:''}. ${lean}`));
  box.appendChild(el('div','bkfine','Best bid and offer only (top of book). Order book depth is not available on this data feed.')); }
// 2) Where trades printed against the quote, by premium.
const SIDES=[['AA','Above ask','sAA'],['A','At ask','sA'],['M','Mid','sM'],['B','At bid','sB'],['BB','Below bid','sBB']];
function sideBar(label,fl){ const w=el('div','sdw'); const tot=fl.reduce((a,f)=>a+f.prem,0); if(!tot) return null;
  const by={}; for(const f of fl){ const k=by[f.side]||(by[f.side]={prem:0,n:0,qty:0}); k.prem+=f.prem; k.n++; k.qty+=f.size; }
  const buy=((by.AA||{}).prem||0)+((by.A||{}).prem||0), sell=((by.B||{}).prem||0)+((by.BB||{}).prem||0);
  const hd=el('div','sdh'); hd.append(el('b',null,label), el('span',null,`${fMoney(tot)} · ${fInt(fl.length)} trade${fl.length>1?'s':''}`)); w.appendChild(hd);
  const bar=el('div','sdbar'); for(const [k,,cls] of SIDES){ const v=(by[k]||{}).prem||0; if(!v) continue; const i=el('i',cls); i.style.flexGrow=v; i.title=`${SIDE_TXT[k]}: ${fMoney(v)} (${Math.round(v/tot*100)}%)`; bar.appendChild(i); } w.appendChild(bar);
  const lg=el('div','sdlg'); for(const [k,name,cls] of SIDES){ const v=by[k]; if(!v) continue; const it=el('span'); it.append(el('i',cls), document.createTextNode(`${name} ${Math.round(v.prem/tot*100)}%`)); it.title=`${fMoney(v.prem)} · ${fInt(v.qty)} contracts · ${v.n} trades`; lg.appendChild(it); } w.appendChild(lg);
  const bp=Math.round(buy/tot*100), sp=Math.round(sell/tot*100);
  w.appendChild(el('div','sdsum '+(bp-sp>=20?'c-green':sp-bp>=20?'c-red':''), bp-sp>=20?`Buyers aggressive: ${bp}% at or above the ask vs ${sp}% at or below the bid.`:sp-bp>=20?`Sellers aggressive: ${sp}% at or below the bid vs ${bp}% at or above the ask.`:`Balanced: ${bp}% at or above the ask, ${sp}% at or below the bid.`));
  return w; }
// 3) Running net premium through the day: + for buyer-initiated (or upside-leaning) trades, - for seller-initiated (or downside-leaning).
function netFlowSvg(fl,sign){ const pts0=[...fl].sort((a,b)=>a.t-b.t); if(pts0.length<2) return null;
  let cum=0; const P=pts0.map(f=>{ cum+=sign(f)*f.prem; return [f.t,cum]; }); P.unshift([P[0][0]-1,0]);
  const W=480,H=120,pad=6, t0=P[0][0], t1=P[P.length-1][0]||t0+1, vs=P.map(p=>p[1]), lo=Math.min(0,...vs), hi=Math.max(0,...vs), span=hi-lo||1;
  const x=t=>pad+(t-t0)/(t1-t0||1)*(W-2*pad), y=v=>pad+(hi-v)/span*(H-2*pad);
  const d=P.map((p,i)=>(i?'L':'M')+x(p[0]).toFixed(1)+','+y(p[1]).toFixed(1)).join(''), last=P[P.length-1][1], col=last>=0?'var(--call)':'var(--put)';
  const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg'); svg.setAttribute('viewBox',`0 0 ${W} ${H}`); svg.setAttribute('class','netsvg'); svg.setAttribute('role','img');
  svg.setAttribute('aria-label',`Net premium ${last>=0?'+':''}${fMoney(last)} through the day`);
  svg.innerHTML=`<line x1="${pad}" x2="${W-pad}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line2)" stroke-dasharray="3 3"/><path d="${d}L${x(t1)},${y(0)}L${x(t0)},${y(0)}Z" fill="${col}" opacity=".12"/><path d="${d}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round"/>`;
  const w=el('div'); w.appendChild(svg);
  const ax=el('div','netax'); ax.append(el('span',null,fTime(t0+1)), el('span',last>=0?'c-green':'c-red',`${last>=0?'+':''}${fMoney(last)} net`), el('span',null,fTime(t1))); w.appendChild(ax); return w; }
// Keep the quote in the drawer fresh while it is open.
let bookTimer=null;
function liveBook(o,box,get,refresh){ clearInterval(bookTimer); paintBook(box,get());
  if(DEMO) return; const tick=async()=>{ if(insState!==o){ clearInterval(bookTimer); return; } try{ await refresh(); }catch(e){} if(insState===o) paintBook(box,get()); };
  tick(); bookTimer=setInterval(tick,5000); }
function pressureSecs(body,o,fl,opts){
  const s=sec('Buying vs selling'); const note=el('div','bkfine',`Where each trade printed against the bid and ask at that moment. Covers the ${fInt(fl.length)} trade${fl.length===1?'':'s'} seen since you opened the app${CFG.provider==='alpaca'?'; option trades arrive about 15 minutes late on the free feed':''}.`);
  if(!fl.length){ s.appendChild(el('div','c-muted','No trades seen yet today. This fills in as trades print.')); body.appendChild(s); return; }
  for(const [label,list] of opts.bars){ const b=sideBar(label,list); if(b) s.appendChild(b); }
  s.appendChild(note); body.appendChild(s);
  const g=netFlowSvg(fl,opts.sign); if(g){ const n=sec(opts.netTitle); n.appendChild(g); n.appendChild(el('div','bkfine',opts.netNote)); body.appendChild(n); } }

function renderStockInsight(body,sym,st,fl){
  $('#insTitle').textContent=`${sym} · Stock insights`;
  const head=el('div','hd'); head.append(el('span','big',f2(st.price)));
  if(ok(st.chgPct)) head.append(el('span',st.chgPct>=0?'c-green':'c-red',`${st.chg>0?'+':''}${f2(st.chg)} (${fSPct(st.chgPct)})`));
  if(ETFS.has(sym)) head.append(el('span','tag','ETF'));
  const top=sec('Overview'); top.appendChild(head); body.appendChild(top);
  const acts=el('div','acts');
  acts.append(btn('Open chain',()=>{ closeInsight(); view('chain'); load(sym); }),btn('Show in flow',()=>{ P.flow.sym=sym; flowChanged(); closeInsight(); view('flow'); }));
  const inWatch=watchList().includes(sym)&&symSet(P.watch).has(sym);
  acts.append(btn(inWatch?'In watchlist':'Add to watchlist',e=>{ if(inWatch) return; P.watch=[...symSet(P.watch),sym].join(','); wi.value=P.watch; saveP(true); buildStocks(); e.target.textContent='In watchlist'; }));
  top.appendChild(acts);
  let cP=0,pP=0,bull=0,bear=0,unus=0; const byT=new Map();
  for(const f of fl){ if(f.cp==='C') cP+=f.prem; else pP+=f.prem; if(f.bull) bull+=f.prem; if(f.bear) bear+=f.prem; if(f.size>f.oi) unus++;
    const g=byT.get(f.ticker)||{f,n:0,prem:0,ask:0}; g.n++; g.prem+=f.prem; if(f.side==='A'||f.side==='AA') g.ask+=f.prem; byT.set(f.ticker,g); }
  top.appendChild(kv([['Day high',f2(st.high)],['Day low',f2(st.low)],['Volume',fInt(st.vol)],
    ['Call premium',fMoney(cP),'c-green'],['Put premium',fMoney(pP),'c-red'],['Put/call',cP?(pP/cP).toFixed(2):'–']]));
  const bk=bookSec(`${sym} bid / ask`); body.appendChild(bk.s);
  liveBook(insState,bk.box,()=>stockSnap(sym),async()=>{ const j=await massive('v2/snapshot/locale/us/markets/stocks/tickers',{tickers:sym}); (j.tickers||[]).forEach(ingestStock); });
  pressureSecs(body,insState,fl,{bars:[['Calls',fl.filter(f=>f.cp==='C')],['Puts',fl.filter(f=>f.cp==='P')]],
    sign:f=>f.bull?1:f.bear?-1:0, netTitle:'Net upside-leaning premium through the day',
    netNote:'Running total of upside-leaning premium (calls bought at the ask, puts sold at the bid) minus downside-leaning premium (puts bought at the ask, calls sold at the bid).'});
  const ins=sec('Insights'); const L=[];
  const tot=cP+pP;
  if(fl.length){ L.push(`${fInt(fl.length)} option trades today totaling ${fMoney(tot)} in premium; ${Math.round(cP/tot*100)}% of it in calls.`);
    const d=bull+bear?(bull-bear)/(bull+bear):0;
    L.push(d>.15?[`Flow leans to the upside: calls bought at the ask and puts sold at the bid total ${fMoney(bull)}, versus ${fMoney(bear)} the other way.`,'g']:
      d<-.15?[`Flow leans to the downside: puts bought at the ask and calls sold at the bid total ${fMoney(bear)}, versus ${fMoney(bull)} the other way.`,'r']:
      `Flow is balanced: ${fMoney(bull)} upside-leaning vs ${fMoney(bear)} downside-leaning.`);
    const big=fl.reduce((a,b)=>b.prem>a.prem?b:a);
    L.push(`Largest trade: ${fK(big.strike)}${big.cp} ${fExpN(big.exp)}, ${fMoney(big.prem)} (${big.type}, ${SIDE_TXT[big.side]||''}).`);
    if(unus) L.push(`${unus} trade${unus>1?'s were':' was'} larger than the contract's open interest, which can point to new positions being opened.`);
    const rep=[...byT.values()].filter(g=>g.n>=3).sort((a,b)=>b.prem-a.prem)[0];
    if(rep) L.push(`Repeat buying: ${rep.n} trades in the ${fK(rep.f.strike)}${rep.f.cp} ${fExpN(rep.f.exp)}, totaling ${fMoney(rep.prem)}.`);
  } else L.push('No option flow for this stock today.');
  if(DEMO&&EARN[sym]!=null&&EARN[sym]<=30) L.push([`Earnings in about ${EARN[sym]} days (sample data); option prices usually rise ahead of earnings.`,'']);
  ins.appendChild(pts(L)); body.appendChild(ins);
  const topC=[...byT.values()].sort((a,b)=>b.prem-a.prem).slice(0,6);
  if(topC.length){ const s=sec('Most active contracts'); const t=el('table','mini'); t.innerHTML='<thead><tr><th>Contract</th><th class="num">Trades</th><th class="num">Premium</th><th class="num">Ask %</th></tr></thead>';
    const tb=el('tbody'); for(const g of topC){ const tr=el('tr'); tr.append(el('td',g.f.cp==='C'?'c-green':'c-red',`${fK(g.f.strike)}${g.f.cp} ${fExpN(g.f.exp)}`),el('td','num',fInt(g.n)),el('td','num',fMoney(g.prem)),el('td','num',Math.round(g.ask/g.prem*100)+'%'));
      tr.onclick=()=>openInsight({kind:'contract',t:g.f.ticker,f:g.f}); tb.appendChild(tr); } t.appendChild(tb); s.appendChild(t); body.appendChild(s); }
}
function renderContractInsight(body,o,sym,st){
  const c=contractFor(o.t,o.f), spot=ok(uPriceOf(c))?uPriceOf(c):(o.f?o.f.spot:st.price), call=c.type==='C';
  $('#insTitle').textContent=`${sym} ${fK(c.strike)}${c.type} · Contract insights`;
  const fl=S.flows.filter(f=>f.ticker===o.t);
  const price=ok(c.mid)?c.mid:ok(c.last)?c.last:(fl[0]?fl[0].price:null), dte=dteOf(c.exp);
  const be=ok(price)?(call?c.strike+price:c.strike-price):null, beDist=ok(be)&&ok(spot)?(be-spot)/spot*100:null;
  const otm=ok(spot)?(call?(c.strike-spot):(spot-c.strike))/spot*100:null;
  const head=el('div','hd'); head.append(el('span','big',ok(price)?'$'+f2(price):'–'), el('span','tag',call?'Call':'Put'), el('span','tag',fExp(c.exp)+` · ${dte}d`), el('span','tag',`${sym} ${f2(spot)}`));
  const top=sec('Overview'); top.appendChild(head);
  const acts=el('div','acts'); acts.style.marginTop='12px';
  acts.append(btn(isTracked(o.t)?'Remove from watchlist':'Add to watchlist',e=>{ toggleTrack(o.t,c); e.target.textContent=isTracked(o.t)?'Remove from watchlist':'Add to watchlist'; }),
    btn('Open in chain',()=>{ closeInsight(); openInChain(sym,c.exp); }), btn(`${sym} insights`,()=>openInsight({kind:'stock',sym})));
  top.appendChild(acts);
  const vo=volOiOf(c);
  top.appendChild(kv([['Bid / Ask',ok(c.bid)?`${f2(c.bid)} / ${f2(c.ask)}`:'–'],['Spread',fPct(spreadOf(c))],['IV',fIV(c.iv)],
    ['Δ Delta',f3(c.delta)],['Θ Theta',f3(c.theta)],['Vega',f3(c.vega)],
    ['Volume',fInt(c.vol)],['OI',fInt(c.oi)],['Vol/OI',ok(vo)?vo.toFixed(2):'–',ok(vo)&&vo>=1?'c-yellow':''],
    ['Breakeven',ok(be)?f2(be):'–'],['To breakeven',ok(beDist)?fSPct(beDist):'–'],[otm>0?'OTM':'ITM',ok(otm)?fPct(Math.abs(otm)):'–']]));
  body.appendChild(top);
  const bk=bookSec('Bid / ask'); body.appendChild(bk.s);
  liveBook(insState,bk.box,()=>contractFor(o.t,o.f),async()=>{ const j=await getJSON('/api/tracked?c='+encodeURIComponent(o.t)); (j.results||[]).forEach(r=>ingestOption(r,S.contracts.has(o.t)?S.contracts:S.trk.has(o.t)?S.trk:INS_C)); });
  pressureSecs(body,insState,fl,{bars:[['This contract',fl]], sign:f=>f.side==='A'||f.side==='AA'?1:f.side==='B'||f.side==='BB'?-1:0,
    netTitle:'Net buying through the day', netNote:'Running total of premium bought at or above the ask minus premium sold at or below the bid.'});
  const ins=sec('Insights'); const L=[];
  if(ok(otm)) L.push(otm>0?`The contract is ${Math.abs(otm).toFixed(1)}% out of the money; its value is all time and volatility premium.`:`The contract is ${Math.abs(otm).toFixed(1)}% in the money.`);
  if(ok(be)&&ok(beDist)) L.push(`To profit at expiry, ${sym} needs to be ${call?'above':'below'} ${f2(be)} (${fSPct(beDist)} from today).`);
  if(ok(c.delta)) L.push(`Delta ${f2(c.delta)}: a $1 move in the stock changes the contract by about ${fMoney(Math.abs(c.delta)*100)}.`);
  if(ok(c.theta)) L.push(`Time decay is about ${fMoney(Math.abs(c.theta)*100)} per contract per day.`);
  if(dte<=7) L.push([`${dte} day${dte===1?'':'s'} to expiry; the price is very sensitive to both stock moves and time decay.`,'r']);
  if(ok(vo)&&vo>=1) L.push([`Today's volume is ${vo.toFixed(1)}× open interest; new positions may be opening.`,'g']);
  if(fl.length){ const tp=fl.reduce((a,f)=>a+f.prem,0), ask=fl.filter(f=>f.side==='A'||f.side==='AA').reduce((a,f)=>a+f.prem,0), qty=fl.reduce((a,f)=>a+f.size,0);
    const askPct=Math.round(ask/tp*100);
    L.push([`${fl.length} trade${fl.length>1?'s':''} in this contract today: ${fInt(qty)} contracts, ${fMoney(tp)} in premium, average price $${f2(tp/qty/100)}.`,'']);
    L.push(askPct>=60?[`${askPct}% of the premium traded at the ask: buyers are in control.`,'g']:askPct<=40?[`Only ${askPct}% of the premium traded at the ask: sellers are in control.`,'r']:`Buying and selling are balanced (${askPct}% at the ask).`); }
  ins.appendChild(pts(L)); body.appendChild(ins);
  const ps=payoffSvg(c,price,spot); if(ps){ const s=sec('Profit / loss at expiry (1 contract, long)'); s.appendChild(ps); body.appendChild(s); }
  if(fl.length){ const s=sec('Today\'s trades'); const t=el('table','mini'); t.innerHTML='<thead><tr><th>Time</th><th class="num">Size</th><th class="num">Price</th><th>Side</th><th class="num">Premium</th><th>Type</th></tr></thead>';
    const tb=el('tbody'); for(const f of fl.slice(0,12)){ const tr=el('tr'); tr.style.cursor='default'; tr.append(el('td','t-dim',fTime(f.t)),el('td','num',fInt(f.size)),el('td','num','$'+f2(f.price)),el('td','',SIDE_TXT[f.side]||''),el('td','num',fMoney(f.prem)),el('td',TYPE_CLS[f.type]||'',f.type)); tb.appendChild(tr); }
    t.appendChild(tb); s.appendChild(t); body.appendChild(s); }
}
async function loadNews(sym,box,o){
  const skel=()=>{ const d=el('div'); for(let i=0;i<4;i++) d.appendChild(el('div','skel')); return d; };
  const brief=sec('News summary'); brief.appendChild(skel()); box.before(brief); box.appendChild(skel());
  const done=(data)=>{ if(insState!==o) return; renderNews(sym,box,brief,data); };
  if(DEMO_LOCAL()){ done({configured:false,local:true}); return; }
  let e=NEWS.get(sym);
  if(!e||Date.now()-e.at>10*60e3){ e={at:Date.now(),p:getJSON(`/api/news?sym=${encodeURIComponent(sym)}&brief=1`).catch(err=>({error:err.message}))}; NEWS.set(sym,e); }
  done(await e.p);
}
function renderNews(sym,box,brief,d){
  box.querySelectorAll('.skel').forEach(x=>x.remove()); brief.querySelectorAll('div:not(.sec)').forEach(x=>x.remove());
  if(!d||d.configured===false){ brief.remove(); box.appendChild(el('div','c-muted',d&&d.local?'News is off in local preview.':'The news source (Exa) is not connected yet. News will appear here once Exa is connected in the Vercel Marketplace.')); return; }
  if(d.brief&&d.brief.text){ brief.appendChild(el('div','brief',d.brief.text));
    const cs=el('div','cites'); for(const c of d.brief.citations||[]){ const u=safeUrl(c.url); if(!u) continue; const a=el('a',null,c.source||c.title); a.href=u; a.target='_blank'; a.rel='noopener noreferrer'; a.title=c.title||''; cs.appendChild(a); } brief.appendChild(cs);
    const n=el('div','c-muted','Summarized automatically by Exa; it may contain mistakes, check the sources.'); n.style.fontSize='11px'; n.style.marginTop='8px'; brief.appendChild(n); }
  else brief.remove();
  if(d.error&&!(d.articles||[]).length){ box.appendChild(el('div','c-red',d.error)); return; }
  const list=el('div','news'); let n=0;
  for(const a of d.articles||[]){ const u=safeUrl(a.url); if(!u) continue; n++;
    const it=el('a','nitem'); it.href=u; it.target='_blank'; it.rel='noopener noreferrer';
    const src=el('div','src'); const fav=safeUrl(a.favicon); if(fav){ const im=el('img'); im.src=fav; im.alt=''; im.loading='lazy'; im.referrerPolicy='no-referrer'; im.onerror=()=>im.remove(); src.appendChild(im); }
    src.append(el('span',null,a.source||''),el('span',null,a.published?'· '+ago(a.published):''));
    it.append(src,el('div','tt',a.title)); const txt=a.summary||a.highlight; if(txt) it.appendChild(el('div','sm',txt)); list.appendChild(it); }
  box.appendChild(n?list:el('div','c-muted',`No news about ${sym} in the last two weeks.`));
}

/* ---------- wiring ---------- */
window.OSApp={ openSymbol(sym){ track('search',sym); view('chain'); load(sym); } };
$('#searchForm').onsubmit=e=>{ e.preventDefault(); const v=$('#tk').value.trim().toUpperCase(); if(!v) return;
  // Search always opens the symbol (chain); flow filtering by ticker lives in the Filters drawer.
  if(!/^[A-Z][A-Z0-9.]{0,9}$/.test(v)){ note(`"${v}" is not a valid ticker.`,true); return; }
  track('search',v); if(!['chain','screener','tracked'].includes(cur)) view('chain'); load(v); };
$('#expSel').onchange=e=>{ S.selExp=e.target.value; buildChain(true); S.lastCharts=0; if(!DEMO) poll(); };
const wi=$('#watchInp'); wi.value=P.watch;
wi.addEventListener('change',()=>{ P.watch=wi.value||PDEF.watch; saveP(true); buildStocks(); if(!DEMO) fetchStocks().catch(()=>{}); });
$('#bigMin').value=P.bigMin; $('#bigMin').onchange=e=>{ P.bigMin=e.target.value; saveP(); renderFeed(); };
document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&!DEMO){ poll(); S.scrForce=true; S.lastCharts=0; } });

async function init(){
  buildDrawer(); buildFlowHead(); buildScrHead(); buildTrkHead(); fillScr(); updTrkCount();
  if(!DEMO){
    try{ const c=await getJSON('/api/config'); CFG.pollMs=c.pollMs||CFG.pollMs; CFG.provider=c.provider||null;
      if(CFG.provider==='alpaca'){ CFG.strikePct=100; CFG.maxDte=1100; CFG.fullMs=120000; CFG.maxContracts=40000; }
      $('#avatar').textContent=(c.name||c.email||'?').trim()[0].toUpperCase(); $('#acctBtn').title=`${c.email} · Account`;
      CFG.name=c.name; CFG.email=c.email; CFG.billing=c.billing||null; CFG.free=c.free||null; CFG.marketing=!!c.marketing; paintLocks(); paintFree();
      if(c.legal&&!c.legal.accepted) await askConsent();
      if(c.free&&c.free.walled) wallUp(c.free);
      if(c.demo) DEMO=true;
      else if(!c.keyConfigured){ setStatus('error'); note('No market data key is set on the server (ALPACA_KEY_ID / ALPACA_SECRET_KEY).',true); } }
    catch(e){ setStatus('error'); note('Could not read server configuration: '+e.message,true); return; }
    await cloudLoad(); track('session', (navigator.userAgent.match(/(iPhone|iPad|Android|Mac OS X|Windows)/)||[''])[0]);
  }
  paintSaveState(); wi.value=P.watch; stMode(!!P.stAll);
  if(P.defaultPreset&&!P.activePreset) applyPreset(P.defaultPreset);
  renderPresetSel(); flowChanged(); updTrkCount();
  { const v0=P.view||'flow'; view(locked(v0)?'chain':v0); } // free users start on the free chain view
  if(DEMO){ setStatus('demo'); note('Showing sample data: trades, prices and volumes are simulated, not real market data.'); startDemoFlow(); }
  else { setStatus('loading');
    if(CFG.provider==='alpaca'){ S.flowNote=('Flow shows the latest print of each contract for your watchlist and the 20 most active stocks. On the free Alpaca plan option trades arrive about 15 minutes late.'); refreshActive(); S.flowTimers.push(setInterval(refreshActive,300e3)); }
    else S.flowNote=('Live flow is derived from volume changes in your watchlist\'s option chains (approximate; sweeps and splits cannot be told apart).');
    if(cur==='flow') note(S.flowNote);
    S.flowTimers.push(setInterval(liveFlowTick,CFG.provider==='alpaca'?Math.max(4000,CFG.pollMs*1.5):CFG.pollMs)); }
  try{ if(sessionStorage.getItem('os_welcome')){ sessionStorage.removeItem('os_welcome'); note('Welcome to Pro. Everything is unlocked.'); } }catch(e){}
  if(!S.walled) load(P.und);
}
init();
})();
