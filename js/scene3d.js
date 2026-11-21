// DEEPWELL 3D underwater renderer.
// Every model, reef, bubble, light and motion effect is generated in JavaScript/WebGL.
// The only external dependency is Three.js itself; no image/video/model assets are fetched.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

let worldRenderer, worldScene, worldCamera, attackRenderer, attackScene, attackCamera;
let waterMaterial, fishActors = [], kelpActors = [], jellyActors = [], dust = null;
let diver = null, predator = null, raf = 0, lastTime = 0, depthReader = () => 0, stillReader = () => false;
let worldCanvas, attackCanvas, resizeHandler;
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;

const PALETTES = [
  0xffb84f, 0xff765e, 0x59d8d1, 0x9c8bff, 0xf06da8, 0x92db69, 0x59aef7, 0xf4dc83
];
const PREDATORS = [
  { name: 'Great white', body: 0x829cab, belly: 0xdce9e8, fin: 0x344f63, eye: 0x08151d, marks: 'white' },
  { name: 'Tiger shark', body: 0x718b91, belly: 0xd9e5df, fin: 0x344e57, eye: 0x0a151b, marks: 'stripes' },
  { name: 'Hammerhead', body: 0x91aeb3, belly: 0xe4eddf, fin: 0x42616a, eye: 0x07171b, marks: 'hammer' },
  { name: 'Blue shark', body: 0x387f9f, belly: 0xa6d4d9, fin: 0x164566, eye: 0x071521, marks: 'blue' },
  { name: 'Deep-sea hunter', body: 0x384b61, belly: 0x9aabb0, fin: 0x182a40, eye: 0xb6ff83, marks: 'angler' },
  { name: 'Sawfish', body: 0x668d8a, belly: 0xc9d9ca, fin: 0x314f54, eye: 0x08171c, marks: 'saw' }
];

function makeRenderer(canvas, alpha, power = 'high-performance') {
  const renderer = new THREE.WebGLRenderer({
    canvas, alpha, antialias: true, powerPreference: power,
    premultipliedAlpha: false, stencil: false, depth: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x031b35, alpha ? 0 : 1);
  return renderer;
}

function makeWaterShader() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDepth: { value: 0 }, uResolution: { value: new THREE.Vector2(1, 1) } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime;
      uniform float uDepth;
      uniform vec2 uResolution;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0,0.0)), f.x),
                   mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) {
          v += noise(p) * a;
          p = p * 2.03 + vec2(17.1, 9.2);
          a *= 0.5;
        }
        return v;
      }
      void main() {
        vec2 uv = vUv;
        float t = uTime;
        float d = clamp(uDepth, 0.0, 1.0);
        float n1 = fbm(uv * vec2(8.0, 12.0) + vec2(t * 0.025, -t * 0.04));
        float n2 = fbm(uv * 19.0 - vec2(t * 0.035, t * 0.022));
        float causticA = sin((uv.x * 23.0 + sin(uv.y * 17.0 + t * 0.32 + n1 * 2.0)) * 1.4);
        float causticB = sin((uv.y * 31.0 - cos(uv.x * 18.0 - t * 0.24 + n2)) * 1.25);
        float caustics = pow(max(0.0, causticA * causticB), 5.0);
        float rays = pow(max(0.0, sin(uv.x * 17.0 + sin(t * 0.13 + uv.y * 3.0) * 2.0)), 13.0);
        float surface = smoothstep(0.0, 0.92, uv.y);
        vec3 shallow = mix(vec3(0.018,0.34,0.43), vec3(0.035,0.11,0.24), surface);
        vec3 deep = mix(vec3(0.012,0.085,0.18), vec3(0.002,0.009,0.035), surface);
        vec3 col = mix(shallow, deep, d);
        col += vec3(0.01,0.075,0.09) * (n1 * 0.45 + n2 * 0.22);
        col += vec3(0.18,0.56,0.48) * caustics * (1.0-d) * (0.28 + surface * 0.6);
        col += vec3(0.09,0.33,0.42) * rays * (1.0-d) * 0.32;
        float haze = smoothstep(0.0, 0.8, uv.y) * (0.07 + d * 0.18);
        col = mix(col, vec3(0.003,0.018,0.045), haze);
        float vignette = smoothstep(0.9, 0.18, length((uv-0.5) * vec2(0.8,1.0)));
        col *= 0.76 + vignette * 0.24;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

// Smooth ring-built fish bodies. The nose is +Z so the models swim directly toward the camera.
function bodyGeometry(stations, radialSegments = 24) {
  const vertices = [], indices = [], uvs = [];
  for (let i = 0; i < stations.length; i++) {
    const [z, rx, ry] = stations[i];
    for (let j = 0; j <= radialSegments; j++) {
      const a = j / radialSegments * TAU;
      vertices.push(Math.cos(a) * rx, Math.sin(a) * ry, z);
      uvs.push(j / radialSegments, i / (stations.length - 1));
    }
  }
  for (let i = 0; i < stations.length - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * (radialSegments + 1) + j;
      const b = a + radialSegments + 1;
      const c = b + 1, d = a + 1;
      indices.push(a, d, b, d, c, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function triMesh(points, material, parent) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.material.side = THREE.DoubleSide;
  parent.add(mesh);
  return mesh;
}

function tube(points, radius, material, parent, segments = 24) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 7, false), material);
  parent.add(mesh);
  return mesh;
}

