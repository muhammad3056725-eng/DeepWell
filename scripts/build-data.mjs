#!/usr/bin/env node
// Polite, resumable, popularity-banded Wikidata pack builder.
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CATALOG, ENTITY_LABELS, entityIdsOf } from '../js/catalog.js';
import { buildQuery, buildLabelQuery, parseBindings, queryUrl, toPack, fromPack, mergePools } from '../js/wikidata.js';
import { cleanPool, applyOverrides, meaningfulChange, normalizeDataName } from './data-quality.mjs';
const args=process.argv.slice(2),flag=n=>args.includes('--'+n),opt=(n,d)=>{const i=args.indexOf('--'+n);return i>=0?args[i+1]:d;};
const OUT=path.resolve(opt('out','data/packs')),MANIFEST=path.resolve(opt('manifest','data/manifest.json')),ONLY=opt('only')?new Set(opt('only').split(',')):null,BATCH=opt('batch');
const BATCH_SIZE=Math.max(1,parseInt(opt('batch-size','500'),10)||500),CANDIDATE_OFFSET=Math.max(0,parseInt(opt('candidate-offset','0'),10)||0);
const ENDPOINT='https://query.wikidata.org/sparql',UA='DeepwellDatasetBuilder/3.0 (https://deepwell.games; static trivia data maintenance)';
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),sha=v=>createHash('sha256').update(v).digest('hex');
const BANDS=[{min:200},{min:100,max:199},{min:60,max:99},{min:40,max:59},{min:25,max:39},{min:15,max:24},{min:10,max:14},{min:6,max:9},{min:4,max:5},{min:3,max:3},{min:2,max:2},{min:1,max:1}];
function retryDelay(value,attempt){if(!value)return 8000*attempt;const n=Number(value);if(Number.isFinite(n))return Math.max(1000,n*1000);const d=Date.parse(value);return Number.isFinite(d)?Math.max(1000,d-Date.now()):8000*attempt;}
async function sparql(query,tries=4){
 for(let t=1;t<=tries;t++){const c=new AbortController(),timer=setTimeout(()=>c.abort(),55000);try{
  const r=await fetch(queryUrl(ENDPOINT,query).replace('&origin=*',''),{signal:c.signal,headers:{Accept:'application/sparql-results+json','User-Agent':UA}});clearTimeout(timer);
  if(r.status===429||r.status>=500){await sleep(retryDelay(r.headers.get('retry-after'),t));continue;}if(!r.ok)throw new Error('Wikidata HTTP '+r.status);return await r.json();
 }catch(e){clearTimeout(timer);if(t===tries)throw e;await sleep(4000*t);}}
 throw new Error('Wikidata retry limit reached');
}
async function readJson(file,fallback){try{return JSON.parse(await readFile(file,'utf8'));}catch{return fallback;}}
async function verifyIds(){const ids=[...ENTITY_LABELS.keys()],labels=new Map();for(let i=0;i<ids.length;i+=80){const j=await sparql(buildLabelQuery(ids.slice(i,i+80)));for(const b of j.results.bindings)labels.set(b.q.value.split('/').pop(),b.l.value.toLowerCase());if(i+80<ids.length)await sleep(1500);}const bad=new Set();for(const [q,e] of ENTITY_LABELS){const a=labels.get(q);if(!a||!(a.includes(e)||e.includes(a))){bad.add(q);console.warn('Q-id mismatch',q,'expected',e,'got',a||'(missing)');}}return bad;}
async function buildBands(entry){
 const target=Math.max(1,Math.min(Number(entry.target??entry.answerLimit)||2000,2000)),floor=Math.max(1,Number(entry.floor??2),Number(entry.minSL??1)),merged=new Map(),errors=[];
 const accept=rows=>{for(const x of rows){const old=merged.get(x.id);if(!old)merged.set(x.id,x);else{old.s=Math.max(old.s,x.s);old.a=[...new Set([...old.a,...x.a])];}}};
 for(const band of BANDS){if(band.min<floor||merged.size>=target)continue;try{
  const j=await sparql(buildQuery(entry,{limit:5000,minSL:Math.max(floor,band.min),maxSL:band.max,target,offset:CANDIDATE_OFFSET}));accept(parseBindings(j,entry));
 }catch(e){errors.push({band,message:e.message});for(const letter of 'abcdefghijklmnopqrstuvwxyz'){if(merged.size>=target)break;const j=await sparql(buildQuery(entry,{limit:5000,minSL:Math.max(floor,band.min),maxSL:band.max,target,offset:CANDIDATE_OFFSET,startsWith:letter}));accept(parseBindings(j,{...entry,startsWith:letter}));await sleep(1500);}}
 await sleep(1500);}
 return {items:[...merged.values()].sort((a,b)=>b.s-a.s).slice(0,target),errors};
}
async function main(){
 await mkdir(OUT,{recursive:true});console.log(`Catalog ${CATALOG.length}; validating ${ENTITY_LABELS.size} registered Q-ids`);
 const bad=await verifyIds();if(flag('verify-only'))process.exit(bad.size?1:0);
 const manifest=await readJson(MANIFEST,{version:0,built:null,packs:{}}),overrides=await readJson('data/overrides.json',{}),blocklist=await readJson('data/blocklist.json',{qids:[],words:[]}),anchors=await readJson('data/anchors.json',{});
 for(const meta of Object.values(manifest.packs))if(meta.quality){meta.quality.added=0;meta.quality.removed=0;meta.quality.fallback=false;meta.quality.querySplitFallback=false;}
 const report={skipped:[],failed:[],built:0,unchanged:0,fallback:[],previousRetained:[],rejected:{}},today=new Date().toISOString().slice(0,10);
 const all=CATALOG.filter(e=>!ONLY||ONLY.has(e.id));let todo=all;if(BATCH!==undefined&&BATCH!=='all'){const b=parseInt(BATCH,10);if(!Number.isInteger(b)||b<0)throw new Error('Invalid batch index');todo=all.slice(b*BATCH_SIZE,(b+1)*BATCH_SIZE);}
 if(!todo.length){console.log('No prompts in this batch.');return;}
 for(let i=0;i<todo.length;i++){const e=todo[i],tag=`[${i+1}/${todo.length}] ${e.id}`;if(entityIdsOf(e).some(q=>bad.has(q))){report.skipped.push(e.id+' (bad registered Q-id)');continue;}
  const meta=manifest.packs[e.id];if(flag('resume')&&meta?.built&&(Date.parse(today)-Date.parse(meta.built))<6*864e5){report.skipped.push(e.id+' (fresh resume)');continue;}
  const file=path.join(OUT,e.id+'.json');let hadPrevious=false;try{
   const oldPack=await readJson(file,null),old=oldPack?fromPack(oldPack):[],fresh=await buildBands(e);hadPrevious=Boolean(oldPack);
   const merged=mergePools(old,fresh.items,{...e,target:e.target??e.answerLimit??2000}),cleaned=cleanPool(merged,e,blocklist);
   const items=applyOverrides(e.id,cleaned.items,overrides).slice(0,e.target??e.answerLimit??2000),min=Math.min(e.minPool||20,8);
   if(items.length<min){report.skipped.push(e.id+' (pool too small; previous retained)');continue;}
   const rule=anchors[e.id]||{},must=rule.mustNot||e.mustNot||[],required=rule.anchors||e.anchors||[],keys=new Set(items.flatMap(x=>[x.n,...(x.a||[])]).map(x=>normalizeDataName(x)));
   const missing=required.filter(x=>!keys.has(normalizeDataName(x))),forbidden=must.filter(x=>keys.has(normalizeDataName(x)));
   if(missing.length||forbidden.length){
     const previousKeys=new Set(old.flatMap(x=>[x.n,...(x.a||[])]).map(x=>normalizeDataName(x)));
     const previousSafe=!required.some(x=>!previousKeys.has(normalizeDataName(x)))&&!must.some(x=>previousKeys.has(normalizeDataName(x)));
     if(!previousSafe){ await unlink(file).catch(()=>{}); throw new Error('anchor regression and previous pack was not known-good: '+JSON.stringify({missing,forbidden}));}
     throw new Error('anchor regression; previous known-good pack retained: '+JSON.stringify({missing,forbidden}));
   }
   const raw=JSON.stringify(toPack(e,items)),bytes=Buffer.byteLength(raw);if(bytes>400*1024)throw new Error('pack exceeds 400 KB safety ceiling');
   if(!meaningfulChange(old,items)){report.unchanged++;continue;}await writeFile(file,raw);
   const quality={rejected:cleaned.rejected,aliases:items.reduce((n,x)=>n+(x.a?.length||0),0),anchors:required.length-missing.length,missingAnchors:missing,mustNotFailures:forbidden,added:items.filter(x=>!old.some(y=>y.id===x.id)).length,removed:old.filter(x=>!items.some(y=>y.id===x.id)).length,querySplitFallback:fresh.errors.length>0,fallback:false};
   report.rejected[e.id]=cleaned.rejected;if(fresh.errors.length)report.fallback.push(e.id);
   manifest.packs[e.id]={n:items.length,built:today,hash:sha(raw),bytes,source:'wikidata',quality};report.built++;
   console.log(`${tag}: ${items.length} accepted; ${quality.aliases} aliases; ${fresh.errors.length} fallback band(s)`);
  }catch(err){report.failed.push(e.id+': '+err.message);if(hadPrevious)report.previousRetained=(report.previousRetained||[]).concat(e.id);console.warn(tag,'FAILED; old pack retained:',err.message);}
  await sleep(1500);
 }
 if(report.failed.length/Math.max(1,todo.length)>0.25){console.error('Over 25% of packs failed; refusing to publish.');process.exit(1);}
 if(report.built){manifest.version=(manifest.version||0)+1;manifest.built=today;}
 await writeFile(MANIFEST,JSON.stringify(manifest));await writeFile('data/BUILD-REPORT.json',JSON.stringify(report,null,2)+'\n');
 console.log(`Finished: ${report.built} changed, ${report.unchanged} unchanged, ${report.failed.length} failed.`);
}
main().catch(e=>{console.error(e);process.exit(1);});
