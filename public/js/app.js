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
  let r; try{ r=await fetch(u,{credentials:'same-origin',cache:'no-store'}); }catch(e){ throw new Error('Could not reach the server'); }
  if(r.status===401){ location.href='/login?next='+encodeURIComponent(location.pathname+location.search); throw new Error('Session expired'); }
  if(!r.ok){ let m=r.statusText; try{ const j=await r.json(); m=j.message||j.error||m; }catch(e){} if(r.status===403) m+=' (your data plan may not include this)'; throw new Error(`${r.status}: ${m}`); }
  return r.json();
}
function massive(path,params){ const u=new URL('/api/massive',location.origin); u.searchParams.set('path',path);
  if(params) for(const [k,v] of Object.entries(params)) if(v!==''&&v!=null) u.searchParams.set(k,v); return getJSON(u); }
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
  set('bid',q.bid); set('ask',q.ask); set('mid',q.midpoint ?? ((q.bid!=null&&q.ask!=null)?(q.bid+q.ask)/2:null)); set('last',tr.price ?? day.close);
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
  if(ok(pd.c)) s.prev=pd.c; if(ok(lq.p)) s.bid=lq.p; if(ok(lq.P)) s.ask=lq.P;
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
  const F=P.flow; FILTERED=S.flows.filter(f=>passFlow(f,F));
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
  const sent=score>.1?'Bullish':score<-.1?'Bearish':'Neutral', scol=score>.1?'var(--call)':score<-.1?'var(--put)':'var(--text)';
  const pc=cP?pP/cP:null;
  $('#stats').innerHTML=
    `<div class="card"><div class="k">Flow sentiment</div><div class="v" style="color:${scol}">${sent}</div><div class="meter"><b style="left:${((score+1)/2*100).toFixed(1)}%"></b></div><div class="s">${fMoney(bull)} bullish, ${fMoney(bear)} bearish</div></div>`+
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
    {k:'dir',l:'Sentiment',type:'select',o:[['any','Any'],['bull','Bullish (calls bought / puts sold)'],['bear','Bearish (puts bought / calls sold)']]},
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
  if(scroll){ const a=S.chainRows.find(r=>r.tr.classList.contains('atm')), w=$('#chainWrap'); if(a) w.scrollTop=Math.max(0,a.tr.offsetTop-w.clientHeight/2); }
}
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
const VTITLE={flow:'Options flow',chain:'Option chain',screener:'Contract screener',tracked:'My watchlist',stocks:'Stocks',charts:'Charts'};
/* ---------- plan (Pro via Paddle) ---------- */
const PRO_VIEWS=new Set(['flow','screener','charts']);
const isPro = () => !CFG.billing || !CFG.billing.paywall || CFG.billing.plan==='pro';
const locked = v => PRO_VIEWS.has(v) && !isPro();
function paintLocks(){ document.querySelectorAll('.rail [data-view]').forEach(b=>b.classList.toggle('lock',locked(b.dataset.view)));
  $('#acctBtn').classList.toggle('pro',!!(CFG.billing&&CFG.billing.plan==='pro')); }
function showPro(what){ $('#proTitle').textContent=`${what} ${what.endsWith('s')?'are':'is'} part of Pro`; $('#proErr').textContent='';
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('on',s.id==='v-pro')); $('#app').classList.add('nofeed'); $('#openFilters').style.display='none'; }
let paddleReady=null;
function loadPaddle(){ if(paddleReady) return paddleReady; const b=CFG.billing.paddle;
  paddleReady=new Promise((res,rej)=>{ const sc=document.createElement('script'); sc.src='https://cdn.paddle.com/paddle/v2/paddle.js'; sc.onerror=()=>{ paddleReady=null; rej(new Error('Could not load checkout')); };
    sc.onload=()=>{ try{ if(b.env==='sandbox') Paddle.Environment.set('sandbox');
      Paddle.Initialize({ token:b.token, eventCallback:e=>{ if(e&&e.name==='checkout.completed') afterCheckout(); } }); res(); }catch(e){ rej(e); } };
    document.head.appendChild(sc); }); return paddleReady; }
async function upgrade(){ const b=CFG.billing; if(!b||!b.paddle){ note('Payments are not set up yet.',true); return; }
  track('view','Upgrade'); $('#proBuy').disabled=true;
  try{ await loadPaddle(); Paddle.Checkout.open({ items:[{priceId:b.paddle.priceId,quantity:1}], customer:{email:b.paddle.customData.email}, customData:b.paddle.customData,
      settings:{ displayMode:'overlay', theme:'dark', locale:'en', allowLogout:false } }); }
  catch(e){ $('#proErr').textContent='Checkout could not open: '+e.message; } finally{ $('#proBuy').disabled=false; } }
