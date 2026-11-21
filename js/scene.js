// DEEPWELL cinematic 2.5D underwater renderer.
// All visuals are generated live with Canvas 2D paths, gradients, lighting and particles.
// No 3D engine, images, video, sprite sheets or downloaded models.
import { CONFIG } from './config.js';

const canvas = document.getElementById('scene');
const ctx = canvas?.getContext('2d', { alpha: false });
let getDepth = () => 0;
let isStill = () => false;
let bubbles = [];
let plankton = [];
let fish = [];
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

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3.3);

const FISH_PALETTE = [
  ['#d7a84b','#fff1b8','#60472b'], ['#df7957','#ffe3bc','#633d34'],
  ['#56aeb0','#d2f6e8','#19485a'], ['#8577bd','#e8d4ff','#453c66'],
  ['#c6a15c','#f9e8af','#4f4834'], ['#6e9b75','#d8edc0','#2b5242'],
  ['#76a9c6','#e7f7f4','#31536b'], ['#d77c9d','#ffe1e9','#633c55'],
  ['#e4b34d','#fff1c2','#76552f'], ['#4b9c8e','#c5f4df','#244b47']
];

const SHARKS = [
  { name:'Great white', top:'#637f91', side:'#94afb9', belly:'#e5eeea', fin:'#314a5d', eye:'#061723', pattern:'plain' },
  { name:'Tiger shark', top:'#536e78', side:'#879fa4', belly:'#dbe6e0', fin:'#2b4350', eye:'#061723', pattern:'tiger' },
  { name:'Hammerhead', top:'#718d9b', side:'#a8c3c1', belly:'#e4efea', fin:'#3d5866', eye:'#061723', pattern:'hammer' },
  { name:'Blue shark', top:'#347d9e', side:'#8ebac8', belly:'#d5e9e8', fin:'#174563', eye:'#061723', pattern:'plain' },
  { name:'Dusky shark', top:'#435f70', side:'#829da9', belly:'#dbe7e4', fin:'#263e52', eye:'#061723', pattern:'plain' }
];

function resize() {
  if (!canvas || !ctx) return;
  width = Math.max(1, window.innerWidth);
  height = Math.max(1, window.innerHeight);
  // High-detail drawing without allowing very high-DPI devices to allocate excessive memory.
  dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  bubbles = Array.from({length:Math.min(230,Math.floor(width/5))},()=>({
    x:rand(0,width), y:rand(0,height), r:rand(0.6,4.1),
    speed:rand(0.15,0.82), drift:rand(0.3,1.8), phase:rand(0,TAU),
    alpha:rand(0.12,0.5), near:Math.random()<0.17
  }));
  plankton = Array.from({length:420},()=>({
    x:rand(0,width),y:rand(0,height),r:rand(0.45,1.8),
    speed:rand(0.08,0.4),phase:rand(0,TAU),alpha:rand(0.08,0.36)
  }));
  fish = Array.from({length:Math.min(74,Math.max(38,Math.floor(width/22)))},(_,i)=>({
    u:rand(-0.48,0.48),v:rand(-0.48,0.38),z:rand(0.015,0.9),
    scale:rand(0.78,1.26),speed:rand(0.00013,0.00028),
    dir:Math.random()<0.5?-1:1, phase:rand(0,TAU),
    palette:FISH_PALETTE[i%FISH_PALETTE.length],kind:i%5
  }));
  kelp = Array.from({length:24},(_,i)=>({
    x:(i/23)*width+rand(-24,24),height:rand(75,260),width:rand(3,10),
    phase:rand(0,TAU),color:['#125d58','#1c7668','#32876d','#4b9871'][i%4],
    lean:rand(-1,1)
  }));
  reef = [];
  for(let side of [-1,1]){
    for(let i=0;i<12;i++){
      reef.push({
        x:side*rand(width*0.01,width*0.16), y:height*rand(0.73,1.02),
        scale:rand(0.55,1.45), color:['#e87859','#e9ae62','#bf6b9e','#75b99a','#7896c8'][i%5],
        type:i%4, phase:rand(0,TAU)
      });
    }
  }
}

