import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { normalizeDataName } from './data-quality.mjs';
import { CATALOG } from '../js/catalog.js';
const errors=[],manifest=JSON.parse(await readFile('data/manifest.json','utf8')),block=JSON.parse(await readFile('data/blocklist.json','utf8')),anchors=JSON.parse(await readFile('data/anchors.json','utf8'));
const catalog=new Set(CATALOG.map(e=>e.id)),files=(await readdir('data/packs')).filter(f=>f.endsWith('.json'));let total=0;
for(const [id,meta] of Object.entries(manifest.packs)){
 try{
  const raw=await readFile('data/packs/'+id+'.json','utf8'),pack=JSON.parse(raw),items=pack.v===2?(pack.names||[]).map((n,i)=>({id:String(pack.ids?.[i]),n,s:+pack.sitelinks?.[i]||0,a:pack.aliases?.[i]||[]})):(pack.items||[]).map(([qid,n,s,a])=>({id:'Q'+qid,n,s,a:a||[]}));
  total+=Buffer.byteLength(raw);
  if(![1,2].includes(pack.v))errors.push(id+': unsupported format version');
  if(items.length!==meta.n)errors.push(id+': manifest answer count mismatch');
  if(!meta.hash||createHash('sha256').update(raw).digest('hex')!==meta.hash)errors.push(id+': missing or incorrect SHA-256');
  if(!meta.bytes||Buffer.byteLength(raw)!==meta.bytes)errors.push(id+': missing or incorrect byte count');
  if(Buffer.byteLength(raw)>400*1024)errors.push(id+': exceeds 400 KB chunking threshold');
  const seen=new Set();for(let i=0;i<items.length;i++){
   const x=items[i],key=normalizeDataName(x.n);if(!x.n||!String(x.n).trim())errors.push(id+': empty name');
   if(seen.has(key))errors.push(id+': duplicate normalized name '+x.n);seen.add(key);
   if(i&&items[i].s>items[i-1].s)errors.push(id+': not popularity sorted');
   if((block.qids||[]).includes(x.id))errors.push(id+': blocked id '+x.id);
   if((block.words||[]).some(w=>String(x.n).toLowerCase().includes(String(w).toLowerCase())))errors.push(id+': blocklisted word '+x.n);
  }
  const rule=anchors[id]||{},present=new Set(items.flatMap(x=>[x.n,...x.a]).map(normalizeDataName));
  for(const x of rule.anchors||[])if(!present.has(normalizeDataName(x))){if(pack.v===2)errors.push(id+': missing anchor '+x);else console.warn('Legacy v1 anchor not yet enforced:',id,x);}
  for(const x of rule.mustNot||[])if(present.has(normalizeDataName(x))&&pack.v===2)errors.push(id+': mustNot answer found '+x);
 }catch(e){errors.push(id+': '+e.message);}
}
for(const file of files)if(!manifest.packs[file.slice(0,-5)])errors.push(file+': missing from manifest');
if(total>60*1024*1024)errors.push('total pack bytes exceed 60 MiB budget');
for(const id of Object.keys(anchors))if(!catalog.has(id))errors.push('anchor prompt is not in catalog: '+id);
if(errors.length){console.error('Validation failed:\n'+errors.join('\n'));process.exit(1);}
console.log(`Validation passed: ${Object.keys(manifest.packs).length} packs, ${total.toLocaleString()} raw bytes, ${files.length} files.`);