async function afterCheckout(){ note('Payment received. Activating Pro…');
  for(let i=0;i<30;i++){ await new Promise(r=>setTimeout(r,2000));
    try{ const b=await getJSON('/api/billing?a=status'); if(b.plan==='pro'){ CFG.billing=b; paintLocks(); note('Welcome to Pro. Everything is unlocked.'); view(P.view==='chain'?'flow':P.view); return; } }catch(e){} }
  note('Payment received, but activation is taking longer than usual. Refresh the page in a minute.',true); }
let amenu=null;
function closeAcct(){ if(amenu){ amenu.remove(); amenu=null; } }
function openAcct(){ closeAcct(); const b=CFG.billing||{}; amenu=el('div','amenu'); amenu.setAttribute('role','menu');
  const who=el('div','who'); who.append(el('b',null,CFG.name||CFG.email||''),el('span',null,CFG.name?CFG.email:''));
  if(b.configured){ const pro=b.plan==='pro'; const tag=el('span','plan'+(pro?' pro':''),pro?(b.status==='admin'?'Pro (admin)':'Pro'):'Free plan');
    if(pro&&b.cancelAt) tag.textContent+=` · ends ${new Date(b.cancelAt).toLocaleDateString('en-US')}`; else if(pro&&b.nextBill) tag.textContent+=` · renews ${new Date(b.nextBill).toLocaleDateString('en-US')}`;
    who.append(el('br'),tag); }
  amenu.append(who);
  if(b.configured&&b.plan!=='pro'){ const u=el('button',null,'Upgrade to Pro · $9.99/month'); u.onclick=()=>{ closeAcct(); showPro('Pro features'); upgrade(); }; amenu.append(u); }
  if(b.configured&&b.plan==='pro'&&b.status==='admin'&&b.paddle&&b.paddle.env==='sandbox'){ const t=el('button',null,'Test checkout (sandbox, no real charge)'); t.onclick=()=>{ closeAcct(); upgrade(); }; amenu.append(t); }
  if(b.canManage){ const m=el('a',null,'Manage subscription and card'); m.href='/api/billing?a=portal'; m.target='_blank'; m.rel='noopener'; amenu.append(m); }
  const o=el('a',null,'Sign out'); o.href='/api/auth/logout'; amenu.append(o);
  document.body.appendChild(amenu); }
$('#acctBtn').onclick=e=>{ e.stopPropagation(); amenu?closeAcct():openAcct(); };
document.addEventListener('click',e=>{ if(amenu&&!amenu.contains(e.target)) closeAcct(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeAcct(); });
$('#proBuy').onclick=upgrade;
let cur='flow';
function view(v){ if(cur!==v) track('view',VTITLE[v]||v); cur=v; P.view=v; saveP(); document.querySelectorAll('.rail [data-view]').forEach(b=>b.classList.toggle('on',b.dataset.view===v));
  $('#vtitle').textContent=VTITLE[v]; if(locked(v)){ showPro(VTITLE[v]); return; }
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('on',s.id==='v-'+v)); $('#vtitle').textContent=VTITLE[v];
  $('#app').classList.toggle('nofeed',v!=='flow'); $('#openFilters').style.display=v==='flow'?'':'none';
  if(v==='screener') S.scrForce=true; if(v==='charts') S.lastCharts=0; if(v==='tracked') S.trkForce=true; if(v==='flow') S.flowDirty=true; if(v==='chain') renderUStats(); }
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
  if(DEMO||S.polling) return; if(document.hidden){ setStatus('paused','Paused in background'); return; }
  S.polling=true; const gen=S.gen;
  const jobs=[fetchStocks(), S.selExp?fetchChain(S.selExp).then(r=>{ if(gen===S.gen) r.forEach(x=>ingestOption(x,S.contracts)); }):Promise.resolve(), fetchTracked()];
  const res=await Promise.allSettled(jobs); S.polling=false; if(gen!==S.gen) return;
  const err=res.find(r=>r.status==='rejected');
  if(err&&res.every(r=>r.status==='rejected')){ S.fails++; setStatus('error'); if(S.fails>2) note('Cannot load data: '+err.reason.message,true); return; }
  S.fails=0; S.lastUpd=Date.now(); setStatus(S.delayed?'delayed':'live');
  if(err) note('Some data could not be loaded: '+err.reason.message,true);
  if(expiries().length!==$('#expSel').options.length) buildExpSel(); }
