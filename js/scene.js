// DEEPWELL cinematic 2.5D underwater renderer.
// All visuals are generated live with Canvas 2D paths, gradients, lighting and particles.
// No 3D engine, images, video, sprite sheets or downloaded models.
import { CONFIG } from './config.js';
import { predatorGulp, rareSparkle } from './audio.js?v=linked-20261125';

const canvas = document.getElementById('scene');
const mainCtx = canvas?.getContext('2d', { alpha: false });
let ctx = mainCtx; // temporarily points at an offscreen canvas while a cached layer is being baked
let getDepth = () => 0;
let getProgress = () => 0;
let isStill = () => false;
let visualDepth = 0;
let visualStage = 0;
let sinkSmooth = 0;      // 0..1: how fast the craft is currently descending (drives tilt, bubbles, streaks)
let camDriftY = 0;       // vertical camera drift applied to the world this frame
let bubbles = [];
let plankton = [];
let fish = [];
let jellies = [];
let surfaceClouds = [];
let kelp = [];
let reef = [];
let eventScene = null;
let lastSharkVariant = -1;
let previousTime = 0;
let frozenTime = 0;
let width = 0;
let height = 0;
let dpr = 1;
let frameStarted = false;
let rafHandle = 0;
let getHaptics = () => false;
let getColorSafe = () => false;
let focusTimer = 0;
let lowQuality = false;
let graphicsTier = 'high';
let tierManual = false;   // the player picked High/Medium/Low in Settings: never change it
let tierPicked = false;   // the starting tier has been chosen for this session
let slowWindows = 0;      // consecutive slow 2-second windows (two in a row trigger a step down)
let frameSampleStart = 0;
let frameSampleCount = 0;
let lastPerfTime = 0;
let perfOverlay = null;
// One place that defines every tier. Each step down removes FIXED per-frame costs (not just creature counts):
//  layer  = resolution of the cached water/surface layers (smaller = cheaper), sprites = fish drawn from cached
//  images instead of live paths+gradients, caustics = animated surface light lines, fps = frame-rate cap.
const QUALITY = {
  high:  { dpr:2,    bubbles:40, plankton:100, fish:18, jellies:5, layer:0.5,  sprites:false, caustics:true,  kelp:24, kelpGlow:true,  fps:60 },
  medium:{ dpr:1.25, bubbles:16, plankton:36,  fish:10, jellies:2, layer:0.35, sprites:true,  caustics:false, kelp:14, kelpGlow:false, fps:60 },
  low:   { dpr:1,    bubbles:8,  plankton:14,  fish:7,  jellies:1, layer:0.25, sprites:true,  caustics:false, kelp:8,  kelpGlow:false, fps:30 }
};
const TIER_STORE = 'deepwell.graphicsTier';
const qNow = () => QUALITY[graphicsTier] || QUALITY.medium;
function syncTierClasses() {
  const c = document.body?.classList; if (!c) return;
  c.toggle('quality-med', graphicsTier === 'medium');
  c.toggle('quality-low', graphicsTier === 'low');
}
let perfWindowStart = 0;
let perfFrames = 0;

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3.3);

/* ------------------------------------------------------------ cached layers
 * Slow-changing, full-screen layers (water, surface, rocks) are painted into a small offscreen canvas and blitted with
 * one drawImage. They are repainted only when their key changes (depth step, size, tier), not every frame. */
const layers = new Map();
function cachedLayer(id, lw, lh, scale, key, paint) {
  let L = layers.get(id);
  if (!L) { L = { c: document.createElement('canvas'), key: null }; L.x = L.c.getContext('2d'); layers.set(id, L); }
  const pw = Math.max(1, Math.ceil(lw * scale)), ph = Math.max(1, Math.ceil(lh * scale));
  if (L.c.width !== pw || L.c.height !== ph) { L.c.width = pw; L.c.height = ph; L.key = null; }
  if (L.key !== key) {
    const main = ctx;
    ctx = L.x; ctx.setTransform(pw / lw, 0, 0, ph / lh, 0, 0); ctx.clearRect(0, 0, lw, lh);
    try { paint(); } finally { ctx = main; }
    L.key = key;
  }
  return L.c;
}
/** Paint into a standalone small canvas once (sprites). */
function bakeSprite(w, h, paint) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const main = ctx; ctx = c.getContext('2d');
  try { paint(); } finally { ctx = main; }
  return c;
}

const FISH_PALETTE = [
  ['#526e78','#b6c7c2','#1b303a'], ['#687b72','#c1c9b7','#263b39'],
  ['#506b83','#c0ced0','#22384b'], ['#78816d','#c8c7ae','#303c36'],
  ['#657b87','#d0d7cc','#2a3d49'], ['#8a795f','#d0c2a0','#3d3c31'],
  ['#476d70','#b6c9bd','#203b3e']
];

/* Real-world colour schemes, one depth zone each: [body, belly, shade, marking, fins].
 * kind picks the body drawing (0 generic, 1 slender, 2 tall banded, 3 round, 4 long, 5 glow-dotted,
 * 6 manta, 7 jellyfish, 8 anglerfish, 9 hatchetfish, 10 viperfish). */
const SPECIES = [
  // sunlight zone: warm reef colours
  {zone:'sun',kind:2,pal:['#ff7a1a','#ffb25e','#a83a08','#fff4e2','#ff9a3c'],scale:0.8,speed:0.8},  // clownfish
  {zone:'sun',kind:0,pal:['#1f6fe0','#4b97ff','#0a2d78','#ffd21f','#ffd21f'],scale:1,speed:1.1},    // blue tang
  {zone:'sun',kind:2,pal:['#ffd83a','#fff3a6','#b88a00','#1b1b1b','#ffe35a'],scale:0.85,speed:0.9}, // butterflyfish
  {zone:'sun',kind:4,pal:['#ff7f9a','#ffd9d2','#a8324e','#ffb4c0','#ff6a8a'],scale:0.75,speed:1.4}, // anthias
  {zone:'sun',kind:3,pal:['#d8c168','#fff1c2','#7c6a28','#ffffff','#e6d58a'],scale:0.8,speed:0.6},  // pufferfish
  // twilight zone: open-water hunters
  {zone:'twi',kind:1,pal:['#2b72ad','#dbe8ee','#0b2c52','#9fd2ff','#f4d23c'],scale:1.25,speed:1.6}, // tuna
  {zone:'twi',kind:4,pal:['#35c27a','#f2e17c','#0f6a49','#6ff0c0','#1fb7c6'],scale:1.05,speed:1.4}, // mahi-mahi
  {zone:'twi',kind:0,pal:['#e3504a','#f7b6a2','#86202a','#ff8a80','#c7343c'],scale:1,speed:1},      // snapper
  {zone:'twi',kind:2,pal:['#c8423a','#f2d9c8','#6f1a1c','#f7efe4','#e9c9a4'],scale:0.95,speed:0.7}, // lionfish
  // midnight zone: silver and glowing
  {zone:'mid',kind:9,pal:['#8fb4cb','#dfeaf2','#2b4560','#7cf7ff','#6f98b3'],scale:0.85,speed:1},    // hatchetfish
  {zone:'mid',kind:5,pal:['#1f6d8a','#6fc4cf','#0b2b3e','#7dffe2','#2a8aa6'],scale:0.9,speed:0.9},   // lanternfish
  {zone:'mid',kind:10,pal:['#2f4a74','#6b8fb8','#0f1d38','#7cf7ff','#43648e'],scale:1.2,speed:1.2},  // viperfish
  {zone:'mid',kind:0,pal:['#a6bdd1','#e7eff6','#4a6178','#d3e6f5','#8fa8be'],scale:1.05,speed:0.8},  // ghost cod
  {zone:'mid',kind:7,pal:FISH_PALETTE[0],scale:1,speed:0.4},                                          // jellyfish
  // abyss: dark bodies, bright lights
  {zone:'aby',kind:8,pal:['#4a3d68','#8b76ab','#1c1530','#aef9ff','#5a4a7e'],scale:1,speed:0.55},    // anglerfish
  {zone:'aby',kind:10,pal:['#4a3a7c','#8870c0','#150d2a','#6fffd0','#5e4a98'],scale:1.3,speed:1},    // gulper
  {zone:'aby',kind:5,pal:['#2c3f8a','#7aa0ff','#0b1236','#8ab4ff','#3f58c4'],scale:0.9,speed:0.9},   // blue lanternfish
  {zone:'aby',kind:4,pal:['#cfe1f0','#f2f8ff','#6a86a0','#ffffff','#b8cfe2'],scale:1.1,speed:0.7},   // ghost eel
  {zone:'aby',kind:7,pal:FISH_PALETTE[0],scale:1.2,speed:0.35}                                       // deep jellyfish
];
/** How much of each zone's wildlife belongs at this depth (0..1); neighbouring zones overlap so scenes blend slowly. */
function zoneWeights(depth) {
  return {
    sun:1-smooth((depth-0.08)/0.2),
    twi:smooth((depth-0.06)/0.2)*(1-smooth((depth-0.39)/0.23)),
    mid:smooth((depth-0.32)/0.2)*(1-smooth((depth-0.84)/0.16)),
    aby:smooth((depth-0.82)/0.12)
  };
}
function pickSpecies(depth) {
  const wt=zoneWeights(depth);let total=0;const w=SPECIES.map(sp=>{const v=wt[sp.zone]||0;total+=v;return v;});
  if(total<=0)return 0;let r=Math.random()*total;
  for(let i=0;i<w.length;i++){r-=w[i];if(r<=0)return i;}
  return 0;
}

const SHARKS = [
  { name:'Great white', top:'#637f91', side:'#94afb9', belly:'#e5eeea', fin:'#314a5d', eye:'#061723', pattern:'plain' },
  { name:'Tiger shark', top:'#536e78', side:'#879fa4', belly:'#dbe6e0', fin:'#2b4350', eye:'#061723', pattern:'tiger' },
  { name:'Hammerhead', top:'#718d9b', side:'#a8c3c1', belly:'#e4efea', fin:'#3d5866', eye:'#061723', pattern:'hammer' },
  { name:'Blue shark', top:'#347d9e', side:'#8ebac8', belly:'#d5e9e8', fin:'#174563', eye:'#061723', pattern:'plain' },
  { name:'Dusky shark', top:'#435f70', side:'#829da9', belly:'#dbe7e4', fin:'#263e52', eye:'#061723', pattern:'plain' }
];

/** (Re)start one fish: a species that belongs at this depth, entering from a screen edge and swimming across. */
function spawnFish(f,w,depth,anywhere,time=-9999) {
  f.born=time;
  f.sp=pickSpecies(depth);
  f.dir=Math.random()<0.5?-1:1;
  f.z=rand(0.08,1);              // 0 = far away and dim, 1 = close and bright
  f.v=f.lane??Math.random();      // vertical lane inside the visible water
  f.vel=rand(0.75,1.2);
  f.x=anywhere?rand(-0.1*w,1.1*w):(f.dir>0?-170:w+170);
}