function sphere(parent, material, pos, scale, segments = 18) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, segments, Math.max(10, Math.floor(segments * 0.7))), material);
  mesh.position.set(...pos);
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}

function makeFish(colorHex, size = 1, speciesIndex = 0) {
  const root = new THREE.Group();
  root.scale.setScalar(size);
  const base = new THREE.Color(colorHex);
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: base, metalness: 0.18, roughness: 0.25, clearcoat: 0.9, clearcoatRoughness: 0.18
  });
  const finMat = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.72), roughness: 0.3, metalness: 0.16, side: THREE.DoubleSide });
  const bellyMat = new THREE.MeshStandardMaterial({ color: 0xd8f5e9, roughness: 0.42, metalness: 0.04 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x082332, roughness: 0.24 });
  const eyeWhite = new THREE.MeshPhysicalMaterial({ color: 0xeaffff, roughness: 0.1 });
  const eyeBlack = new THREE.MeshStandardMaterial({ color: 0x020d16, roughness: 0.12 });
  const stations = [
    [-1.28, 0.025, 0.025], [-0.98, 0.17, 0.15], [-0.64, 0.29, 0.24],
    [-0.18, 0.39, 0.31], [0.28, 0.37, 0.3], [0.65, 0.27, 0.23],
    [0.92, 0.13, 0.13], [1.08, 0.018, 0.018]
  ];
  const body = new THREE.Mesh(bodyGeometry(stations), bodyMat);
  root.add(body);
  // Light belly as a subtle lower-half material shell.
  const belly = sphere(root, bellyMat, [0, -0.12, 0.07], [0.29, 0.18, 0.68], 20);
  belly.material.transparent = true; belly.material.opacity = 0.27;
  // Tail forks and dorsal fin.
  triMesh([0,0,-1.06, -0.37,0.02,-1.72, -0.05,0,-1.42, 0,0,-1.06, 0.37,0.02,-1.72, 0.05,0,-1.42], finMat, root);
  triMesh([-0.1,0.19,-0.55, 0,0.63,-0.9, 0.14,0.16,-0.37], finMat, root);
  // Pectoral fins fan backward and sideways in perspective.
  triMesh([-0.22,-0.02,-0.06, -1.02,-0.12,-0.74, -0.48,-0.22,0.42], finMat, root);
  triMesh([0.22,-0.02,-0.06, 1.02,-0.12,-0.74, 0.48,-0.22,0.42], finMat, root);
  // Eyes and gill detail, visible on a head-on approach.
  for (const side of [-1, 1]) {
    sphere(root, darkMat, [side*0.255, 0.105, 0.73], [0.105,0.085,0.08], 16);
    sphere(root, eyeWhite, [side*0.27, 0.12, 0.79], [0.048,0.05,0.035], 14);
    sphere(root, eyeBlack, [side*0.27, 0.12, 0.82], [0.022,0.032,0.018], 12);
    for (let i=0;i<3;i++) {
      tube([[side*(0.31+i*0.045),-0.03,0.5-i*0.025],[side*(0.38+i*0.04),-0.1,0.31-i*0.035],[side*(0.34+i*0.04),-0.18,0.15-i*0.025]], 0.009, darkMat, root, 9);
    }
  }
  // Scales as fine curved ridges, not a texture image.
  const scaleMat = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(1.18), roughness: 0.5, transparent: true, opacity: 0.24 });
  for (let row=0;row<3;row++) for (let i=0;i<6;i++) {
    const z=-0.42+i*0.17, x=(row-1)*0.13, y=0.13+Math.sin(i*0.7)*0.035;
    tube([[x-0.045,y,z],[x,y+0.025,z+0.045],[x+0.045,y,z+0.09]],0.004,scaleMat,root,6);
  }
  root.userData.tail = null;
  root.userData.finL = null;
  root.userData.finR = null;
  root.userData.phase = rand(0,TAU);
  root.userData.speed = rand(1.1,3.0);
  root.userData.color = colorHex;
  return root;
}

