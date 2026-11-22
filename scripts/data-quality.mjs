// Offline dataset hygiene helpers.
export const normalizeDataName = value => String(value ?? '').toLowerCase().normalize('NFD')
 .replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss').replace(/ø/g,'o').replace(/æ/g,'ae').replace(/œ/g,'oe').replace(/ł/g,'l').replace(/đ/g,'d')
 .replace(/&/g,' and ').replace(/[^a-z0-9 ]/g,' ').replace(/\b(the|a|an)\b/g,' ').replace(/\s+/g,' ').trim();
const latin = value => /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}]+$/u.test(value);
const slug = value => normalizeDataName(value).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

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
  if(/geography|place/i.test(entry.cat||''))add(item,item.n.replace(/^(city of|republic of|kingdom of|state of) /i,'').replace(/, (United States|United Kingdom|Canada|Australia|India|Germany|France)$/i,''));
  if(/film|literature|music/i.test(entry.cat||''))add(item,item.n.replace(/^(the|a|an) /i,'').replace(/[:–—-].*$/,'').replace(/&/g,'and'));
 }
 const primary=new Set(clean.map(i=>normalizeDataName(i.n))), aliases=new Map(clean.map(i=>[i.id,[]]));
 for(const [key,rows] of candidates){if(primary.has(key))continue;const unique=[...new Map(rows.map(r=>[r.item.id,r])).values()].sort((a,b)=>(+b.item.s||0)-(+a.item.s||0));if(unique.length>1&&(+unique[0].item.s||0)<3*Math.max(1,+unique[1].item.s||0))continue;const win=unique[0];if(win&&!aliases.get(win.item.id).includes(win.a))aliases.get(win.item.id).push(win.a);}
 return {items:clean.map(i=>({...i,a:[...new Set([...(i.a||[]).filter(latin),...(aliases.get(i.id)||[])])].slice(0,40)})),rejected};
}
export function applyOverrides(id,items,overrides={}){
 const rule=overrides[id]||{}, removed=new Set(rule.remove||[]), byId=new Map(items.filter(i=>!removed.has(i.id)).map(i=>[i.id,{...i,a:[...(i.a||[])]}]));
 for(const add of rule.add||[]){if(!add?.n)continue;const key=add.id||'manual:'+id+':'+slug(add.n);byId.set(key,{id:key,n:String(add.n).trim(),s:Number(add.s)||0,a:add.a||[]});}
 for(const [qid,list] of Object.entries(rule.aliasAdd||{})){const item=byId.get(qid);if(item)item.a=[...new Set([...item.a,...list])];}
 return [...byId.values()].sort((a,b)=>(+b.s||0)-(+a.s||0)||a.n.localeCompare(b.n));
}
export function meaningfulChange(oldItems,nextItems){
 if(!oldItems?.length)return nextItems.length>0;const oldIds=new Set(oldItems.map(i=>i.id)),newIds=new Set(nextItems.map(i=>i.id));
 if([...newIds].some(x=>!oldIds.has(x))||[...oldIds].some(x=>!newIds.has(x)))return true;
 const rank=new Map(oldItems.map((i,n)=>[i.id,n])),moved=nextItems.filter((i,n)=>Math.abs((rank.get(i.id)??n)-n)>10).length;
 return moved/Math.max(1,nextItems.length)>0.02;
}
