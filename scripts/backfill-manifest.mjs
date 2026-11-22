import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const manifest=JSON.parse(await readFile('data/manifest.json','utf8'));
for(const file of (await readdir('data/packs')).filter(x=>x.endsWith('.json')).sort()){
 const raw=await readFile('data/packs/'+file,'utf8'),pack=JSON.parse(raw),id=file.slice(0,-5);
 const n=pack.v===2?(pack.names||[]).length:(pack.items||[]).length,aliases=pack.v===2?Object.values(pack.aliases||{}).reduce((s,a)=>s+a.length,0):(pack.items||[]).reduce((s,r)=>s+(r[3]||[]).length,0);
 const old=manifest.packs[id]||{};
 manifest.packs[id]={...old,n,built:pack.built||old.built||manifest.built,hash:createHash('sha256').update(raw).digest('hex'),bytes:Buffer.byteLength(raw),source:old.source||'wikidata',quality:old.quality||{rejected:{invalid:0,blocked:0,duplicate:0,wrongClass:0},aliases,anchors:0,fallback:false}};
}
await writeFile('data/manifest.json',JSON.stringify(manifest));
console.log('Backfilled hash, byte count and legacy quality metadata for '+Object.keys(manifest.packs).length+' packs.');