function makeShark(variant = 0) {
  const p = PREDATORS[variant % PREDATORS.length];
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({ color:p.body, metalness:0.22, roughness:0.27, clearcoat:0.92, clearcoatRoughness:0.16 });
  const finMat = new THREE.MeshPhysicalMaterial({ color:p.fin, metalness:0.2, roughness:0.3, side:THREE.DoubleSide, clearcoat:0.65 });
  const bellyMat = new THREE.MeshStandardMaterial({ color:p.belly, roughness:0.42 });
  const dark = new THREE.MeshStandardMaterial({ color:0x130b13, roughness:0.22 });
  const gum = new THREE.MeshStandardMaterial({ color:0x853d4d, roughness:0.36 });
  const toothMat = new THREE.MeshPhysicalMaterial({ color:0xfff5dc, roughness:0.18, clearcoat:0.8 });
  const eyeMat = new THREE.MeshStandardMaterial({ color:p.eye, metalness:0.18, roughness:0.12 });
  const glint = new THREE.MeshBasicMaterial({ color:0xffffff });
  root.userData.jaw = new THREE.Group();

  const stations=[
    [-2.9,0.035,0.035],[-2.55,0.18,0.15],[-2.05,0.34,0.25],[-1.48,0.55,0.36],
    [-0.82,0.78,0.48],[-0.1,0.98,0.57],[0.68,1.0,0.63],[1.34,0.82,0.58],
    [1.9,0.55,0.41],[2.28,0.2,0.19],[2.43,0.025,0.025]
  ];
  const body=new THREE.Mesh(bodyGeometry(stations,40),bodyMat);
  body.material.side=THREE.DoubleSide;
  root.add(body);
  // Belly plane follows the broad lower face.
  sphere(root,bellyMat,[0,-0.34,0.35],[0.82,0.37,1.28],32);

  // Massive paired pectoral fins, rear tail and dorsal fin form a clear shark silhouette.
  triMesh([-0.58,-0.22,0.05,-2.42,-0.34,-0.98,-1.25,-0.72,0.38],finMat,root);
  triMesh([0.58,-0.22,0.05,2.42,-0.34,-0.98,1.25,-0.72,0.38],finMat,root);
  triMesh([-0.3,0.39,-0.6,0,1.72,-1.2,0.35,0.4,-0.28],finMat,root);
  triMesh([0,0,-2.62,-0.62,0,-3.35,-0.08,0,-3.02,0,0,-2.62,0.62,0,-3.35,0.08,0,-3.02],finMat,root);
  // Secondary pelvic fins.
  triMesh([-0.35,-0.42,-1.4,-0.92,-0.62,-2.05,-0.12,-0.5,-1.9],finMat,root);
  triMesh([0.35,-0.42,-1.4,0.92,-0.62,-2.05,0.12,-0.5,-1.9],finMat,root);

  // Front-facing eyes with sockets, iris and wet catchlights.
  for(const side of [-1,1]){
    sphere(root,dark,[side*0.68,0.51,1.76],[0.235,0.19,0.13],24);
    sphere(root,eyeMat,[side*0.69,0.52,1.84],[0.14,0.145,0.105],22);
    sphere(root,glint,[side*0.72,0.57,1.93],[0.044,0.05,0.025],12);
    sphere(root,bellyMat,[side*0.55,0.83,1.47],[0.29,0.075,0.28],18);
  }

  // Large mouth cavity and gum rim, looking straight at the lens.
  sphere(root,dark,[0,-0.27,2.18],[0.91,0.58,0.12],32);
  tube([[-0.92,0.02,2.2],[-0.58,0.2,2.25],[0,0.28,2.27],[0.58,0.2,2.25],[0.92,0.02,2.2]],0.065,gum,root,30);
  // Upper fangs and small intermediate teeth.
  for(let i=0;i<13;i++){
    const x=-0.78+i*0.13;
    const y=0.1+0.18*(1-Math.abs(x)/0.9);
    const tooth=new THREE.Mesh(new THREE.ConeGeometry(i%3===0?0.075:0.052,i%3===0?0.26:0.19,6),toothMat);
    tooth.position.set(x,y,2.3); tooth.rotation.z=Math.PI; root.add(tooth);
  }

  // Lower moving jaw has its own pivot, teeth and curved lip.
  const jaw=root.userData.jaw;
  tube([[-0.86,-0.41,2.18],[-0.56,-0.73,2.22],[0,-0.86,2.24],[0.56,-0.73,2.22],[0.86,-0.41,2.18]],0.14,bodyMat,jaw,30);
  tube([[-0.82,-0.37,2.25],[0,-0.79,2.28],[0.82,-0.37,2.25]],0.043,gum,jaw,24);
  for(let i=0;i<11;i++){
    const x=-0.72+i*0.144, y=-0.48-0.25*(1-Math.abs(x)/0.8);
    const tooth=new THREE.Mesh(new THREE.ConeGeometry(0.05,0.18,5),toothMat);
    tooth.position.set(x,y,2.31); tooth.rotation.z=0; jaw.add(tooth);
  }
  root.add(jaw);

  // Deep gill grooves on both sides and species-specific patterning.
  for(const side of [-1,1]){
    for(let i=0;i<5;i++){
      const z=0.55-i*0.2;
      tube([[side*0.82,0.18,z],[side*0.98,0.0,z-0.06],[side*0.9,-0.24,z-0.12]],0.027,dark,root,12);
    }
  }
  if(p.marks==='stripes'){
    const stripeMat=new THREE.MeshStandardMaterial({color:0x152c3a,roughness:0.7});
    for(let i=0;i<8;i++){
      const x=-0.68+i*0.19;
      tube([[x,0.48,0.68],[x*1.06,0.03,0.72],[x*0.92,-0.45,0.5]],0.055,stripeMat,root,14);
    }
  }
  if(p.marks==='angler'){
    const lureMat=new THREE.MeshStandardMaterial({color:0xafff72,emissive:0x70ff36,emissiveIntensity:2.2});
    tube([[0,0.9,0.7],[0.06,1.58,1.05],[0.33,1.82,1.45]],0.045,finMat,root,20);
    sphere(root,lureMat,[0.33,1.82,1.45],[0.18,0.18,0.18],16);
  }
  if(p.marks==='saw'){
    const sawMat=new THREE.MeshStandardMaterial({color:p.body,roughness:0.35});
    const saw=new THREE.Mesh(new THREE.ConeGeometry(0.28,1.2,4),sawMat);
    saw.position.set(0,-0.68,2.8); saw.rotation.x=Math.PI/2; root.add(saw);
    for(let i=0;i<9;i++){
      const tooth=new THREE.Mesh(new THREE.ConeGeometry(0.055,0.2,4),toothMat);
      tooth.position.set((i-4)*0.105,-0.72,2.95); tooth.rotation.x=Math.PI/2; root.add(tooth);
    }
  }
  if(p.marks==='hammer'){
    const headbar=sphere(root,bodyMat,[0,0.69,1.52],[1.48,0.2,0.37],24);
    headbar.material=bodyMat;
    sphere(root,eyeMat,[-1.35,0.68,1.56],[0.12,0.12,0.12],12);
    sphere(root,eyeMat,[1.35,0.68,1.56],[0.12,0.12,0.12],12);
  }
  root.userData.jawOpen=0;
  root.userData.tail=null;
  return root;
}

