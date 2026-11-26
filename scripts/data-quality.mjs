// Offline dataset hygiene helpers.
import { buildPool, matchAnswer, distance } from '../js/engine.js';
// Must agree with normalize() in js/engine.js: "C", "C++" and "C#" are three different answers.
export const normalizeDataName = value => { const src = String(value ?? '').trim().toLowerCase(), compact = src.replace(/\s+/g, ''); return /^[a-z](?:\+\+|#)$/.test(compact) ? compact : normalizeCore(src); };
const normalizeCore = value => String(value ?? '').toLowerCase().normalize('NFD')
 .replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss').replace(/ø/g,'o').replace(/æ/g,'ae').replace(/œ/g,'oe').replace(/ł/g,'l').replace(/đ/g,'d')
 .replace(/&/g,' and ').replace(/[^a-z0-9 ]/g,' ').replace(/\b(the|a|an)\b/g,' ').replace(/\s+/g,' ').trim();
export const OFFICIAL_PREFIX=/^(the )?(people's republic of|democratic republic of|federal republic of|islamic republic of|united republic of|socialist republic of|republic of|kingdom of|state of|city of|commonwealth of|federation of|principality of|sultanate of|emirate of|grand duchy of|independent state of)( the)? /i;
const latin = value => /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}]+$/u.test(value);
const slug = value => normalizeDataName(value).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

export const ALIAS_CAP=25;
/** Order aliases so the ones a player is most likely to type survive the cap:
 *  1) the label with a formal prefix removed ("China" for "People's Republic of China"),
 *  2) aliases built from words of the label, 3) short plain-ASCII aliases, 4) everything else. */
export function rankAliases(label,list){
 const L=normalizeDataName(label),Lw=new Set(L.split(' ')),score=a=>{
  const k=normalizeDataName(a),w=k.split(' ');
  let sc=0;
  if(L.endsWith(' '+k)||L.startsWith(k+' '))sc-=100;
  else if(w.every(x=>Lw.has(x)))sc-=60;
  if(/^[\x20-\x7e]+$/.test(a))sc-=20;
  if(k.length<3)sc+=25;           // "cn", "tw": real but easy to hit by accident, keep after the good ones
  sc+=w.length*2+Math.min(40,k.length)/4;
  return sc;};
 return [...list].sort((x,y)=>score(x)-score(y)||x.localeCompare(y));
}
export function cleanPool(items, entry = {}, blocklist = {qids:[],words:[]}) {
 const rejected={invalid:0,blocked:0,duplicate:0,wrongClass:0}, ids=new Set(blocklist.qids||[]), words=(blocklist.words||[]).map(x=>String(x).toLowerCase()), byName=new Map();
 for(const item of items||[]){
  const n=String(item?.n||'').trim(), invalid=!n||n.length>60||/^Q\d+$/.test(n)||/^\d{1,4}$/.test(n)||/^(list of|category:|template:)/i.test(n)||/https?:\/\//i.test(n)||/[<>]/.test(n);
  if(invalid){rejected.invalid++;continue;}
  if(ids.has(item.id)||words.some(w=>w&&n.toLowerCase().includes(w))){rejected.blocked++;continue;}
  const key=normalizeDataName(n);if(!key){rejected.invalid++;continue;}
  const old=byName.get(key);if(old){rejected.duplicate++;if((+item.s||0)>(+old.s||0))byName.set(key,item);}else byName.set(key,item);
 }
 const clean=[...byName.values()].sort((a,b)=>(+b.s||0)-(+a.s||0)||a.n.localeCompare(b.n));
 const surnameCount=new Map();
 if(entry.people)for(const item of clean){const p=normalizeDataName(item.n).split(' ');if(p.length>1)surnameCount.set(p.at(-1),(surnameCount.get(p.at(-1))||0)+1);}
 const candidates=new Map(), add=(item,value)=>{const a=String(value||'').trim();if(!a||a.length>60||!latin(a))return;const k=normalizeDataName(a);if(!k||k===normalizeDataName(item.n))return;if(!candidates.has(k))candidates.set(k,[]);candidates.get(k).push({item,a});};
 for(const item of clean){
  for(const a of item.a||[])add(item,a);
  if(entry.people){const p=normalizeDataName(item.n).split(' '),last=p.at(-1);if(p.length>1&&last.length>=4&&surnameCount.get(last)===1)add(item,last);if(p.length>2)add(item,p[0]+' '+last);}
  if(/geography|place/i.test(entry.cat||'')){add(item,item.n.replace(OFFICIAL_PREFIX,'').replace(/, (United States|United Kingdom|Canada|Australia|India|Germany|France)$/i,''));add(item,item.n.replace(OFFICIAL_PREFIX,'').replace(/ (city|municipality)$/i,''));}
  if(/film|literature|music/i.test(entry.cat||''))add(item,item.n.replace(/^(the|a|an) /i,'').replace(/[:–—-].*$/,'').replace(/&/g,'and'));
 }
 const primary=new Set(clean.map(i=>normalizeDataName(i.n))), aliases=new Map(clean.map(i=>[i.id,[]]));
 for(const [key,rows] of candidates){if(primary.has(key))continue;const unique=[...new Map(rows.map(r=>[r.item.id,r])).values()].sort((a,b)=>(+b.item.s||0)-(+a.item.s||0));if(unique.length>1&&(+unique[0].item.s||0)<3*Math.max(1,+unique[1].item.s||0))continue;const win=unique[0];if(win&&!aliases.get(win.item.id).includes(win.a))aliases.get(win.item.id).push(win.a);}
 return {items:clean.map(i=>({...i,a:rankAliases(i.n,[...new Set(aliases.get(i.id)||[])]).slice(0,ALIAS_CAP)})),rejected};
}
/** Default popularity for a hand-added answer: top ~3% of its pool, so a famous answer scores as famous. */
export function famousSitelinks(items){
 if(!items.length)return 100;
 const sorted=items.map(i=>+i.s||0).sort((x,y)=>y-x);return Math.max(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*0.03))],10);
}
/** data/overrides.json, applied last. Per prompt id:
 *  add: [{n,s?,a?,id?}]   remove: [qid]   removeNames: [label]   aliasAdd: {qid:[alias]}   aliasByName: {label:[alias]}
 *  An added answer whose name already exists only merges its aliases (no duplicates). */