export function startScene(depthFn, stillFn) {
  getDepth = typeof depthFn==='function' ? depthFn : getDepth;
  isStill = typeof stillFn==='function' ? stillFn : isStill;
  resize();
  window.addEventListener('resize',resize,{passive:true});
  if(!frameStarted){
    frameStarted=true;
    requestAnimationFrame(frame);
  }
}

// Visual-only signal from the existing answer resolution. It never changes score or progression.
export function triggerAnswerVisual(points, state) {
  const failed = state !== 'hit';
  let pool;
  if(failed || points <= 20) {
    pool=['shark','shark','barracuda','reef_shark','shark'];
  } else if(points <= 40) {
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
  eventScene={
    kind,
    start:performance.now(),
    duration:kind==='shark'||kind==='barracuda'||kind==='reef_shark'?2450:3000,
    seed:rand(0,TAU),
    variant:(()=>{let v=Math.floor(rand(0,SHARKS.length));if(SHARKS.length>1&&v===lastSharkVariant)v=(v+1+Math.floor(rand(0,SHARKS.length-1)))%SHARKS.length;lastSharkVariant=v;return v;})(),
    lane:rand(-0.16,0.16),
    direction:Math.random()<0.5?-1:1,
    scale:rand(0.88,1.18)
  };
}

// Keep the old function name available to any other in-project callers.
export function triggerPredatorAttack() { triggerAnswerVisual(0,'miss'); }

function waterPalette(depth) {
  if(depth<0.15) return ['#0b7884','#075067','#032b43'];
  if(depth<0.38) return ['#075a78','#063e5d','#031b35'];
  if(depth<0.66) return ['#123e62','#0b2a48','#06162e'];
  return ['#101e3b','#08152b','#020813'];
}

function drawWater(w,h,depth,time) {
  const colors=waterPalette(depth);
  const g=ctx.createLinearGradient(0,0,w*0.2,h);
  g.addColorStop(0,colors[0]);g.addColorStop(0.45,colors[1]);g.addColorStop(1,colors[2]);
  ctx.fillStyle=g;ctx.fillRect(0,0,w,h);

  // Diffuse ocean light, gradually extinguished with depth.
  const lightPower=(1-depth)*0.32;
  const halo=ctx.createRadialGradient(w*0.5,-h*0.06,8,w*0.5,h*0.05,h*0.95);
  halo.addColorStop(0,'rgba(190,255,232,'+lightPower+')');
  halo.addColorStop(0.38,'rgba(83,200,211,'+(lightPower*0.48)+')');
  halo.addColorStop(1,'rgba(10,52,89,0)');
  ctx.fillStyle=halo;ctx.fillRect(0,0,w,h);

  // Volumetric sun shafts: slightly different angles and speeds for natural movement.
  if(depth<0.88){
    ctx.save();ctx.globalCompositeOperation='screen';
    for(let i=0;i<13;i++){
      const phase=time*0.000035+i*1.91;
      const x=w*(0.025+i*0.079)+Math.sin(phase)*w*0.018;
      const spread=w*(0.024+(i%4)*0.012);
      const beam=ctx.createLinearGradient(x,0,x+spread*1.3,h*0.86);
      const a=lightPower*(0.22+(i%3)*0.07);
      beam.addColorStop(0,'rgba(183,255,234,'+a+')');
      beam.addColorStop(0.4,'rgba(82,202,218,'+(a*0.45)+')');
      beam.addColorStop(1,'rgba(54,168,205,0)');
      ctx.fillStyle=beam;
      ctx.beginPath();
      ctx.moveTo(x-spread*0.18,0);ctx.lineTo(x+spread*0.55,0);
      ctx.lineTo(x+spread*2.8,h*0.88);ctx.lineTo(x-spread*1.35,h*0.88);
      ctx.closePath();ctx.fill();
    }
    ctx.restore();
  }

  // Fine moving caustic lattice in the upper reef water.
  if(depth<0.5){
    ctx.save();ctx.globalCompositeOperation='screen';
    ctx.globalAlpha=(0.045+(0.5-depth)*0.22);
    ctx.strokeStyle='#a4fff0';ctx.lineWidth=1;
    for(let row=0;row<16;row++){
      ctx.beginPath();
      const baseY=h*(0.035+row*0.037);
      for(let x=-20;x<w+30;x+=18){
        const wave= Math.sin(x*0.014+time*0.00065+row*0.73)*5
          +Math.sin(x*0.006-time*0.00042+row)*8;
        if(x===-20)ctx.moveTo(x,baseY+wave);else ctx.lineTo(x,baseY+wave);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Suspended haze pushes distance layers backwards.
  const haze=ctx.createLinearGradient(0,h*0.12,0,h);
  haze.addColorStop(0,'rgba(2,21,39,0)');
  haze.addColorStop(0.55,'rgba(2,18,35,'+(0.02+depth*0.07)+')');
  haze.addColorStop(1,'rgba(0,6,19,'+(0.35+depth*0.43)+')');
  ctx.fillStyle=haze;ctx.fillRect(0,0,w,h);
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

function drawReefAndKelp(w,h,time,depth,still) {
  const reefAlpha=clamp(1-depth*1.35,0,1);
  if(reefAlpha>0.02){
    ctx.save();ctx.globalAlpha=reefAlpha;
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
      if(r.type===0||r.type===2)drawBranchCoral(r.x,r.y-15*r.scale,r.scale*0.75,r.color,r.phase,time);
    }
    for(const k of kelp){
      const sway=still?0:Math.sin(time*0.0009+k.phase)*22*k.lean;
      ctx.strokeStyle=k.color;ctx.lineWidth=k.width;ctx.lineCap='round';
      ctx.shadowColor=k.color;ctx.shadowBlur=8;
      ctx.beginPath();ctx.moveTo(k.x,h+15);
      ctx.bezierCurveTo(k.x-18+sway*0.3,h-k.height*0.25,k.x+20+sway,h-k.height*0.65,k.x+sway,h-k.height);
      ctx.stroke();ctx.shadowBlur=0;
      ctx.strokeStyle='rgba(176,255,211,0.18)';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(k.x,h-3);ctx.quadraticCurveTo(k.x+sway*0.45,h-k.height*0.52,k.x+sway,h-k.height);ctx.stroke();
    }
    ctx.restore();
  }
}

function drawBubble(x,y,r,alpha) {
  ctx.save();ctx.globalAlpha=alpha;
  const g=ctx.createRadialGradient(x-r*0.32,y-r*0.38,0,x,y,r);
  g.addColorStop(0,'rgba(237,255,255,0.75)');g.addColorStop(0.22,'rgba(151,238,244,0.25)');
  g.addColorStop(0.8,'rgba(100,212,233,0.08)');g.addColorStop(1,'rgba(202,255,255,0.48)');
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();
  ctx.strokeStyle='rgba(212,255,255,0.62)';ctx.lineWidth=Math.max(0.6,r*0.09);ctx.stroke();
  ctx.restore();
}

function drawParticles(w,h,time,still,depth) {
  for(const p of plankton){
    if(!still){p.y-=p.speed*(0.45+depth*0.35);p.x+=Math.sin(time*0.00045+p.phase)*0.12;if(p.y<0)p.y=h;}
    ctx.fillStyle='rgba(207,248,239,'+(p.alpha*(0.85-depth*0.35))+')';
    ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,TAU);ctx.fill();
  }
  for(const p of bubbles){
    if(!still){p.y-=p.speed*(0.65+depth*0.3);p.x+=Math.sin(time*0.0006+p.phase)*p.drift*0.04;if(p.y<-10){p.y=h+10;p.x=rand(0,w);}}
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
  ctx.fillStyle='rgba(4,17,25,0.76)';ctx.beginPath();ctx.ellipse(36,-6,5.7,5.4,-0.15,0,TAU);ctx.fill();
  ctx.fillStyle='#e8f3d8';ctx.beginPath();ctx.arc(37,-6,3.15,0,TAU);ctx.fill();
  ctx.fillStyle='#08131a';ctx.beginPath();ctx.arc(38,-6,1.7,0,TAU);ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.9)';ctx.beginPath();ctx.arc(38.8,-7.1,0.9,0,TAU);ctx.fill();
  // Mouth and snout highlight.
  ctx.strokeStyle='rgba(8,24,31,0.65)';ctx.lineWidth=1.2;
  ctx.beginPath();ctx.moveTo(48,5);ctx.quadraticCurveTo(53,7,56,3);ctx.stroke();
  ctx.strokeStyle='rgba(239,255,239,0.34)';ctx.lineWidth=1.4;
  ctx.beginPath();ctx.moveTo(-18,-17);ctx.quadraticCurveTo(16,-27,39,-14);ctx.stroke();
  ctx.restore();
}

function drawFishSchools(w,h,time,still,depth,delta) {
  // Far-to-near perspective: every fish swims out of the distant blue towards the diver.
  for(const f of fish){
    if(!still){
      f.z+=f.speed*delta;
      f.phase+=delta*0.0007;
      if(f.z>1.02){f.z=rand(0.005,0.045);f.u=rand(-0.46,0.46);f.v=rand(-0.5,0.34);}
    }
    const perspective=0.12+f.z*1.36;
    const x=w*0.5+f.u*w*perspective;
    const y=h*(0.34+f.v*perspective);
    const size=(0.2+f.z*2.05)*f.scale;
    const alpha=0.16+f.z*0.78;
    if(x>-170&&x<w+170&&y>-120&&y<h+100){
      drawFishSide(x,y,size,f.palette,f.phase,time,f.dir,alpha,f.z>0.34);
    }
  }

  // A near-camera fish crosses each side every few seconds; it creates convincing foreground parallax.
  const sweep=(time*0.000035)%1;
  for(let i=0;i<3;i++){
    const phase=(sweep+i/3)%1;
    const x=mix(-180,w+180,phase);
    const y=h*(0.23+i*0.16)+Math.sin(time*0.0008+i)*22;
    const scale=1.25+(i%2)*0.72;
    drawFishSide(x,y,scale,FISH_PALETTE[(i+3)%FISH_PALETTE.length],i*3.1,time,x<w*0.5?1:-1,0.28,0);
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
  shell.addColorStop(0,'#96aa73');shell.addColorStop(0.55,'#4d755b');shell.addColorStop(1,'#193d3c');
  ctx.fillStyle=shell;ctx.beginPath();ctx.ellipse(0,0,54,39,0,0,TAU);ctx.fill();
  ctx.strokeStyle='rgba(213,223,157,0.5)';ctx.lineWidth=2;
  for(let i=-2;i<=2;i++){ctx.beginPath();ctx.ellipse(i*17,0,12,28,i*0.1,0,TAU);ctx.stroke();}
  const skin='#66896d';ctx.fillStyle=skin;
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
  body.addColorStop(0,'#24475f');body.addColorStop(0.35,'#7197aa');body.addColorStop(0.7,'#d3e2dc');body.addColorStop(1,'#526b7a');
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
  mantle.addColorStop(0,'#e9a1a2');mantle.addColorStop(0.4,'#a65373');mantle.addColorStop(1,'#412b54');
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

function drawEvent(w,h,time,still) {
  if(!eventScene)return;
  const e=eventScene, elapsed=time-e.start;
  if(elapsed>=e.duration){eventScene=null;return;}
  const p=clamp(elapsed/e.duration,0,1), approach=easeOut(Math.min(1,p/0.78));
  const fade=p>0.88?1-(p-0.88)/0.12:1;
  const x=w*(0.5+e.lane), y=h*0.43;

  if(e.kind==='shark'||e.kind==='barracuda'||e.kind==='reef_shark'){
    // The shark starts as a small silhouette in the distant water and rushes straight at the diver.
    const scale=mix(0.025,Math.min(w/300,4.9)*e.scale,approach);
    const jaw=smooth((p-0.2)/0.34);
    ctx.save();
    const shadow=ctx.createRadialGradient(x,y,4,x,y,Math.max(w,h)*(0.12+approach*0.68));
    shadow.addColorStop(0,'rgba(1,8,19,'+(0.12+approach*0.22)+')');
    shadow.addColorStop(1,'rgba(1,8,19,0)');
    ctx.fillStyle=shadow;ctx.fillRect(0,0,w,h);
    drawFrontShark(x,y,scale,e.variant,jaw,time,fade);
    ctx.restore();
    if(p>0.72){
      const burst=(p-0.72)/0.28;
      for(let i=0;i<55;i++){
        const a=i/55*TAU, r=22+burst*(130+(i%4)*28);
        drawBubble(x+Math.cos(a)*r,y+Math.sin(a)*r*0.58,3+(i%4)*1.3,0.8*(1-burst*0.3));
      }
    }
    if(p>0.79){
      const flash=(p-0.79)/0.21;
      const vignette=ctx.createRadialGradient(w/2,h/2,20,w/2,h/2,Math.max(w,h)*0.72);
      vignette.addColorStop(0,'rgba(0,0,0,'+(flash*0.4)+')');vignette.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=vignette;ctx.fillRect(0,0,w,h);
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
    const s=mix(0.04,Math.min(w/1150,1.15),approach);
    for(let i=0;i<3;i++){
      const xx=w*(0.22+i*0.28)+Math.sin(time*0.0008+i)*20;
      const yy=y+(i-1)*82+Math.sin(time*0.001+i*2)*12;
      drawFrontShark(xx,yy,s*(1-i*0.08),e.variant,0,time,fade*0.82);
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
  // Large soft bubbles close to the lens add depth and lens-space movement.
  for(let i=0;i<12;i++){
    const phase=(time*0.00008+i/12)%1;
    const x=(i*113.7+Math.sin(time*0.0004+i)*30)%w;
    const y=h*(1-phase);
    const r=2+phase*14;
    drawBubble(x,y,r,0.08+phase*0.15);
  }
}

function drawEventBackdrop(w,h,time) {
  if(!eventScene)return;
  const p=clamp((time-eventScene.start)/eventScene.duration,0,1);
  const alpha=eventScene.kind==='shark'||eventScene.kind==='barracuda'||eventScene.kind==='reef_shark'?0.24:0.12;
  const glow=ctx.createRadialGradient(w*0.5,h*0.4,6,w*0.5,h*0.4,Math.max(w,h)*(0.12+p*0.42));
  glow.addColorStop(0,'rgba(116,233,232,'+(alpha*(1-p*0.45))+')');
  glow.addColorStop(1,'rgba(43,134,185,0)');
  ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
}

function frame(time) {
  if(!ctx||!canvas)return;
  const w=width||window.innerWidth,h=height||window.innerHeight;
  const depth=clamp((Number(getDepth())||0)/CONFIG.MAX_DEPTH_VISUAL,0,1);
  const still=Boolean(isStill());
  const delta=still?0:Math.min(42,previousTime?time-previousTime:16);
  if(!still){previousTime=time;frozenTime=0;}
  else if(!frozenTime) frozenTime=time;
  const t=still?(frozenTime||time):time;
  drawWater(w,h,depth,t);
  drawReefAndKelp(w,h,t,depth,still);
  drawEventBackdrop(w,h,t);
  drawFishSchools(w,h,t,still,depth,delta);
  drawParticles(w,h,t,still,depth);
  drawDiver(w,h,t,still,depth);
  // Creatures begin far behind the diver and grow into the foreground as they approach.
  drawEvent(w,h,t,still);
  drawForegroundBubbles(w,h,t,still);
  requestAnimationFrame(frame);
}