function createReefBranch(parent, origin, direction, length, radius, material, depth = 3) {
  if(depth<=0 || length<0.14) return;
  const end= new THREE.Vector3(origin[0]+direction[0]*length,origin[1]+direction[1]*length,origin[2]+direction[2]*length);
  const mid=new THREE.Vector3((origin[0]+end.x)*0.5,(origin[1]+end.y)*0.5,(origin[2]+end.z)*0.5);
  const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(...origin),mid,end]);
  const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,9,radius,6,false),material);
  parent.add(mesh);
  createReefBranch(parent,[end.x,end.y,end.z],[direction[0]+0.45,direction[1]+0.38,direction[2]],length*0.66,radius*0.68,material,depth-1);
  createReefBranch(parent,[end.x,end.y,end.z],[direction[0]-0.5,direction[1]+0.44,direction[2]],length*0.62,radius*0.64,material,depth-1);
}

function addReef() {
  const groundMat=new THREE.MeshStandardMaterial({color:0x0b3943,roughness:0.95});
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(180,90),groundMat);
  ground.rotation.x=-Math.PI/2; ground.position.set(0,-6.2,-24); worldScene.add(ground);
  for(let side of [-1,1]){
    for(let i=0;i<8;i++){
      const x=side*(11+rand(0,12)), z=-12-rand(0,36);
      const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.7,2.2),1),
        new THREE.MeshStandardMaterial({color:[0x123d50,0x1d5260,0x254a5a][i%3],roughness:0.98}));
      rock.position.set(x,-5.4+rand(-0.4,0.4),z);
      rock.scale.set(rand(0.9,2.1),rand(0.6,1.4),rand(0.8,1.8));
      worldScene.add(rock);
    }
    for(let i=0;i<4;i++){
      const root=new THREE.Group();
      root.position.set(side*(13+rand(0,6)),-5.3,-13-i*7);
      worldScene.add(root);
      const mat=new THREE.MeshPhysicalMaterial({
        color:[0xff765f,0xffb25d,0xd96bb0,0x75cfb8,0x94d96c,0x9882ee][(i+(side>0?2:0))%6],
        roughness:0.36,metalness:0.06,clearcoat:0.5
      });
      createReefBranch(root,[0,0,0],[0.04,1,0],rand(2.1,3.9),0.13,mat,3);
      root.rotation.z=rand(-0.12,0.12);
    }
  }
  // Swaying kelp curtains.
  for(let i=0;i<22;i++){
    const side=i%2?1:-1;
    const group=new THREE.Group();
    group.position.set(side*(9+rand(0,9)),-5.6,-9-rand(0,35));
    worldScene.add(group);
    const height=rand(2.4,5.3), sway=rand(0.35,1.15), phase=rand(0,TAU);
    const points=[];
    for(let k=0;k<=8;k++){
      const t=k/8;
      points.push(new THREE.Vector3(Math.sin(t*1.7)*sway*t,t*height,Math.cos(t*1.4+phase)*0.18));
    }
    const curve=new THREE.CatmullRomCurve3(points);
    const mat=new THREE.MeshStandardMaterial({color:[0x1b8f79,0x267e73,0x3b9b73][i%3],roughness:0.72,side:THREE.DoubleSide});
    const stem=new THREE.Mesh(new THREE.TubeGeometry(curve,22,rand(0.045,0.09),7,false),mat);
    group.add(stem);
    kelpActors.push({group,phase,sway});
  }
}