export function applyOverrides(id,items,overrides={}){
 const rule=overrides[id]||{},removed=new Set(rule.remove||[]),removedNames=new Set((rule.removeNames||[]).map(normalizeDataName));
 const list=items.filter(i=>!removed.has(i.id)&&!removedNames.has(normalizeDataName(i.n))).map(i=>({...i,a:[...(i.a||[])]}));
 const byName=new Map(list.map(i=>[normalizeDataName(i.n),i])),byId=new Map(list.map(i=>[i.id,i])),fam=famousSitelinks(list);
 for(const add of rule.add||[]){
  if(!add?.n)continue;const key=normalizeDataName(add.n),have=byName.get(key);
  if(have){have.a=[...new Set([...have.a,...(add.a||[])])];if(add.s&&+add.s>(+have.s||0))have.s=+add.s;continue;}
  const item={id:add.id||'manual:'+id+':'+slug(add.n),n:String(add.n).trim(),s:Number(add.s)||fam,a:[...(add.a||[])]};
  list.push(item);byName.set(key,item);byId.set(item.id,item);
 }
 for(const [qid,more] of Object.entries(rule.aliasAdd||{})){const item=byId.get(qid);if(item)item.a=[...new Set([...item.a,...more])];}
 for(const [label,more] of Object.entries(rule.aliasByName||{})){const item=byName.get(normalizeDataName(label));if(item)item.a=[...new Set([...item.a,...more])];}
 for(const i of list)i.a=rankAliases(i.n,[...new Set(i.a)]).slice(0,ALIAS_CAP+8);
 return list.sort((a,b)=>(+b.s||0)-(+a.s||0)||a.n.localeCompare(b.n));
}
/** Run an anchor through the REAL game matcher: it must be an exact hit on a pool built exactly like the game builds it. */
export function checkAnchors(items,rule={}){
 const pool=buildPool(items.map(i=>({id:i.id,n:i.n,a:i.a||[],s:i.s||0})),{people:Boolean(rule.people)});
 const missing=[],forbidden=[];
 for(const x of rule.anchors||[]){const m=matchAnswer(x,pool);if(!m||!m.exact)missing.push(x);}
 for(const x of rule.mustNot||[]){const m=matchAnswer(x,pool);if(m&&m.exact)forbidden.push(x);}
 return {missing,forbidden};
}
/** Guarantee: every anchor ends up as an exact match. A missing one is added as its own answer and REPORTED, because a missing anchor means the Wikidata class pattern is too narrow. */
export function ensureAnchors(items,rule={},id='x'){
 const {missing}=checkAnchors(items,rule),injected=[],list=items.map(i=>({...i,a:[...(i.a||[])]}));
 if(list.length<8)return {items:list,injected};
 const fam=famousSitelinks(list);
 const pool=buildPool(list.map(i=>({id:i.id,n:i.n,a:i.a,s:+i.s||0})));
 for(const x of missing){
  const key=normalizeDataName(x);if(!key)continue;
  // The game already finds it by a partial name or spelling ("Pope John Paul II" -> John Paul II): add it as an alias
  // of that answer so it is an exact hit, instead of storing the same answer twice.
  const near=matchAnswer(x,pool),target=near&&list.find(i=>i.id===near.item.id);
  if(target){if(!target.a.includes(x))target.a.unshift(x);injected.push({anchor:x,as:'alias of '+target.n});continue;}
  list.push({id:'manual:'+id+':'+slug(x),n:x,s:fam,a:[]});injected.push({anchor:x,as:'new answer'});
 }
 for(const x of rule.mustNot||[]){const k=normalizeDataName(x);const i=list.findIndex(y=>normalizeDataName(y.n)===k);if(i>=0)list.splice(i,1);}
 list.sort((a,b)=>(+b.s||0)-(+a.s||0)||a.n.localeCompare(b.n));
 return {items:list,injected};
}
export function meaningfulChange(oldItems,nextItems){
 if(!oldItems?.length)return nextItems.length>0;const oldIds=new Set(oldItems.map(i=>i.id)),newIds=new Set(nextItems.map(i=>i.id));
 if([...newIds].some(x=>!oldIds.has(x))||[...oldIds].some(x=>!newIds.has(x)))return true;
 const rank=new Map(oldItems.map((i,n)=>[i.id,n])),moved=nextItems.filter((i,n)=>Math.abs((rank.get(i.id)??n)-n)>10).length;
 return moved/Math.max(1,nextItems.length)>0.02;
}
