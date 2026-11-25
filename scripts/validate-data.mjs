import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { normalizeDataName, checkAnchors } from './data-quality.mjs';
import { fromPack } from '../js/wikidata.js';
import { CATALOG } from '../js/catalog.js';
import { readAnyPrompt } from './linked-store.mjs';
import { MAX_SHARD_PROMPTS } from '../js/linked.js';
const errors=[],manifest=JSON.parse(await readFile('data/manifest.json','utf8')),block=JSON.parse(await readFile('data/blocklist.json','utf8')),anchors=JSON.parse(await readFile('data/anchors.json','utf8'));
const catalog=new Set(CATALOG.map(e=>e.id)),files=(await readdir('data/packs')).filter(f=>f.endsWith('.json'));let total=0,anchorTotal=0;
for(const [id,meta] of Object.entries(manifest.packs)){
 try{
  // A question lives either in a loose pack file (build/patch tools work on these) or in the linked store (what the site serves).
  const linked=Boolean(meta.shard);let items,raw=null,pack=null;
  if(linked){items=await readAnyPrompt(manifest,id);if(!items)throw new Error('linked answers missing for '+id);}
  else{raw=await readFile('data/packs/'+id+'.json','utf8');pack=JSON.parse(raw);items=pack.v===2?(pack.names||[]).map((n,i)=>({id:String(pack.ids?.[i]),n,s:+pack.sitelinks?.[i]||0,a:pack.aliases?.[i]||[]})):(pack.items||[]).map(([qid,n,s,a])=>({id:'Q'+qid,n,s,a:a||[]}));}
  const v=linked?2:pack.v;
  if(!linked){
   total+=Buffer.byteLength(raw);
   if(![1,2].includes(pack.v))errors.push(id+': unsupported format version');
   if(!meta.hash||createHash('sha256').update(raw).digest('hex')!==meta.hash)errors.push(id+': missing or incorrect SHA-256');
   if(!meta.bytes||Buffer.byteLength(raw)!==meta.bytes)errors.push(id+': missing or incorrect byte count');
   if(Buffer.byteLength(raw)>400*1024)errors.push(id+': exceeds 400 KB chunking threshold (run scripts/linked-store.mjs pack)');
  }
  if(items.length!==meta.n)errors.push(id+': manifest answer count mismatch');
  const seen=new Set();for(let i=0;i<items.length;i++){
   const x=items[i],key=normalizeDataName(x.n);if(!x.n||!String(x.n).trim())errors.push(id+': empty name');
   if(seen.has(key)){if(v===2)errors.push(id+': duplicate normalized name '+x.n);else console.warn('Legacy v1 duplicate name to clean on rebuild:',id,x.n);}seen.add(key);
   if(i&&items[i].s>items[i-1].s)errors.push(id+': not popularity sorted');
   if((block.qids||[]).includes(x.id)||(block.words||[]).some(w=>String(x.n).toLowerCase().includes(String(w).toLowerCase()))){if(v===2)errors.push(id+': blocklist violation '+x.n);else console.warn('Legacy v1 blocklist item to remove on rebuild:',id,x.n);}
  }
  // Anchors go through the REAL game matcher: the answer must be an exact hit, not merely present somewhere in the file.
  // This applies to every pack (old v1 and new v2): a famous answer that the game rejects is a build failure.
  const rule=anchors[id]||{};
  if(rule.anchors?.length||rule.mustNot?.length){
   const res=checkAnchors(items,rule);
   for(const x of res.missing)errors.push(id+': ANCHOR REJECTED BY GAME MATCHER: '+x);
   for(const x of res.forbidden)errors.push(id+': mustNot answer accepted: '+x);
   anchorTotal+=(rule.anchors||[]).length;
  }
 }catch(e){errors.push(id+': '+e.message);}
}
for(const file of files)if(!manifest.packs[file.slice(0,-5)])errors.push(file+': missing from manifest');
// Linked store: every chunk file must exist with the recorded hash/size, and every question must point at real chunks.
const chunkFiles=new Set();
for(const [sid,sh] of Object.entries(manifest.shards||{})){
 if(sh.prompts.length>MAX_SHARD_PROMPTS)errors.push(sid+': too many questions in one shard');
 for(let i=0;i<sh.chunks.length;i++){
  const name=sid+'.'+i+'.json';chunkFiles.add(name);
  try{const raw=await readFile('data/linked/'+name,'utf8');total+=Buffer.byteLength(raw);
   if(createHash('sha256').update(raw).digest('hex')!==sh.chunks[i].hash)errors.push(name+': SHA-256 mismatch');
   if(Buffer.byteLength(raw)>512*1024)errors.push(name+': chunk larger than 512 KB');
  }catch(e){errors.push(name+': '+e.message);}
 }
 sh.prompts.forEach((pid,bit)=>{const m=manifest.packs[pid];if(!m||m.shard!==sid||m.bit!==bit)errors.push(pid+': manifest does not point at shard '+sid);else if((m.chunks||[]).some(c=>c>=sh.chunks.length))errors.push(pid+': points at a missing chunk');});
}
for(const f of await readdir('data/linked').catch(()=>[]))if(f.endsWith('.json')&&!chunkFiles.has(f))errors.push('data/linked/'+f+': chunk not listed in the manifest');
for(const [id,m] of Object.entries(manifest.packs))if(m.shard&&!(manifest.shards||{})[m.shard])errors.push(id+': unknown shard '+m.shard);
if(total>60*1024*1024)errors.push('total pack bytes exceed 60 MiB budget');
for(const id of Object.keys(anchors))if(!catalog.has(id))errors.push('anchor prompt is not in catalog: '+id);
if(errors.length){console.error('Validation failed:\n'+errors.join('\n'));process.exit(1);}
console.log(`Anchors checked through the game matcher: ${anchorTotal}`);
console.log(`Validation passed: ${Object.keys(manifest.packs).length} packs, ${total.toLocaleString()} raw bytes, ${files.length} files.`);