function addJellyfish() {
  for(let i=0;i<8;i++){
    const g=new THREE.Group();
    const hue=[0x7ff7e8,0x9c81ff,0x68caff,0xf18cda][i%4];
    const mat=new THREE.MeshPhysicalMaterial({color:hue,roughness:0.12,metalness:0.1,transparent:true,opacity:0.56,transmission:0.35,thickness:0.6,emissive:hue,emissiveIntensity:0.18,side:THREE.DoubleSide});
    const dome=new THREE.Mesh(new THREE.SphereGeometry(0.66,28,18,0,TAU,0,Math.PI*0.55),mat);
    dome.scale.y=0.72; g.add(dome);
    const glow=new THREE.PointLight(hue,0.8,5); glow.position.set(0,-0.1,0.1); g.add(glow);
    for(let j=0;j<7;j++){
      const x=(j-3)*0.14;
      const pts=[];
      for(let k=0;k<=7;k++){
        const t=k/7;
        pts.push(new THREE.Vector3(x+Math.sin(t*3+j)*0.12,t*-1.9,Math.cos(t*2+j)*0.08));
      }
      const curve=new THREE.CatmullRomCurve3(pts);
      const tentacle=new THREE.Mesh(new THREE.TubeGeometry(curve,16,0.018,5,false),
        new THREE.MeshStandardMaterial({color:0xd9ffff,transparent:true,opacity:0.58,emissive:hue,emissiveIntensity:0.12}));
      g.add(tentacle);
    }
    g.position.set(rand(-15,15),rand(-1,6),-14-rand(0,28));
    worldScene.add(g);
    jellyActors.push({group:g,phase:rand(0,TAU),speed:rand(0.3,0.7)});
  }
}