function resize() {
  if (!canvas || !ctx) return;
  width = Math.max(1, window.innerWidth);
  height = Math.max(1, window.innerHeight);
  // High-detail drawing without allowing very high-DPI devices to allocate excessive memory.
  const touch = matchMedia('(hover:none) and (pointer:coarse)').matches || width < 700;
  const manual = document.body?.dataset.graphics || 'auto';
  if (manual !== 'auto' && QUALITY[manual]) { graphicsTier = manual; tierManual = true; tierPicked = true; }
  else {
    tierManual = false;
    if (!tierPicked) {
      // Start low-power phones on Low, other phones on Medium, desktops on High; remember what a past session settled on.
      const hc = navigator.hardwareConcurrency || 8, mem = navigator.deviceMemory || 8;
      graphicsTier = touch && (hc <= 4 || mem <= 4) ? 'low' : touch ? 'medium' : 'high';
      try { const saved = localStorage.getItem(TIER_STORE); const rank = { low:0, medium:1, high:2 };
        if (QUALITY[saved] && rank[saved] < rank[graphicsTier]) graphicsTier = saved; } catch { /* storage blocked: fine */ }
      tierPicked = true;
    }
  }
  syncTierClasses();
  layers.clear(); fishSprites.clear();
  const q = QUALITY[graphicsTier] || QUALITY.medium;
  dpr = Math.min(q.dpr, touch ? 1.5 : 2, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const mobile = width < 700;
  const quality = lowQuality ? 0.62 : 1;
  slowWindows = 0; perfWindowStart = 0; perfFrames = 0;
  bubbles = Array.from({length:Math.round(q.bubbles*quality)},()=>({
    x:rand(0,width), y:rand(0,height), r:rand(0.8,4.2),
    speed:rand(0.18,0.92), drift:rand(0.35,1.9), phase:rand(0,TAU),
    alpha:rand(0.14,0.52), near:Math.random()<0.18
  }));
  plankton = Array.from({length:Math.round(q.plankton*quality)},()=>({
    x:rand(0,width),y:rand(0,height),r:rand(0.45,1.75),
    speed:rand(0.08,0.42),phase:rand(0,TAU),alpha:rand(0.08,0.38)
  }));
  fish = Array.from({length:Math.round(q.fish*quality)},(_,i)=>{
    const n=Math.max(1,Math.round(q.fish*quality));
    // Each fish keeps its own swimming lane so the water never turns into one overlapping crowd.
    const f={group:i%5,phase:rand(0,TAU),bob:rand(0,TAU),lane:(((i*5)%n)+rand(0.2,0.8))/n,born:-9999};
    spawnFish(f,width,visualDepth,true);return f;
  });
  jellies = Array.from({length:q.jellies},(_,i)=>({
    u:rand(0.08,0.92),v:rand(0.12,0.76),scale:rand(0.26,0.58),
    phase:rand(0,TAU),speed:rand(0.000025,0.000055),drift:rand(0.012,0.035),kind:i%3
  }));
  surfaceClouds = Array.from({length:8},(_,i)=>({
    u:rand(-0.08,1.08),v:rand(0.035,0.22),scale:rand(0.55,1.45),
    phase:rand(0,TAU),alpha:rand(0.24,0.54)
  }));
  kelp = Array.from({length:q.kelp},(_,i)=>({
    x:(i/Math.max(1,q.kelp-1))*width+rand(-24,24),height:rand(75,260),width:rand(3,10),
    phase:rand(0,TAU),color:['#123f3d','#20594c','#2c6652','#426e55'][i%4],
    lean:rand(-1,1)
  }));
  reef = [];
  for(let side of [-1,1]){
    for(let i=0;i<9;i++){
      reef.push({
        x:side*rand(width*0.01,width*0.16), y:height*rand(0.73,1.02),
        scale:rand(0.55,1.45), color:['#657b63','#a58c61','#587b70','#71868a','#8b795f'][i%5],
        type:i%4, phase:rand(0,TAU)
      });
    }
  }
}

function startRenderLoop() {
  if(frameStarted || document.hidden || !ctx || !canvas) return;
  frameStarted = true;
  previousTime = 0;
  rafHandle = requestAnimationFrame(frame);
}

function onVisibilityChange() {
  if(document.hidden) {
    if(rafHandle) cancelAnimationFrame(rafHandle);
    rafHandle = 0;
    frameStarted = false;
    return;
  }
  startRenderLoop();
}

export function startScene(depthFn, stillFn, progressFn, hapticsFn, colorSafeFn) {
  getDepth = typeof depthFn==='function' ? depthFn : getDepth;
  isStill = typeof stillFn==='function' ? stillFn : isStill;
  getProgress = typeof progressFn==='function' ? progressFn : getProgress;
  getHaptics = typeof hapticsFn==='function' ? hapticsFn : getHaptics;
  getColorSafe = typeof colorSafeFn==='function' ? colorSafeFn : getColorSafe;
  resize();
  window.addEventListener('resize',resize,{passive:true});
  document.addEventListener('visibilitychange',onVisibilityChange);
  startRenderLoop();
}

// Visual-only signal from the existing answer resolution. It never changes score or progression.
export function resetDiveVisual() {
  visualDepth=0;visualStage=0;sinkSmooth=0;bannerZone=0;eventScene=null;previousTime=0;frozenTime=0;
}

const PREDATOR_SPECIES = [
  {id:'shark',name:'open-water shark',caption:'A giant shark mistook your sub for lunch.'},
  {id:'angler',name:'anglerfish',caption:'A grumpy anglerfish mistook your lamp for a snack.'},
  {id:'catfish',name:'deep-sea catfish',caption:'A whiskered giant tried to swallow the whole research pod.'},
  {id:'grouper',name:'abyssal grouper',caption:'A grouper the size of a bus decided you looked delicious.'},
  {id:'barracuda',name:'long-jawed barracuda',caption:'A giant barracuda made a very poor lunch decision.'},
  {id:'gulper',name:'gulper fish',caption:'A gulper fish opened a mouth much bigger than its manners.'}
];
const PREDATOR_SKINS = [
  {top:'#496d79',side:'#91aeb0',belly:'#d6e2d7',fin:'#1d3d50',glow:'#80f4df'},
  {top:'#536d80',side:'#91a7bd',belly:'#c8d5d9',fin:'#273d59',glow:'#93dfff'},
  {top:'#5e716d',side:'#9eaaa0',belly:'#d8d8c8',fin:'#344b47',glow:'#c4f0ce'},
  {top:'#6e5e76',side:'#a78aa3',belly:'#e1ccd7',fin:'#3f344e',glow:'#d5a7ff'},
  {top:'#6d6e55',side:'#b1a57b',belly:'#e3d5b1',fin:'#393f34',glow:'#ffe39b'}
];
const SAFE_PREDATOR_SKINS = [
  {top:'#345f8b',side:'#73a8c8',belly:'#d4e7f4',fin:'#203d68',glow:'#ffe08b'},
  {top:'#534c88',side:'#958cd0',belly:'#e0dff4',fin:'#302c5e',glow:'#74e8dc'},
  {top:'#536b69',side:'#9bbab1',belly:'#e0eee5',fin:'#273f4c',glow:'#ffcf70'},
  {top:'#766143',side:'#c2a76a',belly:'#f2e4bb',fin:'#4c4537',glow:'#85dfff'},
  {top:'#465d7d',side:'#91aec6',belly:'#dce8ef',fin:'#263e60',glow:'#f2b6ec'}
];

function addFeedbackCaption(caption) {
  const feedback = document.getElementById('feedback');
  if(feedback && caption) feedback.textContent = [feedback.textContent, caption].filter(Boolean).join(' ');
}

function focusSceneBriefly(ms=980) {
  if(!document.body) return;
  document.body.classList.add('scene-focus');
  if(focusTimer) clearTimeout(focusTimer);
  focusTimer=setTimeout(()=>{
    document.body.classList.remove('scene-focus');
    focusTimer=0;
  },ms);
}

export function triggerAnswerVisual(points, state) {
  const failed = state !== 'hit'; 
  if(isStill()) {
    if(state!=='hit' || points<=20) {
      const species=PREDATOR_SPECIES[Math.floor(Math.random()*PREDATOR_SPECIES.length)];
      addFeedbackCaption(species.caption);
    } else if(points>=70) {
      addFeedbackCaption('A rare creature glides past in the still water.');
    }
    eventScene=null;
    document.body?.classList.remove('scene-focus');
    return;
  }
  if(failed || points <= 20) {
    const species=PREDATOR_SPECIES[Math.floor(Math.random()*PREDATOR_SPECIES.length)];
    const skins=getColorSafe()?SAFE_PREDATOR_SKINS:PREDATOR_SKINS;
    const caption=species.caption;
    addFeedbackCaption(caption);
    eventScene=null;
    eventScene={
      kind:'predator',species:species.id,name:species.name,caption,
      start:performance.now(),duration:1820,seed:rand(0,TAU),
      variant:Math.floor(rand(0,skins.length)),skin:skins[Math.floor(rand(0,skins.length))],
      lane:rand(-0.035,0.035),direction:Math.random()<0.5?-1:1,
      scale:rand(0.88,1.14),x:0,y:0,scaleNow:0,jaw:0,alpha:1
    };
    focusSceneBriefly(980);
    predatorGulp();
    if(getHaptics()) {
      try { if(navigator.vibrate) navigator.vibrate([24,28,48]); } catch { /* optional */ }
    }
    return;
  }

  let pool;
  if(points <= 40) {
    pool=['silver_school','reef_fish','butterfly_school','tropical_school'];
  } else if(points <= 60) {
    pool=['manta','turtle','octopus','ray_school'];
  } else if(points <= 80) {
    pool=['dolphins','giant_ray','sea_turtle','reef_sharks'];
  } else if(points <= 94) {
    pool=['whale_shark','jelly_bloom','bioluminescent_school','manta_migration'];
  } else {
    pool=['blue_whale','whale_shark','bioluminescent_migration','giant_whale_shadow'];
  }
  const kind=pool[Math.floor(Math.random()*pool.length)];
  if(points>=70 && !isStill()) rareSparkle();
  eventScene={
    kind,
    start:performance.now(),
    duration:kind==='reef_sharks'||kind==='whale_shark'?2100:1850,
    seed:rand(0,TAU),
    variant:Math.floor(rand(0,FISH_PALETTE.length)),
    lane:rand(-0.16,0.16),
    direction:Math.random()<0.5?-1:1,
    scale:rand(0.88,1.18)
  };
}

// Keep the old function name available to any other in-project callers.
export function triggerPredatorAttack() { triggerAnswerVisual(0,'miss'); }

const WATER_ZONES = [
  // "Bioluminescent Trench": turquoise shallows -> cobalt -> indigo -> violet ink. Never flat black, so the dive
  // keeps its colour all the way down and glowing creatures pop against it.
  {at:0,colors:['#1bb0b4','#0b7894','#06455f']},
  {at:0.10,colors:['#0f66b5','#0a4a8e','#062c5c']},
  {at:0.375,colors:['#2a3fb0','#1b2b80','#0c1552']},
  {at:0.875,colors:['#4b2a9c','#2b1672','#120a3c']},
  {at:1,colors:['#33165e','#1a0b3f','#08031d']}
];

function mixHex(a,b,t) {
  const ca=parseInt(a.slice(1),16), cb=parseInt(b.slice(1),16);
  const ar=(ca>>16)&255, ag=(ca>>8)&255, ab=ca&255;
  const br=(cb>>16)&255, bg=(cb>>8)&255, bb=cb&255;
  return `rgb(${Math.round(mix(ar,br,t))},${Math.round(mix(ag,bg,t))},${Math.round(mix(ab,bb,t))})`;
}

function waterPalette(depth) {
  let index=0;
  while(index<WATER_ZONES.length-2 && depth>WATER_ZONES[index+1].at) index++;
  const a=WATER_ZONES[index], b=WATER_ZONES[index+1];
  const t=smooth((depth-a.at)/Math.max(0.001,b.at-a.at));
  return a.colors.map((color,i)=>mixHex(color,b.colors[i],t));
}

function drawWater(w,h,depth,time) {
  const q=qNow();
  // Baked at reduced resolution (gradients are smooth) and repainted only when depth moves a step or every 2.5 s.
  const key=Math.round(depth*320)*10000+(Math.floor(time/2500)%10000);
  ctx.drawImage(cachedLayer('water',w,h,q.layer,key,()=>paintWater(w,h,depth,time)),0,0,w,h);
  if(q.caustics&&depth<0.18)drawCaustics(w,h,depth,time);
}

function paintWater(w,h,depth,time) {
  const colors=waterPalette(depth);
  const g=ctx.createLinearGradient(w*0.16,0,w*0.72,h);
  g.addColorStop(0,colors[0]);g.addColorStop(0.48,colors[1]);g.addColorStop(1,colors[2]);
  ctx.fillStyle=g;ctx.fillRect(0,0,w,h);

  // The surface glow dies away as the camera descends.
  const lightPower=Math.pow(1-depth,1.75)*0.42;
  const halo=ctx.createRadialGradient(w*0.48,-h*0.08,4,w*0.48,h*0.12,h*0.96);
  halo.addColorStop(0,'rgba(183,230,220,'+lightPower+')');
  halo.addColorStop(0.34,'rgba(82,166,178,'+(lightPower*0.42)+')');
  halo.addColorStop(1,'rgba(5,35,54,0)');
  ctx.fillStyle=halo;ctx.fillRect(0,0,w,h);

  // Narrow, soft shafts retain direction without the graphic stripe effect.
  if(depth<0.76){
    ctx.save();ctx.globalCompositeOperation='screen';
    for(let i=0;i<8;i++){
      const phase=time*0.000025+i*2.13;
      const x=w*(0.04+i*0.13)+Math.sin(phase)*w*0.012;
      const spread=w*(0.018+(i%3)*0.012);
      const beam=ctx.createLinearGradient(x,0,x+spread,h*0.82);
      const a=lightPower*(0.13+(i%2)*0.045);
      beam.addColorStop(0,'rgba(191,235,220,'+a+')');
      beam.addColorStop(0.46,'rgba(95,181,190,'+(a*0.32)+')');
      beam.addColorStop(1,'rgba(45,112,144,0)');
      ctx.fillStyle=beam;
      ctx.beginPath();
      ctx.moveTo(x-spread*0.12,0);ctx.lineTo(x+spread*0.45,0);
      ctx.lineTo(x+spread*2.15,h*0.84);ctx.lineTo(x-spread*1.1,h*0.84);
      ctx.closePath();ctx.fill();
    }
    ctx.restore();
  }

  // Depth haze compresses contrast in the distance; at depth it becomes cold and dark.
  const haze=ctx.createLinearGradient(0,0,0,h);
  haze.addColorStop(0,'rgba(2,17,29,'+(0.015+depth*0.07)+')');
  haze.addColorStop(0.54,'rgba(1,13,23,'+(0.08+depth*0.13)+')');
  haze.addColorStop(1,'rgba(0,5,12,'+(0.35+depth*0.48)+')');
  ctx.fillStyle=haze;ctx.fillRect(0,0,w,h);
}
 
function drawCaustics(w,h,depth,time) {
  // Surface caustics are faint and disappear quickly below the reef.
  {
    ctx.save();ctx.globalCompositeOperation='screen';
    ctx.globalAlpha=(0.018+(0.18-depth)*0.13);
    ctx.strokeStyle='#b5e7df';ctx.lineWidth=0.8;
    for(let row=0;row<11;row++){
      ctx.beginPath();
      const baseY=h*(0.035+row*0.042);
      for(let x=-20;x<w+30;x+=24){
        const wave=Math.sin(x*0.011+time*0.00048+row*0.73)*3.5
          +Math.sin(x*0.005-time*0.00032+row)*6;
        if(x===-20)ctx.moveTo(x,baseY+wave);else ctx.lineTo(x,baseY+wave);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

}

function drawSurfaceMoment(w,h,depth,time,still) {
  const strength=1-smooth(depth/0.235);
  if(strength<0.006) return;
  const q=qNow(),key=Math.round(depth*500)*100000+(Math.floor(time/(q.sprites?220:90))%100000);
  ctx.drawImage(cachedLayer('surface',w,h,Math.max(0.4,q.layer*1.4),key,()=>paintSurfaceMoment(w,h,depth,time,still)),0,0,w,h);
}

function paintSurfaceMoment(w,h,depth,time,still) {
  const strength=1-smooth(depth/0.235);
  const waterline=h*(0.305-depth*0.78);
  ctx.save();
  ctx.globalAlpha=strength;

  const sky=ctx.createLinearGradient(0,0,0,waterline+2);
  sky.addColorStop(0,'#ffb36b');
  sky.addColorStop(0.43,'#f8cf9b');
  sky.addColorStop(0.76,'#9cd0d0');
  sky.addColorStop(1,'#5aa8b2');
  ctx.fillStyle=sky;ctx.fillRect(0,0,w,Math.max(0,waterline+4));

  const sunX=w*0.73,sunY=Math.max(20,waterline*0.47);
  const halo=ctx.createRadialGradient(sunX,sunY,3,sunX,sunY,Math.min(w,h)*0.34);
  halo.addColorStop(0,'rgba(255,242,193,0.86)');
  halo.addColorStop(0.2,'rgba(255,204,137,0.32)');
  halo.addColorStop(1,'rgba(255,183,116,0)');
  ctx.fillStyle=halo;ctx.fillRect(0,0,w,waterline+Math.min(h*0.4,260));
  ctx.fillStyle='#fff0c2';ctx.beginPath();ctx.arc(sunX,sunY,Math.max(9,Math.min(w,h)*0.023),0,TAU);ctx.fill();

  for(const cloud of surfaceClouds) {
    const drift=still?0:Math.sin(time*0.000035+cloud.phase)*w*0.008;
    const x=cloud.u*w+drift,y=cloud.v*waterline*1.55;
    const size=Math.min(w,h)*0.055*cloud.scale;
    ctx.globalAlpha=strength*cloud.alpha;
    const cg=ctx.createLinearGradient(x,y-size*0.4,x,y+size*0.55);
    cg.addColorStop(0,'rgba(255,255,243,0.92)');
    cg.addColorStop(1,'rgba(255,226,196,0.08)');
    ctx.fillStyle=cg;
    ctx.beginPath();
    ctx.ellipse(x-size*0.6,y,size*0.78,size*0.26,0,0,TAU);
    ctx.ellipse(x,y-size*0.12,size*0.64,size*0.42,0,0,TAU);
    ctx.ellipse(x+size*0.56,y+size*0.02,size*0.74,size*0.27,0,0,TAU);
    ctx.fill();
  }
  ctx.globalAlpha=strength;

  const sea=ctx.createLinearGradient(0,waterline,0,h);
  sea.addColorStop(0,'rgba(15,105,124,0.88)');
  sea.addColorStop(0.22,'rgba(8,65,87,0.55)');
  sea.addColorStop(1,'rgba(4,29,48,0.1)');
  ctx.fillStyle=sea;ctx.fillRect(0,waterline,w,h-waterline);

  // A moving waterline, a thin foam edge and layered reflections sell the surface.
  ctx.beginPath();
  for(let x=0;x<=w+12;x+=12) {
    const wave=Math.sin(x*0.013+time*0.00062)*3.2+Math.sin(x*0.006-time*0.00038)*2.6;
    const y=waterline+wave;
    if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  }
  ctx.strokeStyle='rgba(235,255,240,0.82)';ctx.lineWidth=2.4;ctx.stroke();
  ctx.strokeStyle='rgba(255,210,163,0.52)';ctx.lineWidth=1;
  for(let row=0;row<5;row++){
    const y=waterline+10+row*8;
    ctx.beginPath();
    for(let x=-12;x<=w+12;x+=28){
      const wave=Math.sin(x*0.009+time*0.00047+row)*2.3;
      if(x===-12)ctx.moveTo(x,y+wave);else ctx.lineTo(x,y+wave);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawRock(x,y,scale,time) {
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
  const body=ctx.createLinearGradient(-45,-50,40,38);
  body.addColorStop(0,'#42616a');body.addColorStop(0.35,'#1d3d4c');body.addColorStop(1,'#081b29');
  ctx.fillStyle=body;ctx.shadowColor='#071b29';ctx.shadowBlur=22;
  ctx.beginPath();ctx.moveTo(-65,26);ctx.bezierCurveTo(-72,-8,-50,-48,-18,-42);
  ctx.bezierCurveTo(4,-70,35,-43,42,-20);ctx.bezierCurveTo(76,-8,70,23,54,36);
  ctx.quadraticCurveTo(0,52,-65,26);ctx.fill();
  ctx.shadowBlur=0;ctx.strokeStyle='rgba(176,224,216,0.18)';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(-38,-15);ctx.quadraticCurveTo(-8,-38,19,-23);ctx.stroke();
  for(let i=0;i<9;i++){
    const xx=-48+i*11, yy=-10+((i*17)%41);
    ctx.fillStyle=i%2?'rgba(95,158,143,0.2)':'rgba(9,30,43,0.34)';
    ctx.beginPath();ctx.ellipse(xx,yy,2+(i%4),1+(i%3)*0.55,((i%5)-2)*0.12,0,TAU);ctx.fill();
  }
  ctx.restore();
}

function drawBranchCoral(x,y,scale,color,phase,time) {
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
  const sway=Math.sin(time*0.0008+phase)*2.4;
  function branch(x0,y0,angle,len,width,level){
    if(level<=0||len<4)return;
    const x1=x0+Math.cos(angle)*len+sway*(4-level)*0.2;
    const y1=y0+Math.sin(angle)*len;
    const grad=ctx.createLinearGradient(x0-width,y0,x1+width,y1);
    grad.addColorStop(0,'#533b4b');grad.addColorStop(0.4,color);grad.addColorStop(1,'#ffd0a0');
    ctx.strokeStyle=grad;ctx.lineWidth=width;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(x0,y0);ctx.quadraticCurveTo((x0+x1)*0.5+width,y0+(y1-y0)*0.5,x1,y1);ctx.stroke();
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(x1,y1,width*0.62,0,TAU);ctx.fill();
    branch(x1,y1,angle-0.55,len*0.7,width*0.68,level-1);
    branch(x1,y1,angle+0.52,len*0.68,width*0.65,level-1);
    if(level>2)branch(x1,y1,angle-0.06,len*0.54,width*0.58,level-2);
  }
  branch(0,0,-Math.PI/2,62,6,4);
  ctx.restore();
}

function paintReefStatic(w,h) {
  {
    // Foreground rock shelves frame the diver and provide a strong scale cue.
    for(let side of [-1,1]){
      const x=side<0?0:w;
      const grad=ctx.createLinearGradient(0,h*0.72,0,h);
      grad.addColorStop(0,'#24545b');grad.addColorStop(0.35,'#123743');grad.addColorStop(1,'#061522');
      ctx.fillStyle=grad;ctx.beginPath();ctx.moveTo(x,h);
      for(let i=0;i<=12;i++){
        const px=x+side*i*(w*0.026);
        const py=h*0.93+Math.sin(i*1.6+side)*h*0.025;
        ctx.lineTo(px,py);
      }
      ctx.lineTo(x,h);ctx.fill();
    }
    for(const r of reef){
      drawRock(r.x,r.y,r.scale,r.phase);
      if(r.type===0||r.type===2)drawBranchCoral(r.x,r.y-15*r.scale,r.scale*0.75,r.color,r.phase,0);
    }
  }
}

function drawReefAndKelp(w,h,time,depth,still) {
  const reefAlpha=clamp(1-depth*1.95,0,1);
  if(reefAlpha<=0.02)return;
  const q=qNow();
  // Rock shelves, rocks and coral never move: baked once per size/tier (their soft shadow is paid for once, not 60x a second).
  const base=cachedLayer('reef',w,h,Math.min(dpr,1.25),'static',()=>paintReefStatic(w,h));
  ctx.save();ctx.globalAlpha=reefAlpha;ctx.drawImage(base,0,0,w,h);
  {
    for(const k of kelp){
      const sway=still?0:Math.sin(time*0.0009+k.phase)*22*k.lean;
      ctx.lineCap='round';
      ctx.beginPath();ctx.moveTo(k.x,h+15);
      ctx.bezierCurveTo(k.x-18+sway*0.3,h-k.height*0.25,k.x+20+sway,h-k.height*0.65,k.x+sway,h-k.height);
      if(q.kelpGlow){ // cheap replacement for shadowBlur: one wider, faint stroke under the strand
        ctx.globalAlpha=reefAlpha*0.22;ctx.strokeStyle=k.color;ctx.lineWidth=k.width*2.6;ctx.stroke();ctx.globalAlpha=reefAlpha;
      }
      ctx.strokeStyle=k.color;ctx.lineWidth=k.width;ctx.stroke();
      if(q.kelpGlow){
        ctx.strokeStyle='rgba(176,255,211,0.18)';ctx.lineWidth=1.5;
        ctx.beginPath();ctx.moveTo(k.x,h-3);ctx.quadraticCurveTo(k.x+sway*0.45,h-k.height*0.52,k.x+sway,h-k.height);ctx.stroke();
      }
    }
    ctx.restore();
  }
}

function drawDepthWalls(w,h,depth,time) {
  const wall= smooth(clamp((depth-0.17)/0.52,0,1));
  if(wall<0.015)return;
  ctx.save();ctx.globalAlpha=wall*0.88;
  const left=ctx.createLinearGradient(0,0,w*0.23,0);
  left.addColorStop(0,'rgba(2,10,17,0.98)');
  left.addColorStop(0.62,'rgba(8,27,39,0.78)');
  left.addColorStop(1,'rgba(12,37,49,0)');
  ctx.fillStyle=left;ctx.beginPath();
  ctx.moveTo(0,0);ctx.lineTo(w*0.07,h*0.08);ctx.lineTo(w*0.12,h*0.29);
  ctx.lineTo(w*0.19,h*0.47);ctx.lineTo(w*0.14,h*0.73);
  ctx.lineTo(w*0.23,h);ctx.lineTo(0,h);ctx.closePath();ctx.fill();

  const right=ctx.createLinearGradient(w,0,w*0.77,0);
  right.addColorStop(0,'rgba(1,8,15,0.98)');
  right.addColorStop(0.62,'rgba(7,24,36,0.76)');
  right.addColorStop(1,'rgba(10,33,46,0)');
  ctx.fillStyle=right;ctx.beginPath();
  ctx.moveTo(w,0);ctx.lineTo(w*0.94,h*0.12);ctx.lineTo(w*0.88,h*0.33);
  ctx.lineTo(w*0.81,h*0.55);ctx.lineTo(w*0.86,h*0.77);
  ctx.lineTo(w*0.76,h);ctx.lineTo(w,h);ctx.closePath();ctx.fill();

  // Broken sedimentary seams catch only a trace of the remaining light.
  ctx.lineWidth=1;
  for(let i=0;i<7;i++){
    const y=h*(0.16+i*0.115)+Math.sin(time*0.00008+i)*h*0.008;
    ctx.strokeStyle='rgba(126,165,166,'+(0.025+wall*0.055)+')';
    ctx.beginPath();ctx.moveTo(0,y);ctx.bezierCurveTo(w*0.06,y-h*0.025,w*0.11,y+h*0.018,w*0.19,y+h*0.035);ctx.stroke();
    ctx.beginPath();ctx.moveTo(w,y+h*0.02);ctx.bezierCurveTo(w*0.94,y-h*0.02,w*0.89,y+h*0.014,w*0.81,y+h*0.03);ctx.stroke();
  }
  // A dark floor slowly rises into view in the deepest part of the descent.
  const floor=smooth(clamp((depth-0.62)/0.35,0,1));
  if(floor>0){
    const fg=ctx.createLinearGradient(0,h*0.78,0,h);
    fg.addColorStop(0,'rgba(1,7,13,0)');
    fg.addColorStop(1,'rgba(0,3,8,'+(floor*0.92)+')');
    ctx.fillStyle=fg;ctx.fillRect(0,h*0.72,w,h*0.28);
  }
  ctx.restore();
}

let bubbleSprite=null;
function drawBubble(x,y,r,alpha) {
  if(!bubbleSprite){
    const S=64;
    bubbleSprite=bakeSprite(S,S,()=>{
      const cx=S/2,rr=S/2-3;
      const g=ctx.createRadialGradient(cx-rr*0.32,cx-rr*0.38,0,cx,cx,rr);
      g.addColorStop(0,'rgba(237,255,255,0.75)');g.addColorStop(0.22,'rgba(151,238,244,0.25)');
      g.addColorStop(0.8,'rgba(100,212,233,0.08)');g.addColorStop(1,'rgba(202,255,255,0.48)');
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cx,rr,0,TAU);ctx.fill();
      ctx.strokeStyle='rgba(212,255,255,0.62)';ctx.lineWidth=2.2;ctx.stroke();
    });
  }
  const prev=ctx.globalAlpha,d=r*2*(32/29);
  ctx.globalAlpha=alpha;ctx.drawImage(bubbleSprite,x-d/2,y-d/2,d,d);ctx.globalAlpha=prev;
}

function drawParticles(w,h,time,still,depth) {
  // While the craft is sinking, drifting plankton and bubbles stream upward: that is what makes the descent feel fast.
  const rush=1+sinkSmooth*7;
  ctx.strokeStyle='rgba(207,248,239,0.5)';
  for(const p of plankton){
    if(!still){p.y-=p.speed*(0.45+depth*0.35)*rush;p.x+=Math.sin(time*0.00045+p.phase)*0.12;if(p.y<0)p.y=h;}
    const a=p.alpha*(0.85-depth*0.35);
    if(sinkSmooth>0.12){ctx.globalAlpha=a*1.4;ctx.lineWidth=p.r*1.1;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x,p.y+sinkSmooth*(10+p.r*9));ctx.stroke();ctx.globalAlpha=1;}
    else{ctx.fillStyle='rgba(207,248,239,'+a+')';ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,TAU);ctx.fill();}
  }
  for(const p of bubbles){
    if(!still){p.y-=p.speed*(0.65+depth*0.3)*(1+sinkSmooth*3);p.x+=Math.sin(time*0.0006+p.phase)*p.drift*0.04;if(p.y<-10){p.y=h+10;p.x=rand(0,w);}}
    drawBubble(p.x,p.y,p.r,p.alpha);
  }
}

function drawFishSide(x,y,scale,palette,phase,time,dir=1,alpha=1,detail=1) {
  ctx.save();ctx.translate(x,y+Math.sin(time*0.002+phase)*2.5*scale);ctx.scale(dir*scale,scale);
  ctx.globalAlpha=alpha;
  const [base,belly,dark]=palette;
  const tailSwing=Math.sin(time*0.012+phase)*0.28;
  // Rear tail, animated independently.
  ctx.save();ctx.translate(-48,0);ctx.rotate(tailSwing);
  const tail=ctx.createLinearGradient(-28,-24,24,24);
  tail.addColorStop(0,dark);tail.addColorStop(0.45,base);tail.addColorStop(1,'rgba(230,247,226,0.8)');
  ctx.fillStyle=tail;ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(-22,-22,-44,-32);
  ctx.quadraticCurveTo(-34,-5,-43,0);ctx.quadraticCurveTo(-31,8,-44,31);
  ctx.quadraticCurveTo(-16,20,0,0);ctx.fill();ctx.restore();

  // Fins first, so the body naturally overlaps their bases.
  ctx.fillStyle=dark;ctx.beginPath();ctx.moveTo(-15,-8);ctx.quadraticCurveTo(6,-39,27,-22);
  ctx.lineTo(18,-7);ctx.closePath();ctx.fill();
  ctx.fillStyle=base;ctx.beginPath();ctx.moveTo(-7,6);ctx.quadraticCurveTo(18,18,42,34);
  ctx.quadraticCurveTo(17,31,-6,17);ctx.closePath();ctx.fill();
  ctx.save();ctx.translate(3,8);ctx.rotate(Math.sin(time*0.009+phase)*0.15);
  ctx.beginPath();ctx.moveTo(6,0);ctx.quadraticCurveTo(25,10,40,26);
  ctx.quadraticCurveTo(18,21,1,8);ctx.closePath();ctx.fill();ctx.restore();

  // Streamlined body with a multi-stop belly and back gradient.
  const body=ctx.createLinearGradient(0,-25,0,24);
  body.addColorStop(0,'#142b3a');body.addColorStop(0.15,base);body.addColorStop(0.45,base);
  body.addColorStop(0.73,belly);body.addColorStop(1,'#3a5c62');
  ctx.fillStyle=body;ctx.beginPath();ctx.moveTo(-49,0);
  ctx.bezierCurveTo(-37,-22,-8,-27,20,-20);
  ctx.quadraticCurveTo(48,-11,53,0);
  ctx.quadraticCurveTo(42,14,17,21);
  ctx.bezierCurveTo(-13,29,-38,19,-49,0);ctx.fill();

  // Gill cover and delicate gill slits.
  ctx.strokeStyle='rgba(11,38,47,0.62)';ctx.lineWidth=1.35;
  for(let i=0;i<4;i++){
    const gx=15+i*4;
    ctx.beginPath();ctx.moveTo(gx,-10);ctx.quadraticCurveTo(gx+5,0,gx+1,13);ctx.stroke();
  }
  ctx.strokeStyle='rgba(240,255,243,0.23)';ctx.lineWidth=1;
  ctx.beginPath();ctx.arc(10,0,15,-0.85,0.85);ctx.stroke();

  // Scale flecks and lateral-line highlight.
  if(detail){
    for(let row=0;row<2;row++)for(let i=0;i<7;i++){
      ctx.fillStyle='rgba(245,255,237,'+(0.1+row*0.025)+')';
      ctx.beginPath();ctx.ellipse(-23+i*8,-4+row*7,1.15,0.65,0,0,TAU);ctx.fill();
    }
    ctx.strokeStyle='rgba(220,253,236,0.36)';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(-35,-5);ctx.quadraticCurveTo(0,-12,34,-4);ctx.stroke();
  }
  // Eye with socket, iris and wet specular reflection.
  ctx.fillStyle='rgba(4,17,25,0.8)';ctx.beginPath();ctx.ellipse(36,-6,3.2,2.8,-0.15,0,TAU);ctx.fill();
  ctx.fillStyle='#d5e1d8';ctx.beginPath();ctx.arc(36.6,-6,1.55,0,TAU);ctx.fill();
  ctx.fillStyle='#08131a';ctx.beginPath();ctx.arc(37,-6,0.85,0,TAU);ctx.fill();
  // Mouth and snout highlight.
  ctx.strokeStyle='rgba(8,24,31,0.65)';ctx.lineWidth=1.2;
  ctx.beginPath();ctx.moveTo(48,5);ctx.quadraticCurveTo(53,7,56,3);ctx.stroke();
  ctx.strokeStyle='rgba(239,255,239,0.34)';ctx.lineWidth=1.4;
  ctx.beginPath();ctx.moveTo(-18,-17);ctx.quadraticCurveTo(16,-27,39,-14);ctx.stroke();
  ctx.restore();
}

function drawUndulatingFish(x,y,scale,palette,phase,time,dir,alpha,kind,depth) {
  const slender=kind===1||kind===4;
  const tall=kind===2||kind===3;
  const length=kind===1?1.42:kind===4?1.18:kind===3?0.84:kind===8?0.8:kind===9?0.88:kind===10?1.4:1;
  const bodyHeight=kind===2?31:kind===3?32:kind===8?42:kind===9?26:kind===10?12:kind===5?16:slender?13:21;
  const [base,belly,dark]=palette,marking=palette[3]||'rgba(16,43,54,0.52)',fin=palette[4]||dark;
  ctx.save();
  ctx.translate(x,y);
  ctx.scale(dir*scale*length,scale);
  ctx.globalAlpha=alpha;

  const tailSwing=Math.sin(time*0.0042+phase)*0.56;
  ctx.save();ctx.translate(-48,0);ctx.rotate(tailSwing);ctx.scale(0.86,0.66);
  const tail=ctx.createLinearGradient(-40,-28,8,28);
  tail.addColorStop(0,fin);tail.addColorStop(0.5,base);tail.addColorStop(1,belly);
  ctx.fillStyle=tail;
  ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(-30,-28,-52,-35);
  ctx.quadraticCurveTo(-42,-6,-50,0);ctx.quadraticCurveTo(-39,9,-52,34);
  ctx.quadraticCurveTo(-19,23,0,0);ctx.fill();ctx.restore();

  // Eight-point travelling spine: the rear third leads the wave while the head stays steady.
  ctx.beginPath();
  for(let segment=0;segment<=8;segment++){
    const t=segment/8, sx=-49+t*100;
    const wave=Math.sin(time*0.0038+phase-t*4.4)*t*t*(kind===4?15:11);
    const h=Math.pow(Math.sin(Math.PI*t),0.62)*bodyHeight;
    const sy=wave-h*(0.48+(tall?0.08:0));
    if(segment===0)ctx.moveTo(sx,sy);else ctx.lineTo(sx,sy);
  }
  for(let segment=8;segment>=0;segment--){
    const t=segment/8, sx=-49+t*100;
    const wave=Math.sin(time*0.0038+phase-t*4.4)*t*t*(kind===4?15:11);
    const h=Math.pow(Math.sin(Math.PI*t),0.62)*bodyHeight;
    ctx.lineTo(sx,wave+h*0.58);
  }
  ctx.closePath();
  const body=ctx.createLinearGradient(0,-bodyHeight,0,bodyHeight);
  body.addColorStop(0,dark);body.addColorStop(0.22,base);
  body.addColorStop(0.62,belly);body.addColorStop(1,belly);
  ctx.fillStyle=body;ctx.fill();
  // Dark deep-sea bodies get a faint rim of light so they read against black water.
  if(kind===8||kind===9||kind===10){ctx.strokeStyle='rgba(165,220,255,0.4)';ctx.lineWidth=1.4;ctx.stroke();}

  // Dorsal and pectoral fins bend with the current instead of moving as stickers.
  const finFlap=Math.sin(time*0.005+phase)*0.2;
  ctx.fillStyle=fin;
  ctx.globalAlpha*=0.9;ctx.beginPath();ctx.moveTo(-14,-10);ctx.quadraticCurveTo(2,-bodyHeight*0.72-5+finFlap*6,23,-12);ctx.lineTo(9,-6);ctx.closePath();ctx.fill();
  ctx.save();ctx.translate(8,bodyHeight*0.3);ctx.rotate(finFlap);ctx.scale(0.62,0.5);
  ctx.fillStyle=fin;ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(22,9,43,30);ctx.quadraticCurveTo(18,23,-5,9);ctx.closePath();ctx.fill();ctx.restore();

  // Distinct body patterns for a few reef and mid-water species.
  if(kind===2){
    ctx.strokeStyle=marking;ctx.lineWidth=3.6;
    for(let stripe=0;stripe<3;stripe++){
      const sx=-12+stripe*18;
      ctx.beginPath();ctx.moveTo(sx,-bodyHeight*0.5);ctx.quadraticCurveTo(sx+8,0,sx+3,bodyHeight*0.55);ctx.stroke();
    }
  }
  if(kind===3){
    for(let spine=0;spine<9;spine++){
      const a=spine/9*TAU,px=Math.cos(a)*18,py=Math.sin(a)*13;
      ctx.strokeStyle='rgba(221,235,212,0.5)';ctx.lineWidth=1.2;
      ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px+Math.cos(a)*5,py+Math.sin(a)*5);ctx.stroke();
    }
  }
  if(kind===5){
    ctx.save();ctx.globalCompositeOperation='lighter';
    for(let dot=0;dot<7;dot++){
      const dx=-12+dot*9,dy=4+Math.sin(time*0.003+phase+dot)*2;
      const glow=ctx.createRadialGradient(dx,dy,0,dx,dy,7);
      glow.addColorStop(0,marking.startsWith('#')?marking:'rgba(158,255,226,0.95)');glow.addColorStop(1,'rgba(82,230,214,0)');
      ctx.fillStyle=glow;ctx.beginPath();ctx.arc(dx,dy,7,0,TAU);ctx.fill();
    }
    ctx.restore();
  }

  if(kind===8){
    // Anglerfish: glowing lure on a stalk and a wide, toothy mouth.
    ctx.strokeStyle=dark;ctx.lineWidth=2.2;
    ctx.beginPath();ctx.moveTo(28,-15);ctx.quadraticCurveTo(52,-58,74,-36);ctx.stroke();
    const pulse=0.72+0.28*Math.sin(time*0.004+phase);
    ctx.save();ctx.globalCompositeOperation='lighter';
    const lure=ctx.createRadialGradient(74,-36,0,74,-36,26);
    lure.addColorStop(0,'rgba(220,255,255,'+pulse+')');lure.addColorStop(0.3,'rgba(120,235,255,'+(pulse*0.55)+')');lure.addColorStop(1,'rgba(60,160,255,0)');
    ctx.fillStyle=lure;ctx.beginPath();ctx.arc(74,-36,26,0,TAU);ctx.fill();ctx.restore();
    ctx.strokeStyle='rgba(6,4,12,0.9)';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(49,3);ctx.quadraticCurveTo(34,16,14,10);ctx.stroke();
    ctx.fillStyle='#f3f6ee';
    for(let tooth=0;tooth<7;tooth++){const tx=46-tooth*4.6,ty=4+tooth*0.9+Math.sin(tooth)*0.6;
      ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(tx-1.6,ty+7);ctx.lineTo(tx-3.2,ty+0.8);ctx.closePath();ctx.fill();}
  }
  if(kind===9){
    // Hatchetfish: silver flanks with rows of light organs along the belly.
    ctx.save();ctx.globalCompositeOperation='lighter';
    for(let dot=0;dot<9;dot++){
      const dx=-30+dot*8.5,dy=bodyHeight*0.34+Math.sin(dot*0.9)*1.5;
      const g=ctx.createRadialGradient(dx,dy,0,dx,dy,6);
      g.addColorStop(0,'rgba(170,255,255,0.95)');g.addColorStop(1,'rgba(90,220,255,0)');
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(dx,dy,6,0,TAU);ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle='rgba(235,248,255,0.5)';ctx.lineWidth=1.4;
    ctx.beginPath();ctx.moveTo(-34,-2);ctx.quadraticCurveTo(0,-bodyHeight*0.3,36,-1);ctx.stroke();
  }
  if(kind===10){
    // Viperfish / gulper: needle teeth, glowing chin barbel and a row of photophores.
    ctx.fillStyle='#eef4f0';
    for(let tooth=0;tooth<8;tooth++){const tx=48-tooth*3.6;
      ctx.beginPath();ctx.moveTo(tx,3);ctx.lineTo(tx-0.8,11);ctx.lineTo(tx-2.2,3.2);ctx.closePath();ctx.fill();}
    ctx.strokeStyle=fin;ctx.lineWidth=1.6;
    ctx.beginPath();ctx.moveTo(40,9);ctx.quadraticCurveTo(46,24,34,34);ctx.stroke();
    ctx.save();ctx.globalCompositeOperation='lighter';
    const bulb=ctx.createRadialGradient(34,34,0,34,34,12);
    bulb.addColorStop(0,marking);bulb.addColorStop(1,'rgba(80,255,220,0)');
    ctx.fillStyle=bulb;ctx.beginPath();ctx.arc(34,34,12,0,TAU);ctx.fill();
    for(let dot=0;dot<10;dot++){
      const dx=-36+dot*8,dy=5+Math.sin(time*0.003+phase+dot)*0.8;
      const g=ctx.createRadialGradient(dx,dy,0,dx,dy,4);
      g.addColorStop(0,marking);g.addColorStop(1,'rgba(80,255,220,0)');
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(dx,dy,4,0,TAU);ctx.fill();
    }
    ctx.restore();
  }

  // Gills, lateral specular line and a wet, reflective eye.
  ctx.strokeStyle='rgba(9,31,43,0.58)';ctx.lineWidth=1.3;
  for(let gill=0;gill<4;gill++){
    const gx=14+gill*4;
    ctx.beginPath();ctx.moveTo(gx,-9);ctx.quadraticCurveTo(gx+4,1,gx+1,12);ctx.stroke();
  }
  ctx.strokeStyle='rgba(235,255,244,0.34)';ctx.lineWidth=1.2;
  ctx.beginPath();ctx.moveTo(-32,-6);ctx.quadraticCurveTo(0,-bodyHeight*0.65,37,-5);ctx.stroke();
  ctx.fillStyle='rgba(2,16,24,0.86)';ctx.beginPath();ctx.ellipse(37,-5,3.6,3,0,0,TAU);ctx.fill();
  ctx.fillStyle='#effff7';ctx.beginPath();ctx.arc(37.8,-5.8,1.25,0,TAU);ctx.fill();
  ctx.restore();
}

const FISH_FRAMES=8,SPR_S=1.6,SPR_LW=300,SPR_LH=130,SPR_OX=200,SPR_OY=65;
const fishSprites=new Map();  // palette array -> Map(kind*100+frame -> canvas); oldest palettes are evicted
function fishSpriteFrame(tint,kind,frame) {
  let byKind=fishSprites.get(tint);
  if(!byKind){
    if(fishSprites.size>=10)fishSprites.delete(fishSprites.keys().next().value);
    byKind=new Map();fishSprites.set(tint,byKind);
  }
  const key=kind*100+frame;let c=byKind.get(key);
  if(!c){
    c=bakeSprite(Math.ceil(SPR_LW*SPR_S),Math.ceil(SPR_LH*SPR_S),()=>{ctx.scale(SPR_S,SPR_S);ctx.translate(SPR_OX,SPR_OY);drawUndulatingFish(0,0,1,tint,frame/FISH_FRAMES*TAU,0,1,1,kind,0);});
    byKind.set(key,c);
  }
  return c;
}
/** Same fish, drawn from a cached frame: one drawImage instead of ~3 gradients and ~40 path operations. */
function drawFishSprite(x,y,size,tint,phase,time,dir,alpha,kind,depth) {
  if(size>1.6){drawUndulatingFish(x,y,size,tint,phase,time,dir,alpha,kind,depth);return;}
  const th=(((time*0.004+phase)%TAU)+TAU)%TAU,fr=Math.floor(th/TAU*FISH_FRAMES)%FISH_FRAMES;
  ctx.save();ctx.translate(x,y);ctx.scale(dir*size,size);ctx.globalAlpha=alpha;
  ctx.drawImage(fishSpriteFrame(tint,kind,fr),-SPR_OX,-SPR_OY,SPR_LW,SPR_LH);ctx.restore();
}

function drawFishSchools(w,h,time,still,depth,delta) {
  const useSprites=qNow().sprites,drawFish=useSprites?drawFishSprite:drawUndulatingFish;
  const wt=zoneWeights(depth),unit=clamp(w/430,0.8,1.7);
  // Visible water lies between the waterline (or the top bar) and the question panel.
  const yMin=Math.max(h*0.1,h*(0.305-depth*0.78)+h*0.05),yMax=h*0.57;
  for(const f of fish){
    const sp=SPECIES[f.sp];
    if(!still){
      // Fish swim sideways in the direction they face; nearer fish are faster, bigger and brighter (parallax).
      f.x+=f.dir*delta*0.03*unit*(0.4+0.9*f.z)*sp.speed*f.vel;
      f.phase+=delta*0.00055;
      // Off-screen, or its zone has faded away: bring in a species that belongs at this depth.
      if((f.dir>0&&f.x>w+190)||(f.dir<0&&f.x<-190))spawnFish(f,w,depth,false,time);
      else if((wt[sp.zone]||0)<0.04)spawnFish(f,w,depth,true,time);
    }
    const size=Math.min(1.6,(0.34+f.z*0.7)*sp.scale*unit);
    const bob=still?0:Math.sin(time*0.0007+f.bob)*7*size;
    const y=yMin+(yMax-yMin)*f.v+bob-sinkSmooth*h*0.05*(0.3+f.z);
    let x=f.x;
    const scatter=eventScene?.kind==='predator'?(1-smooth((performance.now()-eventScene.start)/380)):0;
    if(scatter) x-=eventScene.direction*scatter*(14+f.group*5);
    // Species fade in and out as the dive crosses zone boundaries, so one scene dissolves into the next.
    const a=clamp(0.34+f.z*0.66,0,1)*(wt[sp.zone]||0)*(1-depth*0.2)*smooth((time-f.born)/1400);
    if(a>0.02&&x>-200&&x<w+200&&y>-90&&y<h+90){
      if(sp.kind===6) drawManta(x,y,size*1.1,f.phase,time,a*0.85);
      else if(sp.kind===7) drawJellyfish(x,y,size*0.5,f.phase,time,a*0.8);
      else drawFish(x,y,size,sp.pal,f.phase,time,f.dir,a,sp.kind,depth);
    }
  }

  // A slow, solitary animal crosses the outer edge to make the water feel inhabited.
  const sweep=(time*0.000023)%1;
  const x=mix(-155,w+155,sweep);
  const y=h*0.28+Math.sin(time*0.00055)*h*0.035;
  drawFish(x,y,0.78,SPECIES[5].pal,1.3,time,1,0.2*Math.max(wt.sun,wt.twi),1,depth);

  const twilight=wt.twi,midnight=wt.mid,abyss=wt.aby;
  const jellyBlend=twilight*0.75+midnight*0.9+abyss*0.25;
  for(const j of jellies){
    if(!still) j.v-=j.speed*delta;
    if(j.v<-0.12) j.v=1.08;
    const sway=still?0:Math.sin(time*0.00042+j.phase)*j.drift;
    drawJellyfish((j.u+sway)*w,j.v*h,j.scale,j.phase,time,jellyBlend*0.72);
  }

  if(depth>0.72){
    const pass=(time*0.000022)%1;
    const whaleX=mix(-430,w+430,pass);
    const whaleY=h*0.34+Math.sin(time*0.00022)*h*0.045;
    drawWhaleSide(whaleX,whaleY,0.72+depth*0.22,2.4,time,0.12+abyss*0.2,false);
  }
}

function drawJellyfish(x,y,scale,phase,time,alpha=0.85) {
  ctx.save();ctx.translate(x,y+Math.sin(time*0.001+phase)*10*scale);ctx.scale(scale,scale);
  ctx.globalAlpha=alpha;
  const glow=ctx.createRadialGradient(0,-8,1,0,0,50);
  glow.addColorStop(0,'rgba(201,255,255,0.65)');glow.addColorStop(0.25,'rgba(112,220,240,0.38)');glow.addColorStop(1,'rgba(105,116,255,0)');
  ctx.fillStyle=glow;ctx.beginPath();ctx.arc(0,0,50,0,TAU);ctx.fill();
  const dome=ctx.createLinearGradient(-20,-28,18,17);
  dome.addColorStop(0,'rgba(236,255,255,0.76)');dome.addColorStop(0.35,'rgba(132,190,238,0.55)');dome.addColorStop(1,'rgba(87,75,175,0.15)');
  ctx.fillStyle=dome;ctx.beginPath();ctx.moveTo(-28,5);ctx.bezierCurveTo(-35,-31,31,-37,29,5);
  ctx.quadraticCurveTo(0,22,-28,5);ctx.fill();
  ctx.strokeStyle='rgba(210,255,255,0.7)';ctx.lineWidth=1.3;
  for(let i=0;i<7;i++){
    const tx=-22+i*7;const wave=Math.sin(time*0.003+i+phase)*8;
    ctx.beginPath();ctx.moveTo(tx,8);ctx.bezierCurveTo(tx-10+wave,26,tx+8-wave,42,tx+wave,72+(i%3)*8);ctx.stroke();
  }
  ctx.restore();
}

function drawManta(x,y,scale,phase,time,alpha=1) {
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.globalAlpha=alpha;
  const flap=Math.sin(time*0.004+phase)*26;
  // Broad diamond wings with layered membrane shading.
  const wing=ctx.createLinearGradient(0,-5,0,80);
  wing.addColorStop(0,'#263c54');wing.addColorStop(0.4,'#547d8e');wing.addColorStop(1,'#152d42');
  ctx.fillStyle=wing;ctx.beginPath();ctx.moveTo(0,-52);
  ctx.bezierCurveTo(-40,-54,-95,-108-flap,-180,-75-flap*0.45);
  ctx.quadraticCurveTo(-151,16,-40,50);ctx.quadraticCurveTo(0,74,40,50);
  ctx.bezierCurveTo(151,16,180,-75+flap*0.45,180,-75+flap);
  ctx.bezierCurveTo(95,-108+flap,40,-54,0,-52);ctx.closePath();ctx.fill();
  // White belly and cephalic lobes.
  ctx.fillStyle='rgba(211,231,224,0.82)';ctx.beginPath();ctx.ellipse(0,15,48,58,0,0,TAU);ctx.fill();
  ctx.fillStyle='#314d5d';
  for(let side of [-1,1]){
    ctx.beginPath();ctx.moveTo(side*24,-40);ctx.quadraticCurveTo(side*55,-20,side*61,12);
    ctx.quadraticCurveTo(side*40,3,side*24,-5);ctx.fill();
  }
  ctx.fillStyle='#071923';ctx.beginPath();ctx.arc(-36,-15,4.4,0,TAU);ctx.arc(36,-15,4.4,0,TAU);ctx.fill();
  ctx.strokeStyle='rgba(226,255,248,0.36)';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(-10,40);ctx.quadraticCurveTo(0,47,10,40);ctx.stroke();
  ctx.restore();
}

function drawTurtle(x,y,scale,phase,time,alpha=1) {
  ctx.save();ctx.translate(x,y);ctx.rotate(Math.sin(time*0.001+phase)*0.08);ctx.scale(scale,scale);ctx.globalAlpha=alpha;
  const shell=ctx.createRadialGradient(-14,-14,5,0,0,60);
  shell.addColorStop(0,'#879176');shell.addColorStop(0.55,'#526957');shell.addColorStop(1,'#1b302e');
  ctx.fillStyle=shell;ctx.beginPath();ctx.ellipse(0,0,54,39,0,0,TAU);ctx.fill();
  ctx.strokeStyle='rgba(213,223,157,0.5)';ctx.lineWidth=2;
  for(let i=-2;i<=2;i++){ctx.beginPath();ctx.ellipse(i*17,0,12,28,i*0.1,0,TAU);ctx.stroke();}
  const skin='#526c5e';ctx.fillStyle=skin;
  ctx.beginPath();ctx.ellipse(0,-54,20,24,0,0,TAU);ctx.fill();
  ctx.beginPath();ctx.moveTo(-35,-13);ctx.quadraticCurveTo(-80,-44,-93,-20);ctx.quadraticCurveTo(-68,0,-32,12);ctx.fill();
  ctx.beginPath();ctx.moveTo(35,-13);ctx.quadraticCurveTo(80,-44,93,-20);ctx.quadraticCurveTo(68,0,32,12);ctx.fill();
  ctx.beginPath();ctx.ellipse(-31,32,20,11,-0.35,0,TAU);ctx.ellipse(31,32,20,11,0.35,0,TAU);ctx.fill();
  ctx.fillStyle='#101e20';ctx.beginPath();ctx.arc(7,-57,2.4,0,TAU);ctx.fill();
  ctx.strokeStyle='rgba(222,236,188,0.35)';ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(0,-54,20,-0.3,1.5);ctx.stroke();
  ctx.restore();
}

function drawDolphin(x,y,scale,phase,time,dir=1,alpha=1) {
  ctx.save();ctx.translate(x,y+Math.sin(time*0.0018+phase)*13*scale);ctx.rotate(Math.sin(time*0.0014+phase)*0.1);
  ctx.scale(dir*scale,scale);ctx.globalAlpha=alpha;
  const body=ctx.createLinearGradient(0,-27,0,28);
  body.addColorStop(0,'#203b4d');body.addColorStop(0.35,'#627e8b');body.addColorStop(0.7,'#bcc8c1');body.addColorStop(1,'#435b68');
  ctx.fillStyle=body;ctx.beginPath();ctx.moveTo(-105,0);
  ctx.bezierCurveTo(-70,-30,-6,-34,42,-17);ctx.quadraticCurveTo(79,-7,105,-2);
  ctx.quadraticCurveTo(82,11,55,15);ctx.bezierCurveTo(8,31,-60,24,-105,0);ctx.fill();
  ctx.fillStyle='#315269';ctx.beginPath();ctx.moveTo(-5,-19);ctx.lineTo(10,-52);ctx.lineTo(25,-16);ctx.fill();
  ctx.beginPath();ctx.moveTo(8,12);ctx.quadraticCurveTo(25,20,45,34);ctx.quadraticCurveTo(19,29,0,19);ctx.fill();
  ctx.save();ctx.translate(-92,0);ctx.rotate(Math.sin(time*0.01+phase)*0.2);
  ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-23,-22);ctx.lineTo(-18,0);ctx.lineTo(-23,22);ctx.closePath();ctx.fill();ctx.restore();
  ctx.fillStyle='#071923';ctx.beginPath();ctx.arc(65,-7,3.2,0,TAU);ctx.fill();
  ctx.strokeStyle='rgba(245,255,247,0.4)';ctx.lineWidth=1.8;ctx.beginPath();ctx.moveTo(-45,-18);ctx.quadraticCurveTo(18,-30,76,-9);ctx.stroke();
  ctx.restore();
}

function drawWhaleSide(x,y,scale,phase,time,alpha=1,whaleShark=false) {
  ctx.save();ctx.translate(x,y+Math.sin(time*0.00055+phase)*6*scale);ctx.scale(scale,scale);ctx.globalAlpha=alpha;
  const body=ctx.createLinearGradient(0,-65,0,68);
  body.addColorStop(0,whaleShark?'#345c72':'#1d4058');
  body.addColorStop(0.38,whaleShark?'#477f90':'#38677d');
  body.addColorStop(0.7,whaleShark?'#b8d0ca':'#8eafb4');
  body.addColorStop(1,'#1a374e');
  ctx.fillStyle=body;ctx.beginPath();ctx.moveTo(-270,0);
  ctx.bezierCurveTo(-208,-66,-70,-76,95,-54);ctx.quadraticCurveTo(227,-42,270,0);
  ctx.quadraticCurveTo(215,46,93,59);ctx.bezierCurveTo(-78,79,-218,54,-270,0);ctx.fill();
  // Massive flukes and pectoral fin give scale and weight.
  ctx.fillStyle='#23465d';ctx.beginPath();ctx.moveTo(-246,0);ctx.quadraticCurveTo(-291,-70,-338,-85);
  ctx.quadraticCurveTo(-315,-19,-285,0);ctx.quadraticCurveTo(-315,20,-338,85);
  ctx.quadraticCurveTo(-284,70,-246,0);ctx.fill();
  ctx.beginPath();ctx.moveTo(12,25);ctx.quadraticCurveTo(92,54,150,133);
  ctx.quadraticCurveTo(82,99,34,71);ctx.closePath();ctx.fill();
  // Tiny light spots create a whale-shark pattern.
  if(whaleShark){
    for(let row=0;row<5;row++)for(let i=0;i<20;i++){
      const xx=-170+i*18, yy=-35+row*16+Math.sin(i*0.55)*3;
      ctx.fillStyle='rgba(225,248,232,0.48)';ctx.beginPath();ctx.arc(xx,yy,1.7+(i%3)*0.25,0,TAU);ctx.fill();
    }
  } else {
    ctx.strokeStyle='rgba(187,226,225,0.22)';ctx.lineWidth=2;
    for(let i=0;i<5;i++){ctx.beginPath();ctx.moveTo(115+i*8,-12);ctx.quadraticCurveTo(129+i*7,14,116+i*7,31);ctx.stroke();}
  }
  ctx.fillStyle='#071c29';ctx.beginPath();ctx.arc(231,-10,5,0,TAU);ctx.fill();
  ctx.strokeStyle='rgba(228,248,242,0.35)';ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(-170,-34);ctx.quadraticCurveTo(-5,-86,164,-37);ctx.stroke();
  ctx.restore();
}

function drawSharkPass(x,y,scale,variant,phase,time,direction=1,jaw=0,alpha=1) {
  const sp=SHARKS[variant%SHARKS.length];
  ctx.save();ctx.translate(x,y);ctx.scale(direction*scale,scale);ctx.globalAlpha=alpha;

  // Tail and fins are silhouettes first; body shading supplies the volume.
  const fin=ctx.createLinearGradient(-80,-100,90,100);
  fin.addColorStop(0,'#172b39');fin.addColorStop(0.55,sp.top);fin.addColorStop(1,'#132737');
  ctx.fillStyle=fin;
  ctx.beginPath();ctx.moveTo(-194,0);ctx.quadraticCurveTo(-242,-58,-286,-78);
  ctx.quadraticCurveTo(-268,-18,-224,0);ctx.quadraticCurveTo(-268,18,-286,78);
  ctx.quadraticCurveTo(-236,57,-194,0);ctx.fill();
  ctx.beginPath();ctx.moveTo(-78,-35);ctx.quadraticCurveTo(-45,-95,-8,-118);
  ctx.quadraticCurveTo(5,-72,18,-34);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(-18,17);ctx.quadraticCurveTo(40,23,100,104);
  ctx.quadraticCurveTo(36,74,-4,48);ctx.closePath();ctx.fill();

  const body=ctx.createLinearGradient(0,-58,0,52);
  body.addColorStop(0,'#172e3d');body.addColorStop(0.2,sp.top);
  body.addColorStop(0.48,sp.side);body.addColorStop(0.72,sp.belly);body.addColorStop(1,'#405765');
  ctx.fillStyle=body;ctx.beginPath();ctx.moveTo(-220,0);
  ctx.bezierCurveTo(-183,-43,-86,-57,12,-43);
  ctx.quadraticCurveTo(112,-31,192,-8);
  ctx.quadraticCurveTo(222,-2,230,5);
  ctx.quadraticCurveTo(202,19,158,26);
  ctx.bezierCurveTo(54,54,-127,47,-220,0);ctx.closePath();ctx.fill();

  // Gill slits and a small eye establish the animal's anatomy without caricature.
  ctx.strokeStyle='rgba(10,26,36,0.62)';ctx.lineWidth=2;
  for(let i=0;i<5;i++){
    const gx=87+i*9;
    ctx.beginPath();ctx.moveTo(gx,-25);ctx.quadraticCurveTo(gx+6,-2,gx+1,15);ctx.stroke();
  }
  ctx.fillStyle='#071621';ctx.beginPath();ctx.arc(181,-15,3.1,0,TAU);ctx.fill();
  ctx.fillStyle='rgba(227,239,230,0.8)';ctx.beginPath();ctx.arc(181.8,-15.7,0.9,0,TAU);ctx.fill();

  // Slightly opening jaw is only visible at the closest part of the pass.
  ctx.fillStyle='rgba(8,12,17,0.9)';ctx.beginPath();
  ctx.moveTo(188,5);ctx.quadraticCurveTo(210,8+jaw*15,228,7+jaw*22);
  ctx.quadraticCurveTo(213,19+jaw*27,190,12);ctx.closePath();ctx.fill();
  if(jaw>0.12){
    ctx.fillStyle='rgba(222,221,202,0.78)';
    for(let i=0;i<5;i++){
      const tx=194+i*5;
      ctx.beginPath();ctx.moveTo(tx,7+jaw*4);ctx.lineTo(tx+2.5,12+jaw*11);ctx.lineTo(tx+4.5,8+jaw*4);ctx.fill();
    }
  }
  ctx.strokeStyle='rgba(224,237,229,0.18)';ctx.lineWidth=1.4;
  ctx.beginPath();ctx.moveTo(-140,-24);ctx.quadraticCurveTo(-18,-66,139,-28);ctx.stroke();
  ctx.restore();
}

function drawFrontShark(x,y,scale,variant,jaw,time,alpha=1) {
  const sp=SHARKS[variant%SHARKS.length];
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.globalAlpha=alpha;
  // Broad pectoral fins and rear dorsal silhouette sit behind the head.
  const finGrad=ctx.createLinearGradient(0,-70,0,130);
  finGrad.addColorStop(0,sp.fin);finGrad.addColorStop(0.45,sp.top);finGrad.addColorStop(1,'#142e40');
  ctx.fillStyle=finGrad;
  ctx.beginPath();ctx.moveTo(-65,-2);ctx.bezierCurveTo(-135,-42,-208,-94,-292,-109);
  ctx.quadraticCurveTo(-255,-12,-167,76);ctx.quadraticCurveTo(-101,104,-55,66);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(65,-2);ctx.bezierCurveTo(135,-42,208,-94,292,-109);
  ctx.quadraticCurveTo(255,-12,167,76);ctx.quadraticCurveTo(101,104,55,66);ctx.closePath();ctx.fill();
  ctx.strokeStyle='rgba(226,245,239,0.4)';ctx.lineWidth=4;
  ctx.beginPath();ctx.moveTo(-72,-8);ctx.quadraticCurveTo(-193,-92,-282,-102);ctx.stroke();
  ctx.beginPath();ctx.moveTo(72,-8);ctx.quadraticCurveTo(193,-92,282,-102);ctx.stroke();
  ctx.beginPath();ctx.moveTo(-37,-111);ctx.quadraticCurveTo(-16,-174,0,-214);ctx.quadraticCurveTo(18,-174,39,-111);ctx.closePath();ctx.fill();

  // Main head, shaped with a broad brow, tapered snout and rounded lower cheeks.
  const body=ctx.createLinearGradient(-170,-100,180,145);
  body.addColorStop(0,'#20384c');body.addColorStop(0.2,sp.top);body.addColorStop(0.42,sp.side);
  body.addColorStop(0.51,sp.belly);body.addColorStop(0.68,sp.side);body.addColorStop(1,sp.fin);
  ctx.fillStyle=body;ctx.beginPath();ctx.moveTo(0,-193);
  ctx.bezierCurveTo(-107,-164,-151,-82,-144,-7);
  ctx.bezierCurveTo(-134,70,-84,133,0,150);
  ctx.bezierCurveTo(84,133,134,70,144,-7);
  ctx.bezierCurveTo(151,-82,107,-164,0,-193);ctx.closePath();ctx.fill();

  // Hammerhead brow and tiger stripes are varied per encounter.
  if(sp.pattern==='hammer'){
    ctx.fillStyle=sp.side;ctx.beginPath();ctx.roundRect(-182,-61,364,54,24);ctx.fill();
  }
  if(sp.pattern==='tiger'){
    ctx.strokeStyle='rgba(17,36,47,0.56)';ctx.lineWidth=9;
    for(let i=0;i<9;i++){const xx=-95+i*24;ctx.beginPath();ctx.moveTo(xx,-112);ctx.quadraticCurveTo(xx-16,-20,xx,67);ctx.stroke();}
  }

  // Gill slits and sculpted ridges on both flanks.
  ctx.strokeStyle='rgba(13,35,48,0.64)';ctx.lineWidth=4;
  for(let i=0;i<5;i++){
    const yy=-26+i*16;
    ctx.beginPath();ctx.moveTo(-94-i*3,yy-11);ctx.quadraticCurveTo(-113-i*3,yy,-96-i*3,yy+12);ctx.stroke();
    ctx.beginPath();ctx.moveTo(94+i*3,yy-11);ctx.quadraticCurveTo(113+i*3,yy,96+i*3,yy+12);ctx.stroke();
  }
  // Eyes stare directly at the player.
  for(const side of [-1,1]){
    ctx.fillStyle='rgba(2,14,23,0.84)';ctx.beginPath();ctx.ellipse(side*78,-52,22,17,side*0.12,0,TAU);ctx.fill();
    ctx.fillStyle=sp.eye;ctx.beginPath();ctx.arc(side*79,-52,10,0,TAU);ctx.fill();
    ctx.fillStyle='#f6ffff';ctx.beginPath();ctx.arc(side*82,-56,3.6,0,TAU);ctx.fill();
    ctx.fillStyle='#07131c';ctx.beginPath();ctx.ellipse(side*79,-52,2.3,7,0,0,TAU);ctx.fill();
  }
  // Nose and pores.
  ctx.fillStyle='rgba(8,25,37,0.62)';ctx.beginPath();ctx.ellipse(-26,13,7,3,0,0,TAU);ctx.ellipse(26,13,7,3,0,0,TAU);ctx.fill();

  // Mouth cavity and moving lower jaw.
  const mouthW=104;
  ctx.fillStyle='#170b13';ctx.beginPath();ctx.moveTo(-mouthW,38);
  ctx.quadraticCurveTo(0,24-jaw*35,mouthW,38);
  ctx.quadraticCurveTo(84,76+jaw*64,0,85+jaw*72);
  ctx.quadraticCurveTo(-84,76+jaw*64,-mouthW,38);ctx.closePath();ctx.fill();
  ctx.strokeStyle='#a35059';ctx.lineWidth=7;
  ctx.beginPath();ctx.moveTo(-mouthW+3,40);ctx.quadraticCurveTo(0,25-jaw*34,mouthW-3,40);ctx.stroke();
  // Upper and lower serrated teeth.
  ctx.fillStyle='#fff3dc';
  for(let i=0;i<15;i++){
    const tx=-91+i*13, curve=Math.abs(tx)/91;
    ctx.beginPath();ctx.moveTo(tx,37+curve*8);ctx.lineTo(tx+6,51+curve*8+jaw*8);ctx.lineTo(tx+12,38+curve*8);ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.moveTo(tx,85+jaw*65);ctx.lineTo(tx+6,72+jaw*48);ctx.lineTo(tx+12,85+jaw*65);ctx.closePath();ctx.fill();
  }
  // Wet skin highlights.
  ctx.strokeStyle='rgba(241,255,246,0.28)';ctx.lineWidth=3;
  ctx.beginPath();ctx.arc(0,8,111,0.16,Math.PI-0.16);ctx.stroke();
  ctx.restore();
}

function drawOctopus(x,y,scale,phase,time,alpha=1) {
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.globalAlpha=alpha;
  const mantle=ctx.createRadialGradient(-20,-35,5,0,0,75);
  mantle.addColorStop(0,'#a77b70');mantle.addColorStop(0.4,'#73515a');mantle.addColorStop(1,'#302b36');
  ctx.fillStyle=mantle;ctx.beginPath();ctx.ellipse(0,-38,48,62,-0.1,0,TAU);ctx.fill();
  for(let arm=0;arm<8;arm++){
    const a=arm/8*TAU, startX=Math.cos(a)*24,startY=Math.sin(a)*22+4;
    ctx.strokeStyle=arm%2?'#a85b79':'#d58b9a';ctx.lineWidth=8;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(startX,startY);
    for(let k=1;k<=8;k++){
      const t=k/8, wave=Math.sin(time*0.002+phase+arm*0.8+t*5)*16*t;
      const xx=startX+Math.cos(a)*t*100+wave;
      const yy=startY+Math.sin(a)*t*86+Math.cos(time*0.0018+arm+t*4)*12*t;
      ctx.lineTo(xx,yy);
      ctx.fillStyle='rgba(255,225,219,0.54)';
      if(k%2===0){ctx.beginPath();ctx.arc(xx,yy,2.2,0,TAU);ctx.fill();}
    }
    ctx.stroke();
  }
  ctx.fillStyle='#161520';ctx.beginPath();ctx.arc(-12,-52,4,0,TAU);ctx.arc(12,-52,4,0,TAU);ctx.fill();
  ctx.restore();
}

/* ---- Surface boat and dive ----
 * At 0 m the craft floats on the sea (mast, ripples, half out of the water). Each correct answer sinks it: it tips nose-down,
 * splashes through the surface, trails bubbles and settles into the underwater view while the scenery scrolls past. */
function surfaceWaveAt(x,time) { return Math.sin(x*0.013+time*0.00062)*3.2+Math.sin(x*0.006-time*0.00038)*2.6; }
function clipSea(w,h,time,depth,above) {
  const base=h*(0.305-depth*0.78)+camDriftY,far=above?-600:h+600;
  ctx.beginPath();ctx.moveTo(-10,far);
  for(let x=-10;x<=w+14;x+=14)ctx.lineTo(x,base+surfaceWaveAt(x,time));
  ctx.lineTo(w+14,far);ctx.closePath();ctx.clip();
}
function drawBoatFoam(x,wy,size,time,still) {
  ctx.save();ctx.strokeStyle='rgba(240,255,250,0.9)';ctx.lineWidth=1.8;
  const wide=62*size;
  for(let i=0;i<3;i++){const r=still?i/3:((time*0.0005+i/3)%1);ctx.globalAlpha=(1-r)*0.55;ctx.beginPath();ctx.ellipse(x,wy+3,wide*(0.9+r*0.9),4+r*5,0,0,TAU);ctx.stroke();}
  if(sinkSmooth>0.06&&!still){
    ctx.fillStyle='rgba(245,255,252,0.95)';
    for(let i=0;i<14;i++){const u=((time*0.0011+i*0.37)%1),px=x+Math.sin(i*2.3)*wide,py=wy-Math.sin(u*Math.PI)*52*size*sinkSmooth;
      ctx.globalAlpha=(1-u)*0.85*Math.min(1,sinkSmooth*1.6);ctx.beginPath();ctx.arc(px,py,1.6+u*1.8,0,TAU);ctx.fill();}
  }
  ctx.restore();
}

function drawSubmersible(w,h,time,depth,still,panic=0,overrideX=null,overrideY=null) {
  const size=clamp(w/760,0.55,0.9);
  const x=overrideX===null?w*0.5+Math.sin(time*0.00021)*w*0.012:overrideX;
  const dive=smooth(depth/0.09),surf=1-dive;
  const wl=h*(0.305-depth*0.78)+camDriftY,waterY=wl+surfaceWaveAt(x,time);
  const bob=still?0:Math.sin(time*0.0008)*4;
  const afloat=waterY-8*size;                       // the hull rides low in the water
  const y=overrideY===null?mix(afloat,h*0.575+bob,dive):overrideY;
  const pitch=overrideY===null?sinkSmooth*0.36*(0.35+0.65*dive)+(still?0:Math.sin(time*0.0011)*0.045*surf):0;
  if(overrideY===null&&y-58*size<waterY+4){
    ctx.save();clipSea(w,h,time,depth,true);paintCraft(x,y,size,time,depth,still,panic,pitch,surf);ctx.restore();
    ctx.save();clipSea(w,h,time,depth,false);ctx.globalAlpha=0.5;paintCraft(x,y,size,time,depth,still,panic,pitch,surf);ctx.restore();
    drawBoatFoam(x,waterY,size,time,still);
  } else paintCraft(x,y,size,time,depth,still,panic,pitch,surf);
  craftBubbles(x,y,size,time,still,overrideX,overrideY===null?waterY+2:-1e9);
}

function paintCraft(x,y,size,time,depth,still,panic,pitch,mast) {
  const shake=still?0:Math.sin(time*0.073)*panic*5;
  ctx.save();ctx.translate(x+shake,y+Math.cos(time*0.061)*panic*2);ctx.rotate(pitch);ctx.scale(size,size);

  // The craft lamp becomes the key light as the sunlight disappears.
  const flicker=panic>0&&!still?0.68+0.32*Math.sin(time*0.046):1;
  const lampPower=(0.13+depth*0.58)*flicker;
  const lamp=ctx.createLinearGradient(12,4,205,150);
  lamp.addColorStop(0,'rgba(196,255,237,'+(lampPower*0.72)+')');
  lamp.addColorStop(0.38,'rgba(106,220,233,'+(lampPower*0.22)+')');
  lamp.addColorStop(1,'rgba(76,178,223,0)');
  ctx.fillStyle=lamp;ctx.beginPath();ctx.moveTo(16,-4);ctx.lineTo(260,-110);ctx.lineTo(286,176);ctx.lineTo(12,22);ctx.closePath();ctx.fill();

  // Particles caught by the beam are deterministic and reused every frame.
  ctx.save();ctx.globalCompositeOperation='screen';
  for(let i=0;i<16;i++){
    const q=(time*0.00012+i*0.071)%1;
    const px=52+q*185,py=22+q*102+Math.sin(time*0.001+i)*8;
    const glow=ctx.createRadialGradient(px,py,0,px,py,2.5+q*3);
    glow.addColorStop(0,'rgba(207,255,235,0.74)');glow.addColorStop(1,'rgba(111,218,232,0)');
    ctx.fillStyle=glow;ctx.beginPath();ctx.arc(px,py,2.5+q*3,0,TAU);ctx.fill();
  }
  ctx.restore();

  // Rear thrusters and tail fins.
  const fin=ctx.createLinearGradient(-65,-24,70,34);
  fin.addColorStop(0,'#142d41');fin.addColorStop(0.5,'#6f9aa5');fin.addColorStop(1,'#183347');
  ctx.fillStyle=fin;
  ctx.beginPath();ctx.moveTo(-40,-13);ctx.lineTo(-76,-37);ctx.lineTo(-68,-4);ctx.lineTo(-44,8);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(-40,13);ctx.lineTo(-76,37);ctx.lineTo(-68,4);ctx.lineTo(-44,-8);ctx.closePath();ctx.fill();

  const hull=ctx.createLinearGradient(0,-31,0,33);
  hull.addColorStop(0,'#eff0d9');hull.addColorStop(0.18,'#83aeb6');hull.addColorStop(0.45,'#d6e7d9');hull.addColorStop(0.72,'#466a7a');hull.addColorStop(1,'#172e43');
  ctx.fillStyle=hull;ctx.beginPath();ctx.ellipse(0,0,61,27,0,0,TAU);ctx.fill();
  ctx.strokeStyle='rgba(238,255,246,0.7)';ctx.lineWidth=2.2;ctx.stroke();
  ctx.fillStyle='#1b4358';ctx.beginPath();ctx.ellipse(6,-2,27,16,0,Math.PI,TAU);ctx.fill();
  const glass=ctx.createLinearGradient(-16,-18,24,12);
  glass.addColorStop(0,'#dffff0');glass.addColorStop(0.35,'#63c9d5');glass.addColorStop(1,'#173c59');
  ctx.fillStyle=glass;ctx.beginPath();ctx.ellipse(7,-3,21,13,0,0,TAU);ctx.fill();
  ctx.strokeStyle='rgba(234,255,251,0.84)';ctx.lineWidth=2;ctx.stroke();
  ctx.fillStyle='#ffd27a';ctx.beginPath();ctx.arc(53,-1,5,0,TAU);ctx.fill();
  ctx.fillStyle='#8cfff0';ctx.beginPath();ctx.arc(55,10,3.1,0,TAU);ctx.fill();

  ctx.strokeStyle='rgba(224,243,237,0.58)';ctx.lineWidth=1.4;
  ctx.beginPath();ctx.moveTo(-28,-16);ctx.quadraticCurveTo(3,-28,35,-15);ctx.stroke();
  ctx.fillStyle='#0d2638';ctx.beginPath();ctx.roundRect(-28,20,50,8,4);ctx.fill();
  ctx.fillStyle='#70d4dc';ctx.fillRect(-22,21,11,5);ctx.fillRect(-5,21,11,5);
  if(mast>0.02){
    // Antenna mast, flag and a blinking beacon while the craft is still on the surface.
    ctx.globalAlpha=Math.min(1,mast*1.5);
    ctx.strokeStyle='#d8e8e6';ctx.lineWidth=2.6;ctx.beginPath();ctx.moveTo(-14,-26);ctx.lineTo(-14,-66);ctx.stroke();
    ctx.fillStyle='#ff9a3c';ctx.beginPath();ctx.moveTo(-14,-66);ctx.lineTo(8,-60);ctx.lineTo(-14,-52);ctx.closePath();ctx.fill();
    const on=still||Math.sin(time*0.006)>0;
    ctx.fillStyle=on?'#ff5a4a':'#7a2a28';ctx.beginPath();ctx.arc(-14,-68,3.2,0,TAU);ctx.fill();
    if(on){const g=ctx.createRadialGradient(-14,-68,0,-14,-68,16);g.addColorStop(0,'rgba(255,110,90,0.55)');g.addColorStop(1,'rgba(255,110,90,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(-14,-68,16,0,TAU);ctx.fill();}
    ctx.globalAlpha=1;
  }
  ctx.restore();
}

function craftBubbles(x,y,size,time,still,overrideX,minY=-1e9) {
  if(!still){
    const n=4+Math.round(sinkSmooth*8);
    for(let i=0;i<n;i++){
      const bx=x-size*46+Math.sin(time*0.002+i)*5;
      const by=y+size*(10-i*5)-((time*0.04+i*23)%68);
      if(by>minY)drawBubble(bx,by,Math.min(5.5,2.4+i*0.5),0.5);
    }
  }
  if(overrideX!==null && eventScene?.kind==='predator' && eventScene.p>0.82){
    const burst=smooth((eventScene.p-0.82)/0.18);
    for(let i=0;i<22;i++){
      const a=i/22*TAU,rad=18+burst*(35+(i%4)*7);
      drawBubble(x+Math.cos(a)*rad,y+Math.sin(a)*rad*0.58,2.2+(i%3)*0.9,0.46*(1-burst*0.25));
    }
  }
}

function updatePredatorPose(w,h,time) {
  const e=eventScene;
  if(!e||e.kind!=='predator')return false;
  const elapsed=time-e.start;
  if(elapsed>=e.duration){
    eventScene=null;
    document.body?.classList.remove('scene-focus');
    return false;
  }
  const raw=clamp(elapsed/e.duration,0,1);
  // A short slow-motion pocket holds the open-jaw gulp beat before the retreat.
  const p=raw<0.58?raw:raw<0.72?0.58+(raw-0.58)*0.45:0.643+(raw-0.72)*1.275;
  const enter=easeOut(Math.min(1,p/0.34));
  const leave=smooth((p-0.76)/0.24);
  const from=e.direction>0?w+360:-360;
  e.x=mix(from,w*0.5,enter)+e.direction*leave*w*0.7;
  e.y=h*(0.535+e.lane)+Math.sin(time*0.0012+e.seed)*h*0.008;
  e.scaleNow=clamp(Math.min(w/680,h/600),0.5,1.34)*e.scale*mix(0.7,1,enter)*(1-leave*0.35);
  e.jaw=smooth((p-0.19)/0.16)*(1-smooth((p-0.64)/0.19));
  e.alpha=1-leave;
  e.p=p;
  return true;
}

function drawPredatorRear(w,h,time) {
  const e=eventScene;
  if(!e||e.kind!=='predator')return;
  if(!updatePredatorPose(w,h,time))return;
  const skin=e.skin,swim=Math.sin(time*0.003+e.seed)*0.08;
  ctx.save();ctx.translate(e.x,e.y);ctx.rotate(swim*0.22);ctx.scale(e.scaleNow,e.scaleNow);ctx.globalAlpha=e.alpha;

  const fin=ctx.createLinearGradient(-250,-160,250,180);
  fin.addColorStop(0,skin.fin);fin.addColorStop(0.5,skin.top);fin.addColorStop(1,'#10283a');
  ctx.fillStyle=fin;
  if(e.p<0.46){
    ctx.save();ctx.globalAlpha=(1-e.p/0.46)*0.2;ctx.strokeStyle='rgba(204,246,242,0.7)';ctx.lineWidth=2;
    for(let streak=0;streak<8;streak++){
      const sy=-126+streak*34;
      ctx.beginPath();ctx.moveTo(-e.direction*(300+streak*11),sy);ctx.lineTo(-e.direction*(420+streak*18),sy+Math.sin(time*0.012+streak)*7);ctx.stroke();
    }
    ctx.restore();
  }
  // Tail and pectoral fins remain behind the player craft.
  ctx.save();ctx.translate(-178,20);ctx.rotate(Math.sin(time*0.004+e.seed)*0.22);
  ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(-94,-100,-154,-119);
  ctx.quadraticCurveTo(-132,-24,-188,0);ctx.quadraticCurveTo(-125,34,-154,119);
  ctx.quadraticCurveTo(-81,83,0,0);ctx.fill();ctx.restore();
  ctx.beginPath();ctx.moveTo(-70,-90);ctx.quadraticCurveTo(-42,-185,14,-206);
  ctx.quadraticCurveTo(28,-133,44,-84);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(-72,18);ctx.quadraticCurveTo(-215,18,-288,116);
  ctx.quadraticCurveTo(-184,96,-84,86);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(78,18);ctx.quadraticCurveTo(215,16,288,112);
  ctx.quadraticCurveTo(183,92,84,84);ctx.closePath();ctx.fill();

  const body=ctx.createRadialGradient(-42,-84,8,0,-12,265);
  body.addColorStop(0,skin.side);body.addColorStop(0.5,skin.top);body.addColorStop(1,skin.fin);
  ctx.fillStyle=body;ctx.beginPath();ctx.ellipse(0,-6,220,163,0,0,TAU);ctx.fill();

  // The mouth cavity is behind the craft. The lower jaw hinges down during the gulp.
  const mouth=ctx.createRadialGradient(0,67,8,0,73,180);
  mouth.addColorStop(0,'#02070d');mouth.addColorStop(0.72,'#130e19');mouth.addColorStop(1,'rgba(7,18,28,0.92)');
  ctx.fillStyle=mouth;ctx.beginPath();ctx.ellipse(0,72,164,80+e.jaw*37,0,0,TAU);ctx.fill();
  ctx.strokeStyle='rgba(241,255,238,0.22)';ctx.lineWidth=5;
  ctx.beginPath();ctx.ellipse(0,72,165,81+e.jaw*37,0,Math.PI*1.02,Math.PI*1.98);ctx.stroke();

  ctx.fillStyle=skin.side;ctx.beginPath();
  ctx.moveTo(-160,92);ctx.quadraticCurveTo(0,112+e.jaw*76,160,92);
  ctx.quadraticCurveTo(130,180+e.jaw*68,0,174+e.jaw*72);
  ctx.quadraticCurveTo(-130,180+e.jaw*68,-160,92);ctx.fill();

  // Species-specific under-mouth anatomy.
  if(e.species==='catfish'){
    ctx.strokeStyle=skin.side;ctx.lineWidth=5;ctx.lineCap='round';
    for(const side of [-1,1]){
      ctx.beginPath();ctx.moveTo(side*132,61);ctx.quadraticCurveTo(side*205,95,side*218,152);ctx.stroke();
    }
  }
  if(e.species==='gulper'){
    ctx.strokeStyle='rgba(205,231,220,0.5)';ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(-76,146);ctx.quadraticCurveTo(0,198+e.jaw*38,76,146);ctx.stroke();
  }
  ctx.restore();
}

function drawPredatorFront(w,h,time) {
  const e=eventScene;
  if(!e||e.kind!=='predator'||e.p>1)return;
  const skin=e.skin;
  ctx.save();ctx.translate(e.x,e.y);ctx.scale(e.scaleNow,e.scaleNow);ctx.globalAlpha=e.alpha;

  // Upper head is deliberately drawn after the submersible; the craft sits inside the open mouth.
  const head=ctx.createLinearGradient(-170,-190,150,60);
  head.addColorStop(0,'#162c3c');head.addColorStop(0.22,skin.top);
  head.addColorStop(0.54,skin.side);head.addColorStop(1,skin.fin);
  ctx.fillStyle=head;ctx.beginPath();
  if(e.species==='barracuda'){
    ctx.moveTo(-205,24);ctx.quadraticCurveTo(-170,-82,-82,-152);
    ctx.quadraticCurveTo(38,-205,202,-18);ctx.quadraticCurveTo(130,27,75,37);
  } else if(e.species==='catfish'){
    ctx.moveTo(-205,30);ctx.quadraticCurveTo(-210,-118,-102,-160);
    ctx.quadraticCurveTo(0,-200,102,-160);ctx.quadraticCurveTo(210,-118,205,30);
  } else if(e.species==='angler'||e.species==='gulper'){
    ctx.moveTo(-196,30);ctx.bezierCurveTo(-230,-100,-138,-196,0,-198);
    ctx.bezierCurveTo(138,-196,230,-100,196,30);
  } else {
    ctx.moveTo(-200,27);ctx.bezierCurveTo(-188,-93,-111,-190,0,-194);
    ctx.bezierCurveTo(111,-190,188,-93,200,27);
  }
  ctx.quadraticCurveTo(128,46,72,42);ctx.quadraticCurveTo(0,30,-72,42);
  ctx.quadraticCurveTo(-128,46,-200,27);ctx.closePath();ctx.fill();

  // Brow ridge, eyes, gill details and species markers.
  ctx.strokeStyle='rgba(235,251,238,0.24)';ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(-144,-92);ctx.quadraticCurveTo(0,-204,144,-92);ctx.stroke();
  for(const side of [-1,1]){
    ctx.fillStyle='rgba(3,14,22,0.9)';ctx.beginPath();ctx.ellipse(side*112,-58,13,10,0,0,TAU);ctx.fill();
    ctx.fillStyle=skin.glow;ctx.beginPath();ctx.arc(side*112,-59,5.3,0,TAU);ctx.fill();
    ctx.fillStyle='#07111a';ctx.beginPath();ctx.arc(side*113,-59,2.3,0,TAU);ctx.fill();
    ctx.fillStyle='rgba(10,28,40,0.62)';
    for(let g=0;g<4;g++){
      ctx.beginPath();ctx.moveTo(side*(148+g*7),-24+g*8);
      ctx.quadraticCurveTo(side*(161+g*8),-2+g*8,side*(149+g*8),16+g*8);ctx.stroke();
    }
  }

  if(e.species==='angler'){
    ctx.strokeStyle=skin.fin;ctx.lineWidth=8;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(0,-174);ctx.quadraticCurveTo(-16,-239,24,-260);ctx.stroke();
    const lure=ctx.createRadialGradient(24,-260,1,24,-260,18);
    lure.addColorStop(0,'#f8fff0');lure.addColorStop(0.25,skin.glow);lure.addColorStop(1,'rgba(118,244,227,0)');
    ctx.fillStyle=lure;ctx.beginPath();ctx.arc(24,-260,18,0,TAU);ctx.fill();
  }
  if(e.species==='catfish'){
    ctx.strokeStyle=skin.side;ctx.lineWidth=5;ctx.lineCap='round';
    for(const side of [-1,1]){
      ctx.beginPath();ctx.moveTo(side*145,25);ctx.bezierCurveTo(side*206,46,side*208,112,side*254,130);ctx.stroke();
    }
  }
  if(e.species==='grouper'){
    ctx.strokeStyle='rgba(20,37,45,0.58)';ctx.lineWidth=7;
    for(let i=-2;i<=2;i++){ctx.beginPath();ctx.arc(i*22,-10,38,-0.6,0.6);ctx.stroke();}
    ctx.strokeStyle=skin.belly;ctx.lineWidth=11;ctx.beginPath();ctx.quadraticCurveTo(-120,30,0,48);ctx.quadraticCurveTo(120,30,120,30);ctx.stroke();
  }
  if(e.species==='barracuda'){
    ctx.fillStyle='rgba(5,19,30,0.75)';
    for(let i=0;i<8;i++){const xx=86+i*8;ctx.beginPath();ctx.moveTo(xx,22);ctx.lineTo(xx+3,38);ctx.lineTo(xx+7,22);ctx.fill();}
  }
  if(e.species==='gulper'){
    ctx.strokeStyle='rgba(210,235,225,0.6)';ctx.lineWidth=4;
    ctx.beginPath();ctx.moveTo(-156,-40);ctx.quadraticCurveTo(-110,-210,0,-218);ctx.quadraticCurveTo(110,-210,156,-40);ctx.stroke();
  }

  // Hinged upper jaw and teeth frame the player's vehicle in the cavity.
  ctx.strokeStyle=skin.belly;ctx.lineWidth=9;
  ctx.beginPath();ctx.moveTo(-160,34);ctx.quadraticCurveTo(0,24-e.jaw*11,160,34);ctx.stroke();
  ctx.fillStyle='#fff3dc';
  for(let tooth=0;tooth<13;tooth++){
    const tx=-145+tooth*24;
    const curve=Math.abs(tx)/145;
    const length=12+e.jaw*17*(1-curve*0.25);
    ctx.beginPath();ctx.moveTo(tx,32);ctx.lineTo(tx+8,32+length);ctx.lineTo(tx+16,33);ctx.closePath();ctx.fill();
  }
  // A bubble burst and lens flare at the gulp; harmless and playful, no injury.
  if(e.p>0.61&&e.p<0.88){
    const burst=smooth((e.p-0.61)/0.27);
    ctx.save();ctx.globalCompositeOperation='screen';
    for(let i=0;i<20;i++){
      const a=i/20*TAU,rad=140+burst*(40+(i%4)*15);
      drawBubble(Math.cos(a)*rad,Math.sin(a)*rad*0.45,2.4+(i%3),0.36);
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawEvent(w,h,time,still) {
  if(!eventScene)return;
  const e=eventScene, elapsed=time-e.start;
  if(elapsed>=e.duration){eventScene=null;return;}
  const p=clamp(elapsed/e.duration,0,1), approach=easeOut(Math.min(1,p/0.78));
  const fade=p>0.88?1-(p-0.88)/0.12:1;
  const x=w*(0.5+e.lane), y=h*0.43;

  if(e.kind==='shark'||e.kind==='barracuda'||e.kind==='reef_shark'){
    // A large predator sweeps out of the dark and passes close across the camera.
    const scale=mix(0.045,Math.min(w/980,1.42)*e.scale,approach);
    const direction=e.direction;
    const x=direction>0?mix(-350,w+350,p):mix(w+350,-350,p);
    const y=h*(0.42+e.lane*0.45)+Math.sin(time*0.0007+e.seed)*h*0.018;
    const jaw=smooth((p-0.68)/0.16);
    const shadow=ctx.createRadialGradient(x,y,8,x,y,Math.max(w,h)*(0.18+approach*0.43));
    shadow.addColorStop(0,'rgba(0,5,13,'+(0.14+approach*0.28)+')');
    shadow.addColorStop(1,'rgba(0,5,13,0)');
    ctx.fillStyle=shadow;ctx.fillRect(0,0,w,h);
    drawSharkPass(x,y,scale,e.variant,e.seed,time,direction,jaw,fade);
    if(p>0.82){
      const burst=(p-0.82)/0.18;
      for(let i=0;i<30;i++){
        const a=i/30*TAU, r=18+burst*(95+(i%4)*18);
        drawBubble(x+Math.cos(a)*r,y+Math.sin(a)*r*0.55,2.4+(i%3)*0.8,0.42*(1-burst*0.35));
      }
      const edge=ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*0.18,w/2,h/2,Math.max(w,h)*0.78);
      edge.addColorStop(0,'rgba(0,0,0,0)');
      edge.addColorStop(1,'rgba(0,2,8,'+(0.4*burst)+')');
      ctx.fillStyle=edge;ctx.fillRect(0,0,w,h);
    }
    return;
  }

    // Rare answers cause different peaceful or spectacular wildlife encounters.
  if(e.kind==='manta'||e.kind==='ray_school'||e.kind==='giant_ray'||e.kind==='manta_migration'){
    const s=mix(0.08,Math.min(w/440,2.65)*e.scale,approach);
    const travel=e.direction*(p*0.32);
    for(let i=0;i<(e.kind==='ray_school'?4: e.kind==='manta_migration'?5:1);i++){
      const xx=x+w*travel+(i-2)*w*0.16;
      const yy=y+(i%2)*h*0.1+Math.sin(time*0.001+i+e.seed)*13;
      drawManta(xx,yy,s*(1-(i%3)*0.12),e.seed+i*2,time,fade*(1-i*0.09));
    }
    return;
  }
  if(e.kind==='turtle'||e.kind==='sea_turtle'){
    const s=mix(0.06,Math.min(w/320,2.1)*e.scale,approach);
    const xx=mix(e.direction<0?w+220:-220,w*0.5,p);
    drawTurtle(xx,y+65,s,e.seed,time,fade);
    return;
  }
  if(e.kind==='dolphins'){
    const s=mix(0.15,Math.min(w/600,1.65),approach);
    for(let i=0;i<4;i++){
      const xx=w*(0.12+i*0.23)+Math.sin(time*0.001+i*1.3)*25;
      const yy=y+(i%2)*90+Math.sin(time*0.0017+i*2)*24;
      drawDolphin(xx,yy,s*(1-i*0.09),e.seed+i*1.7,time,e.direction,fade);
    }
    return;
  }
  if(e.kind==='reef_sharks'){
    const s=mix(0.08,Math.min(w/1320,0.92)*e.scale,approach);
    for(let i=0;i<3;i++){
      const xx=(e.direction>0?-260:w+260)+e.direction*p*(w+520)+(i-1)*w*0.13;
      const yy=y+(i-1)*h*0.105+Math.sin(time*0.00075+i*1.7)*18;
      drawSharkPass(xx,yy,s*(1-i*0.1),e.variant,e.seed+i,time,e.direction,0,fade*0.72);
    }
    return;
  }
  if(e.kind==='whale_shark'){
    const s=mix(0.05,Math.min(w/620,1.85)*e.scale,approach);
    const xx=mix(e.direction<0?w+420:-420,w*0.46,p);
    drawWhaleSide(xx,y+35,s,e.seed,time,fade,true);
    return;
  }
  if(e.kind==='blue_whale'||e.kind==='giant_whale_shadow'||e.kind==='bioluminescent_migration'){
    const s=mix(0.035,Math.min(w/760,1.65)*e.scale,approach);
    const xx=mix(e.direction<0?w+650:-650,w*0.5,p);
    drawWhaleSide(xx,y+30,s,e.seed,time,fade,false);
    if(e.kind==='bioluminescent_migration'){
      for(let i=0;i<40;i++){
        const px=x+Math.sin(i*1.7+time*0.0007)*w*0.23;
        const py=y+Math.cos(i*2.2+time*0.0006)*h*0.15;
        const glow=ctx.createRadialGradient(px,py,1,px,py,14);
        glow.addColorStop(0,'rgba(150,255,222,0.82)');glow.addColorStop(1,'rgba(80,220,200,0)');
        ctx.fillStyle=glow;ctx.beginPath();ctx.arc(px,py,14,0,TAU);ctx.fill();
      }
    }
    return;
  }
  if(e.kind==='jelly_bloom'||e.kind==='bioluminescent_school'){
    for(let i=0;i<20;i++){
      const phase=e.seed+i*2.4;
      const xx=x+Math.sin(i*1.9+time*0.0003)*w*0.37;
      const yy=y+Math.cos(i*2.7+time*0.00024)*h*0.23;
      drawJellyfish(xx,yy,mix(0.12,0.75,approach)*(0.65+(i%4)*0.13),phase,time,fade*0.78);
    }
    return;
  }
  if(e.kind==='octopus'){
    const s=mix(0.08,Math.min(w/520,1.9),approach);
    drawOctopus(x,y+45,s,e.seed,time,fade);
    return;
  }
  if(e.kind==='silver_school'||e.kind==='reef_fish'||e.kind==='butterfly_school'||e.kind==='tropical_school'){
    for(let i=0;i<36;i++){
      const lane=i/36*TAU;
      const rx=(40+approach*230)*Math.cos(lane+time*0.0005);
      const ry=(25+approach*120)*Math.sin(lane+time*0.0005);
      const sz=mix(0.08,0.42,approach)*(0.65+(i%4)*0.13);
      drawFishSide(x+rx,y+ry,sz,FISH_PALETTE[(i+e.variant)%FISH_PALETTE.length],e.seed+i,time,Math.cos(lane)>0?1:-1,fade*0.72,0);
    }
    return;
  }
  // Fallback scene: shimmering layered schools, never an empty answer event.
  for(let i=0;i<28;i++){
    const a=i/28*TAU;
    drawFishSide(x+Math.cos(a)*approach*220,y+Math.sin(a)*approach*100,
      0.18+approach*0.35,FISH_PALETTE[i%FISH_PALETTE.length],e.seed+i,time,1,fade*0.7,0);
  }
}

function drawDiver(w,h,time,still,depth) {
  const bob=still?0:Math.sin(time*0.00085)*9;
  const finKick=still?0:Math.sin(time*0.006)*0.13;
  const x=w*0.5+Math.sin(time*0.00024)*w*0.018,y=h*0.72+bob;
  const scale=clamp(w/1100,0.64,1.02);
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
  // Soft cone of the diver's torch.
  const torch=ctx.createRadialGradient(55,-22,4,55,-22,250);
  torch.addColorStop(0,'rgba(192,255,232,0.14)');torch.addColorStop(1,'rgba(137,230,223,0)');
  ctx.fillStyle=torch;ctx.beginPath();ctx.moveTo(14,-24);ctx.lineTo(270,-150);ctx.lineTo(260,130);ctx.closePath();ctx.fill();

  // Twin fins animate at the ankles.
  ctx.fillStyle='#081c2b';
  for(let side of [-1,1]){
    ctx.save();ctx.translate(side*26,32);ctx.rotate(side*finKick);
    ctx.beginPath();ctx.moveTo(-5,-5);ctx.lineTo(side*37,15);ctx.lineTo(side*72,22);
    ctx.lineTo(side*61,35);ctx.lineTo(side*12,25);ctx.closePath();ctx.fill();ctx.restore();
  }
  // Legs and wetsuit.
  const suit=ctx.createLinearGradient(-25,-5,28,36);
  suit.addColorStop(0,'#0b2030');suit.addColorStop(0.48,'#23465a');suit.addColorStop(1,'#071725');
  ctx.fillStyle=suit;ctx.beginPath();ctx.moveTo(-16,7);ctx.lineTo(-31,35);ctx.lineTo(-7,42);ctx.lineTo(8,18);
  ctx.lineTo(30,39);ctx.lineTo(48,30);ctx.lineTo(20,1);ctx.closePath();ctx.fill();
  // Back-mounted steel tank with metallic rim and pressure fittings.
  const tank=ctx.createLinearGradient(-30,-24,-8,28);
  tank.addColorStop(0,'#e8eee0');tank.addColorStop(0.25,'#829fa2');tank.addColorStop(0.52,'#e2f3e9');tank.addColorStop(1,'#345866');
  ctx.fillStyle=tank;ctx.beginPath();ctx.roundRect(-30,-24,19,58,7);ctx.fill();
  ctx.strokeStyle='rgba(235,255,244,0.66)';ctx.lineWidth=1.5;ctx.stroke();
  ctx.fillStyle='#d4aa61';ctx.fillRect(-29,-29,17,7);
  // Torso / buoyancy vest.
  ctx.fillStyle=suit;ctx.beginPath();ctx.moveTo(-23,-23);ctx.quadraticCurveTo(-2,-39,19,-22);
  ctx.lineTo(28,10);ctx.quadraticCurveTo(1,23,-25,9);ctx.closePath();ctx.fill();
  ctx.strokeStyle='#dcae69';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-14,-13);ctx.lineTo(17,9);ctx.stroke();
  // Shoulder / forearms and dive computer.
  ctx.strokeStyle='#182d42';ctx.lineWidth=10;ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(-16,-16);ctx.lineTo(-43,-1);ctx.lineTo(-54,13);ctx.stroke();
  ctx.beginPath();ctx.moveTo(16,-16);ctx.lineTo(39,-1);ctx.lineTo(56,-10);ctx.stroke();
  ctx.fillStyle='#d5b07a';ctx.beginPath();ctx.arc(-54,13,5,0,TAU);ctx.fill();
  ctx.fillStyle='#0b1c29';ctx.fillRect(25,-4,13,7);
  ctx.strokeStyle='#7ee6e5';ctx.lineWidth=1;ctx.strokeRect(25,-4,13,7);
  // Head, mask glass, rim and regulator.
  ctx.fillStyle='#bb8e6b';ctx.beginPath();ctx.arc(21,-32,14,0,TAU);ctx.fill();
  const mask=ctx.createLinearGradient(8,-42,35,-25);
  mask.addColorStop(0,'#b8ffff');mask.addColorStop(0.4,'#48b6ca');mask.addColorStop(1,'#183d5e');
  ctx.fillStyle=mask;ctx.beginPath();ctx.roundRect(12,-41,23,12,4);ctx.fill();
  ctx.strokeStyle='rgba(226,255,255,0.92)';ctx.lineWidth=2;ctx.stroke();
  ctx.strokeStyle='#d6c79e';ctx.lineWidth=2;ctx.beginPath();ctx.arc(13,-20,12,-1.6,0.7);ctx.stroke();
  ctx.fillStyle='#263846';ctx.beginPath();ctx.arc(9,-15,5,0,TAU);ctx.fill();
  // Hose arcs upward with tiny regulator bubbles.
  ctx.strokeStyle='#d4d2bc';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(8,-17);
  ctx.bezierCurveTo(-1,-35,-5,-40,-13,-43);ctx.stroke();
  ctx.globalAlpha=0.78;
  if(!still){
    for(let i=0;i<3;i++){
      const bx=-7+Math.sin(time*0.003+i)*3;
      const by=-48-((time*0.045+i*19)%65);
      drawBubble(bx,by,2.3+i*0.8,0.78);
    }
  }
  ctx.restore();
}

function drawForegroundBubbles(w,h,time,still) {
  if(still)return;
  // Sparse, soft lens bubbles only at the very edge of the camera.
  for(let i=0;i<5;i++){
    const phase=(time*0.000055+i/5)%1;
    const x=(i*313.7+Math.sin(time*0.0004+i)*24)%w;
    const y=h*(1-phase);
    const r=1.5+phase*8;
    drawBubble(x,y,r,0.035+phase*0.075);
  }
}

function drawEventBackdrop(w,h,time) {
  if(!eventScene)return;
  const p=clamp((time-eventScene.start)/eventScene.duration,0,1);
  const predator=eventScene.kind==='predator'||eventScene.kind==='shark'||eventScene.kind==='barracuda'||eventScene.kind==='reef_shark';
  if(predator){
    const pressure=ctx.createRadialGradient(w*0.5,h*0.44,Math.min(w,h)*0.12,w*0.5,h*0.44,Math.max(w,h)*0.78);
    pressure.addColorStop(0,'rgba(0,4,11,'+(0.02+p*0.07)+')');
    pressure.addColorStop(1,'rgba(0,3,10,'+(0.16+p*0.1)+')');
    ctx.fillStyle=pressure;ctx.fillRect(0,0,w,h);
  } else {
    const ambient=ctx.createRadialGradient(w*0.52,h*0.42,6,w*0.52,h*0.42,Math.max(w,h)*0.52);
    ambient.addColorStop(0,'rgba(150,190,179,'+(0.045*(1-p*0.55))+')');
    ambient.addColorStop(1,'rgba(36,93,111,0)');
    ctx.fillStyle=ambient;ctx.fillRect(0,0,w,h);
  }
}

function frame(time) {
  if(!ctx||!canvas||document.hidden){frameStarted=false;return;}
  if(qNow().fps<60 && lastPerfTime && time-lastPerfTime<1000/qNow().fps-2){rafHandle=requestAnimationFrame(frame);return;}
  lastPerfTime=time;
  const w=width||window.innerWidth,h=height||window.innerHeight;
  const actualDepth=clamp((Number(getDepth())||0)/CONFIG.MAX_DEPTH_VISUAL,0,1);
  const promptProgress=clamp(Number(getProgress())||0,0,1);
  // The scene only goes deeper when the player earns depth. A wrong answer or a timeout never moves the region.
  const targetStage=actualDepth;
  const still=Boolean(isStill());
  const delta=still?0:Math.min(42,previousTime?time-previousTime:16);
  perfFrames++;
  if (window.location.search.includes('perf')) {
    if (!perfOverlay) { perfOverlay=document.createElement('div'); perfOverlay.style.cssText='position:fixed;left:8px;bottom:8px;z-index:99;padding:6px 8px;border-radius:6px;background:rgba(0,0,0,.72);color:#fff;font:11px/1.3 monospace;pointer-events:none'; document.body.appendChild(perfOverlay); }
    const fps=delta>0?Math.round(1000/delta):0; perfOverlay.textContent=`FPS ${fps} · ${delta.toFixed(1)}ms · ${graphicsTier} · ${fish.length+ jellies.length} creatures`;
  }
  if(!perfWindowStart)perfWindowStart=time;
  if(time-perfWindowStart>=2000){
    const fps=perfFrames*1000/(time-perfWindowStart);
    // Auto mode only: two slow 2-second windows in a row step ONE tier down (High -> Medium -> Low). Never back up,
    // so quality cannot flip-flop. The result is remembered for the next visit.
    slowWindows=(!tierManual&&!still&&graphicsTier!=='low'&&fps<45)?slowWindows+1:0;
    if(slowWindows>=2){
      graphicsTier=graphicsTier==='high'?'medium':'low';
      try{localStorage.setItem(TIER_STORE,graphicsTier);}catch{/* storage blocked: fine */}
      resize();
    }
    syncTierClasses();
    perfWindowStart=time;perfFrames=0;
  }
  if(!still){
    previousTime=time;frozenTime=0;
    const blend=1-Math.exp(-delta/1900);
    visualStage+=(targetStage-visualStage)*blend;
    visualDepth+=(targetStage-visualDepth)*(1-Math.exp(-delta/2600));
  } else if(!frozenTime) frozenTime=time;
  if(still)sinkSmooth=0;
  else sinkSmooth+=(clamp((targetStage-visualDepth)*22,0,1)-sinkSmooth)*(1-Math.exp(-delta/420));
  const t=still?(frozenTime||time):time;
  const predatorEvent=eventScene?.kind==='predator';
  const predatorT=predatorEvent?clamp((t-eventScene.start)/eventScene.duration,0,1):0;
  const impact=predatorEvent&&!still?smooth((predatorT-0.58)/0.18):0;
  const hitShake=still?0:Math.sin(t*0.082)*impact*10;

  drawWater(w,h,visualDepth,t);
  drawSurfaceMoment(w,h,visualDepth,t,still);

  const swayX=still?0:Math.sin(t*0.00016)*w*0.004;
  const driftY=visualStage*h*0.035+(still?0:Math.sin(t*0.00019)*h*0.0025);
  camDriftY=driftY;
  ctx.save();
  ctx.translate(swayX+hitShake,-driftY+Math.cos(t*0.071)*impact*5);
  drawReefAndKelp(w,h,t,visualDepth,still);
  drawDepthWalls(w,h,visualDepth,t);
  drawEventBackdrop(w,h,t);
  drawFishSchools(w,h,t,still,visualDepth,delta);
  drawParticles(w,h,t,still,visualDepth);

  if(predatorEvent){
    drawPredatorRear(w,h,t);
    const e=eventScene;
    if(e&&e.kind==='predator'){
      const panic=1-smooth((e.p-0.2)/0.36);
      // The predator exits first; the submersible settles back to the camera
      // centre and emits its respawn bubble ring after the gulp.
      const respawn=smooth((e.p-0.70)/0.16);
      const craftY=mix(e.y+68*e.scaleNow,h*0.575,respawn);
      const craftX=mix(e.x,w*0.5,respawn);
      drawSubmersible(w,h,t,visualDepth,still,panic,craftX,craftY);
      drawPredatorFront(w,h,t);
    } else {
      drawSubmersible(w,h,t,visualDepth,still);
    }
  } else {
    drawEvent(w,h,t,still);
    drawSubmersible(w,h,t,visualDepth,still);
  }
  drawForegroundBubbles(w,h,t,still);
  ctx.restore();

  if(predatorEvent && eventScene?.kind==='predator' && eventScene.p>0.58 && eventScene.p<0.7 && !still){
    const flash=(1-Math.abs(eventScene.p-0.64)/0.06)*0.085;
    ctx.fillStyle=`rgba(205,244,255,${Math.max(0,flash)})`;
    ctx.fillRect(0,0,w,h);
  }

  // Pressure darkens the edge of the lens progressively with depth.
  const pressure=0.12+visualDepth*0.34;
  ctx.fillStyle=`rgba(0,2,8,${pressure*0.22})`;ctx.fillRect(0,0,w,h);
  checkZoneBanner(time);
  if(!document.hidden) rafHandle=requestAnimationFrame(frame);
  else frameStarted=false;
}

/* ---- Zone banner: names each new depth as the dive enters it ---- */
const BANNER_ZONES=[{at:0,name:'Sunlight zone'},{at:0.1,name:'Twilight zone'},{at:0.375,name:'Midnight zone'},{at:0.875,name:'The abyss'}];
let bannerZone=0,bannerCheck=0,bannerEl=null;
function checkZoneBanner(time) {
  if(time-bannerCheck<250)return;bannerCheck=time;
  let z=0;for(let i=0;i<BANNER_ZONES.length;i++)if(visualDepth>=BANNER_ZONES[i].at+0.012)z=i;
  if(z===bannerZone)return;
  const deeper=z>bannerZone;bannerZone=z;
  if(!deeper||!document.getElementById('game')?.classList.contains('active'))return;
  if(!bannerEl){bannerEl=document.createElement('div');bannerEl.className='zone-banner';bannerEl.setAttribute('aria-hidden','true');document.body.appendChild(bannerEl);}
  bannerEl.innerHTML='<small>Entering</small><b></b>';bannerEl.lastChild.textContent=BANNER_ZONES[z].name;
  bannerEl.classList.remove('show');void bannerEl.offsetWidth;bannerEl.classList.add('show');
}