async function fullRefresh(){ if(DEMO||S.loadingFull||document.hidden) return; S.loadingFull=true; const gen=S.gen;
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

/* ---------- load an underlying (chain / screener) ---------- */
async function load(und){
  und=(und||'').trim().toUpperCase(); if(!und) return;
  S.gen++; const gen=S.gen; S.timers.forEach(clearInterval); S.timers=[];
  S.und=und; P.und=und; saveP(); track('chain',und); $('#tk').value='';
  S.contracts.clear(); S.dirty.clear(); S.scrRows.clear(); $('#scrBody').innerHTML=''; S.scrTop=[]; S.selExp=null;
  S.uPrice=null; S.uChg=null; S.uChgPct=null; S.delayed=null; S.optT=0;
  buildStocks(); S.trkForce=true;
  if(DEMO){ S.uPrice=DSPOT[und]||UNIV[und]||100+Math.random()*200; startDemoChain(); takePending(); buildExpSel(); buildChain(true); S.scrForce=true; buildStocks(); return; }
  $('#chainBody').innerHTML='<tr><td colspan="17" class="empty">Loading…</td></tr>';
  try{
    try{ await fetchStocks(); }catch(e){ note('Could not load stock data: '+e.message,true); }
    if(!ok(S.uPrice)){ try{ const j=await massive(`v2/aggs/ticker/${und}/prev`); const b=j.results&&j.results[0]; if(b) S.uPrice=b.c; }catch(e){} }
    const res=await fetchChain(); if(gen!==S.gen) return; res.forEach(x=>ingestOption(x,S.contracts));
    if(!res.length) note(`No options found for ${und}.`,true);
    S.lastUpd=Date.now(); setStatus(S.delayed?'delayed':'live');
  }catch(e){ if(gen!==S.gen) return; setStatus('error'); note('Could not load data: '+e.message,true); $('#chainBody').innerHTML='<tr><td colspan="17" class="empty">No data</td></tr>'; return; }
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
function closeInsight(){ $('#insight').classList.remove('on'); if(!$('#drawer').classList.contains('on')) $('#overlay').classList.remove('on'); insState=null; }
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
function contractFor(t,f){
  let c=S.contracts.get(t)||S.trk.get(t); const pt=parseTicker(t)||{};
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

function openInsight(o){ if(!isPro()){ closeMenu(); showPro('Insights'); $('#vtitle').textContent='Insights'; return; } track('insight', o.kind==='stock'?o.sym:String(o.t||'').replace(/^O:/,''));
  closeMenu(); insState=o; const body=$('#insBody'); body.innerHTML='';
  $('#insight').classList.add('on'); $('#overlay').classList.add('on');
  const sym = o.kind==='stock' ? o.sym : (parseTicker(o.t)||{}).und || (o.f&&o.f.sym);
  if(!sym) return;
  const st=stockSnap(sym), symFlows=S.flows.filter(f=>f.sym===sym);
  if(o.kind==='stock') renderStockInsight(body,sym,st,symFlows); else renderContractInsight(body,o,sym,st);
  const newsSec=sec('Related news'); body.appendChild(newsSec); loadNews(sym,newsSec,o);
}
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
  const ins=sec('Insights'); const L=[];
  const tot=cP+pP;
  if(fl.length){ L.push(`${fInt(fl.length)} option trades today totaling ${fMoney(tot)} in premium; ${Math.round(cP/tot*100)}% of it in calls.`);
    const d=bull+bear?(bull-bear)/(bull+bear):0;
    L.push(d>.15?[`Flow leans bullish: calls bought at the ask and puts sold at the bid total ${fMoney(bull)}, versus ${fMoney(bear)} the other way.`,'g']:
      d<-.15?[`Flow leans bearish: puts bought at the ask and calls sold at the bid total ${fMoney(bear)}, versus ${fMoney(bull)} the other way.`,'r']:
      `Flow is balanced: ${fMoney(bull)} bullish vs ${fMoney(bear)} bearish.`);
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
      CFG.name=c.name; CFG.email=c.email; CFG.billing=c.billing||null; paintLocks();
      if(c.demo) DEMO=true;
      else if(!c.keyConfigured){ setStatus('error'); note('No market data key is set on the server (ALPACA_KEY_ID / ALPACA_SECRET_KEY).',true); } }
    catch(e){ setStatus('error'); note('Could not read server configuration: '+e.message,true); return; }
    await cloudLoad(); track('session', (navigator.userAgent.match(/(iPhone|iPad|Android|Mac OS X|Windows)/)||[''])[0]);
  }
  paintSaveState(); wi.value=P.watch; stMode(!!P.stAll);
  if(P.defaultPreset&&!P.activePreset) applyPreset(P.defaultPreset);
  renderPresetSel(); flowChanged(); updTrkCount();
  view(P.view||'flow');
  if(DEMO){ setStatus('demo'); note('Showing sample data: trades, prices and volumes are simulated, not real market data.'); startDemoFlow(); }
  else { setStatus('loading');
    if(CFG.provider==='alpaca'){ note('Flow shows the latest print of each contract for your watchlist and the 20 most active stocks. On the free Alpaca plan option trades arrive about 15 minutes late.'); refreshActive(); S.flowTimers.push(setInterval(refreshActive,300e3)); }
    else note('Live flow is derived from volume changes in your watchlist\'s option chains (approximate; sweeps and splits cannot be told apart).');
    S.flowTimers.push(setInterval(liveFlowTick,CFG.provider==='alpaca'?Math.max(4000,CFG.pollMs*1.5):CFG.pollMs)); }
  load(P.und);
}
init();
})();