function addDiver() {
  const g=new THREE.Group();
  const suit=new THREE.MeshStandardMaterial({color:0x172f49,roughness:0.52});
  const trim=new THREE.MeshStandardMaterial({color:0xf0a75e,roughness:0.38});
  const tankMat=new THREE.MeshPhysicalMaterial({color:0xc1e2dd,metalness:0.72,roughness:0.2,clearcoat:0.7});
  const mask=new THREE.MeshPhysicalMaterial({color:0x6be9f2,metalness:0.25,roughness:0.1,transparent:true,opacity:0.82});
  sphere(g,suit,[0,0,0],[0.48,0.72,0.3],24);
  sphere(g,trim,[0,0.83,0.04],[0.32,0.32,0.29],20);
  sphere(g,mask,[0,0.88,0.29],[0.24,0.13,0.075],18);
  const tank=new THREE.Mesh(new THREE.CylinderGeometry(0.19,0.19,1.05,16),tankMat);
  tank.position.set(0.43,0.05,-0.24); g.add(tank);
  for(const side of [-1,1]){
    const arm=new THREE.Mesh(new THREE.CapsuleGeometry(0.12,0.68,5,10),suit);
    arm.position.set(side*0.56,0.03,0.02); arm.rotation.z=side*-0.42; g.add(arm);
    const leg=new THREE.Mesh(new THREE.CapsuleGeometry(0.15,0.62,5,10),suit);
    leg.position.set(side*0.24,-0.86,-0.02); leg.rotation.z=side*0.18; g.add(leg);
    const fin=triMesh([side*0.16,-1.14,0,side*0.65,-1.55,-0.1,side*0.1,-1.5,-0.12],
      new THREE.MeshStandardMaterial({color:0x102940,side:THREE.DoubleSide}),g);
  }
  g.position.set(0,-3.05,-3.8);
  g.scale.setScalar(0.86);
  worldScene.add(g);
  diver=g;
}

function addMarineSnow() {
  const count=620;
  const positions=new Float32Array(count*3);
  const velocities=new Float32Array(count);
  for(let i=0;i<count;i++){
    positions[i*3]=rand(-22,22); positions[i*3+1]=rand(-8,15); positions[i*3+2]=rand(-58,8);
    velocities[i]=rand(0.12,0.65);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const mat=new THREE.PointsMaterial({color:0xb8fff2,size:0.055,transparent:true,opacity:0.55,depthWrite:false,blending:THREE.AdditiveBlending});
  dust=new THREE.Points(geo,mat);
  dust.userData.velocities=velocities;
  worldScene.add(dust);
}

function addFishSchools() {
  const count=34;
  for(let i=0;i<count;i++){
    const color=PALETTES[i%PALETTES.length];
    const scale=rand(0.52,1.0);
    const fish=makeFish(color,scale,i);
    fish.position.set(rand(-18,18),rand(-4,9),-10-rand(0,53));
    fish.userData.homeX=fish.position.x;
    fish.userData.homeY=fish.position.y;
    fish.userData.speed=rand(1.25,3.8);
    fish.userData.phase=rand(0,TAU);
    fish.userData.turn=rand(0.035,0.12);
    worldScene.add(fish);
    fishActors.push(fish);
  }
  // Three large foreground animals make the player feel surrounded, not watching distant icons.
  for(let i=0;i<4;i++){
    const fish=makeFish(PALETTES[(i+3)%PALETTES.length],rand(0.9,1.25),i);
    fish.position.set((i%2?1:-1)*rand(4.5,8),rand(-1.2,4),-13-rand(0,10));
    fish.userData.homeX=fish.position.x;
    fish.userData.homeY=fish.position.y;
    fish.userData.speed=rand(0.65,1.2);
    fish.userData.phase=rand(0,TAU);
    fish.userData.turn=rand(0.04,0.1);
    worldScene.add(fish);
    fishActors.push(fish);
  }
}

function buildWorld() {
  worldScene=new THREE.Scene();
  worldCamera=new THREE.PerspectiveCamera(58,window.innerWidth/window.innerHeight,0.1,180);
  worldCamera.position.set(0,0.7,13);
  worldCamera.lookAt(0,0,-18);

  const waterGeo=new THREE.PlaneGeometry(180,110);
  waterMaterial=makeWaterShader();
  const water=new THREE.Mesh(waterGeo,waterMaterial);
  water.position.set(0,7,-72);
  worldScene.add(water);

  worldScene.add(new THREE.HemisphereLight(0x9deaff,0x071829,1.3));
  const sun=new THREE.DirectionalLight(0xa5f9ec,2.1); sun.position.set(-7,12,8); worldScene.add(sun);
  const blueFill=new THREE.DirectionalLight(0x478dff,0.8); blueFill.position.set(8,2,-8); worldScene.add(blueFill);
  const aqua=new THREE.PointLight(0x36e7da,3.0,35); aqua.position.set(-3,4,-9); worldScene.add(aqua);
  addReef();
  addJellyfish();
  addFishSchools();
  addDiver();
  addMarineSnow();
}

function buildAttackWorld() {
  attackScene=new THREE.Scene();
  attackCamera=new THREE.PerspectiveCamera(52,window.innerWidth/window.innerHeight,0.08,90);
  attackCamera.position.set(0,0,12);
  attackCamera.lookAt(0,0,0);
}

function resize() {
  const w=window.innerWidth,h=window.innerHeight;
  if(worldRenderer){
    worldRenderer.setSize(w,h,false);
    worldCamera.aspect=w/h; worldCamera.updateProjectionMatrix();
  }
  if(attackRenderer){
    attackRenderer.setSize(w,h,false);
    attackCamera.aspect=w/h; attackCamera.updateProjectionMatrix();
  }
}

export function triggerPredatorAttack(speciesIndex = Math.floor(Math.random()*PREDATORS.length)) {
  if(!attackScene) return;
  if(predator){
    attackScene.remove(predator.group);
    predator.group.traverse(o=>{ if(o.geometry)o.geometry.dispose(); });
  }
  const group=makeShark(speciesIndex);
  group.position.set(rand(-0.65,0.65),0.1,-28);
  group.scale.setScalar(0.22);
  attackScene.add(group);
  predator={group,start:performance.now(),duration:2050,species:speciesIndex};
}

function updateAttack(now) {
  if(!predator) return;
  const elapsed=now-predator.start;
  const p=clamp(elapsed/predator.duration,0,1);
  const approach=clamp(p/0.87,0,1);
  const eased=1-Math.pow(1-approach,3.2);
  const group=predator.group;
  group.position.z=mix(-28,6.6,eased);
  group.position.x=Math.sin(p*TAU*0.55)*mix(0.7,0.06,eased);
  group.position.y=0.15+Math.sin(p*TAU*1.1)*0.1;
  group.scale.setScalar(mix(0.22,1.56,eased));
  group.rotation.y=Math.sin(now*0.003)*0.035*(1-eased);
  group.rotation.x=Math.sin(now*0.002)*0.018;
  const open=clamp((p-0.16)/0.32,0,1);
  group.userData.jaw.position.y=-open*0.42;
  group.userData.jaw.rotation.x=open*0.18;
  if(p>0.78) group.userData.jaw.position.y=-0.42+Math.sin(p*19)*0.04;
  if(p>=1){
    attackScene.remove(group);
    group.traverse(o=>{ if(o.geometry)o.geometry.dispose(); });
    predator=null;
  }
}

function animate(now) {
  raf=requestAnimationFrame(animate);
  if(!worldRenderer) return;
  const dt=lastTime?Math.min(0.05,(now-lastTime)/1000):0.016;
  lastTime=now;
  const still=Boolean(stillReader());
  const t=still?lastTime*0.0002:now*0.001;
  const depth=clamp((Number(depthReader())||0)/40000,0,1);
  waterMaterial.uniforms.uTime.value=t;
  waterMaterial.uniforms.uDepth.value=depth;

  if(!still){
    for(const fish of fishActors){
      fish.position.z+=fish.userData.speed*dt*(0.8+depth*0.55);
      fish.position.x=fish.userData.homeX+Math.sin(t*0.7+fish.userData.phase)*fish.userData.turn*9;
      fish.position.y=fish.userData.homeY+Math.sin(t*1.4+fish.userData.phase)*0.22;
      fish.rotation.y=Math.sin(t*0.8+fish.userData.phase)*0.11;
      fish.rotation.z=Math.sin(t*1.7+fish.userData.phase)*0.035;
      if(fish.position.z>8){
        fish.position.z=-48-rand(0,25);
        fish.userData.homeX=rand(-17,17);
        fish.userData.homeY=rand(-4,9);
      }
    }
    for(const k of kelpActors){
      k.group.rotation.z=Math.sin(t*0.9+k.phase)*0.12*k.sway;
    }
    for(const j of jellyActors){
      j.group.position.y+=Math.sin(t*1.1+j.phase)*0.002*j.speed;
      j.group.position.x+=Math.sin(t*0.23+j.phase)*0.003;
      j.group.rotation.z=Math.sin(t*0.7+j.phase)*0.12;
    }
    if(diver){
      diver.position.y=-3.05+Math.sin(t*0.8)*0.13;
      diver.rotation.z=Math.sin(t*0.7)*0.035;
    }
    if(dust){
      const pos=dust.geometry.attributes.position;
      const v=dust.userData.velocities;
      for(let i=0;i<pos.count;i++){
        pos.array[i*3+1]+=v[i]*dt;
        if(pos.array[i*3+1]>15) pos.array[i*3+1]=-8;
      }
      pos.needsUpdate=true;
    }
  }
  worldRenderer.render(worldScene,worldCamera);
  if(attackRenderer && attackScene){
    updateAttack(now);
    attackRenderer.clear();
    attackRenderer.render(attackScene,attackCamera);
  }
}

export function startScene3D(depthFn, stillFn, fallbackCanvas) {
  depthReader=typeof depthFn==='function'?depthFn:depthReader;
  stillReader=typeof stillFn==='function'?stillFn:stillReader;

  worldCanvas=document.createElement('canvas');
  worldCanvas.id='deepwell-3d-world';
  worldCanvas.setAttribute('aria-hidden','true');
  worldCanvas.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;display:block';
  document.body.insertBefore(worldCanvas,document.body.firstChild);
  worldRenderer=makeRenderer(worldCanvas,false);
  buildWorld();

  attackCanvas=document.createElement('canvas');
  attackCanvas.id='deepwell-3d-attack';
  attackCanvas.setAttribute('aria-hidden','true');
  attackCanvas.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:3;pointer-events:none;display:block';
  document.body.appendChild(attackCanvas);
  attackRenderer=makeRenderer(attackCanvas,true);
  buildAttackWorld();
  if(fallbackCanvas) fallbackCanvas.style.display='none';

  resizeHandler=resize;
  window.addEventListener('resize',resizeHandler,{passive:true});
  if(fallbackCanvas) fallbackCanvas.dataset.webgl='enabled';
  raf=requestAnimationFrame(animate);
  return true;
}

export function stopScene3D() {
  cancelAnimationFrame(raf);
  window.removeEventListener('resize',resizeHandler);
  worldRenderer?.dispose();
  attackRenderer?.dispose();
  worldCanvas?.remove();
  attackCanvas?.remove();
  fishActors=[]; kelpActors=[]; jellyActors=[];
  predator=null;
}
