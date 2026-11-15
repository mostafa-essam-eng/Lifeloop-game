import * as THREE from 'three';

const $ = id => document.getElementById(id);
const ui = {
  start:$('start-screen'), hud:$('hud'), mission:$('mission-panel'),
  help:$('instructions'), station:$('station-modal'), win:$('win-screen'),
  prompt:$('interaction-prompt'), location:$('location-label'),
  controls:$('controls-hint'), notification:$('notification')
};

let scene, camera, renderer, clock, player, yaw=0, pitch=0, pointerLocked=false;
let started=false, soundOn=true, activeStation=null, nearby=null, currentHouse=null, referenceVisible=false;
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
let mobileMoveX=0, mobileMoveY=0, mobileRun=false, lookPointerId=null, lastLookX=0, lastLookY=0;
const keys={};
const resources={oxygen:82,water:74,energy:90};
let foodSupply=55, missionDay=0, missionScenario=null;
const deferredEffects=[];
const activated=new Set();
const houses=[];
let notifyTimer;

// --- متغيرات الواقعية والفيزياء ---
let velocityY = 0;
let isGrounded = true;
const MARS_GRAVITY = -9.8;
const JUMP_FORCE = 5.2;
let bobTimer = 0;
let dustStormActive = false;
let stormIntensity = 0;
let stormTimer = 25;
let windGainNode = null;
let windFilterNode = null; // لفلترة الأصوات عند دخول المباني
let lastBreathTime = 0;

let stamina = 100;
let flashlightOn = false;
let flashlight = null;
let sunLight, sunSphere, sunGlow;
let dayTime = 0;
let roverRef = null;

let visorDustLevel = 0;
let visorDustEl = null;
let suitGlitchEl = null; // شاشة التشويش عند انخفاض الموارد
let photoMode = false;
let photoBanner = null;
const photoCamPos = new THREE.Vector3();

const stations = [
 {id:'oxygen',name:'Oxygen Generator',category:'LIFE SUPPORT',position:[-8,0,-5],color:0x54d9df,desc:'The MOXIE-inspired unit processes Martian CO₂ and supports the colony oxygen supply.',info:'System: CO₂ processing · Backup: water electrolysis',gain:{oxygen:28,energy:-8}},
 {id:'water',name:'Water Recovery',category:'WATER SYSTEM',position:[8,0,-5],color:0x55aaff,desc:'This station filters and recycles water so the crew can reuse precious supplies.',info:'System: filtration · Recovery: recycled water',gain:{water:30,energy:-7}},
 {id:'food',name:'Hydroponic Greenhouse',category:'FOOD PRODUCTION',position:[-8,0,12],color:0x83d66b,desc:'Enter the greenhouse, choose a crop, and plant it in a hydroponic bed filled with lightweight expanded clay pebbles (LECA).',info:'Growing medium: LECA clay pellets · Crops: tomato · potato · lettuce · dwarf wheat · kale',gain:{food:32,water:-5,energy:-5}},
 {id:'energy',name:'Solar Power Hub',category:'ENERGY NETWORK',position:[8,0,7],color:0xffc15a,desc:'Solar panels charge the colony batteries. The colony depends on stored energy to operate its life-support systems.',info:'Trade-off: activating the hub restores energy; other systems consume energy to operate.',gain:{energy:35}},
 {id:'algae',name:'Algae Bioreactor',category:'BIOLOGICAL LIFE SUPPORT',position:[-19,0,8],color:0x63d68a,desc:'The photobioreactor contains Spirulina and Chlorella. With light, water, and carbon dioxide, these photosynthetic microorganisms can grow and release oxygen. Their biomass is a research resource, not an automatically safe food supply.',info:'Trade-off: supports oxygen (+18) but uses water (-4) and energy (-6). Inspired by biological space research; not a validated operational Mars system.',gain:{oxygen:18,water:-4,energy:-6}}
];

function init(){
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x9b5945);
  scene.fog=new THREE.FogExp2(0x9b5945, 0.014);
  camera=new THREE.PerspectiveCamera(70,innerWidth/innerHeight,.1,220);
  camera.position.set(0,2.15,12);
  renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setSize(innerWidth,innerHeight);
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.15;
  $('game').appendChild(renderer.domElement);
  clock=new THREE.Clock();

  createVisorOverlay();
  createStaminaHud();
  createPhotoBanner();

  const hemi=new THREE.HemisphereLight(0xffd9c0,0x432b2b,2.1); scene.add(hemi);
  
  sunLight=new THREE.DirectionalLight(0xffd1a2,3.1); 
  sunLight.position.set(-12,22,12); 
  sunLight.castShadow=true; 
  sunLight.shadow.mapSize.set(2048,2048); 
  scene.add(sunLight);

  makeTerrain(); makeSky(); makeHabitat(); makeRocks(); makeDistantHills(); makeSolarArray(); makeGreenhouse(); makeHouses(); makeAlgaeBioreactor(); makeSupportFacilities(); makeColonyExpansion();
  
  player=new THREE.Group(); player.position.set(0,0,12); scene.add(player);
  makeAstronaut(player);

  flashlight = new THREE.SpotLight(0xdff4ff, 4.5, 35, Math.PI/5, 0.4, 1);
  flashlight.position.set(0, 0, 0);
  camera.add(flashlight);
  flashlight.target.position.set(0, 0, -25);
  camera.add(flashlight.target);
  scene.add(camera);
  flashlight.visible = false;

  stations.forEach(makeStation);
  makeDust();
  window.addEventListener('resize',onResize);
  document.addEventListener('keydown',onKeyDown);
  document.addEventListener('keyup',e=>keys[e.code]=false);
  renderer.domElement.addEventListener('click',()=>{if(started&&!ui.station.classList.contains('hidden'))return; if(started&&!isTouchDevice)renderer.domElement.requestPointerLock();});
  document.addEventListener('pointerlockchange',()=>{pointerLocked=document.pointerLockElement===renderer.domElement;});
  document.addEventListener('mousemove',e=>{if(pointerLocked){yaw-=e.movementX*.0022;pitch-=e.movementY*.0018;pitch=Math.max(-.65,Math.min(.65,pitch));}});
  setupMobileControls();
  $('start-btn').onclick=startGame;
  $('how-btn').onclick=openHelp;
  $('sources-btn').onclick=openSources;
  $('learning-btn').onclick=openLearning;
  $('learn-hud-btn').onclick=openLearning;
  $('close-sources').onclick=closeSources;
  $('close-learning').onclick=closeLearning;
  $('learning-modal').addEventListener('click',e=>{if(e.target===$('learning-modal'))closeLearning();});
  $('sources-modal').addEventListener('click',e=>{if(e.target===$('sources-modal'))closeSources();});
  $('close-help').onclick=closeHelp;
  ui.help.addEventListener('click',e=>{if(e.target===ui.help)closeHelp();});
  $('close-station').onclick=closeStation;
  $('activate-btn').onclick=activateStation;
  $('activate-btn').classList.add('hidden');
  document.querySelectorAll('.crop-btn').forEach(btn=>btn.addEventListener('click',()=>plantCrop(btn.dataset.crop))); 
  $('sound-btn').onclick=()=>{
    soundOn=!soundOn;
    $('sound-btn').textContent=soundOn?'♫':'♪';
    if(windGainNode) windGainNode.gain.value = soundOn ? (currentHouse ? 0.003 : (0.015 + stormIntensity * 0.08)) : 0;
    notify(soundOn?'Sound enabled':'Sound muted');
  };
  $('exit-btn').onclick=()=>{if(window.confirm('Exit to the main menu? Your current mission progress will be reset.'))location.reload();};
  $('restart-btn').onclick=()=>location.reload();
  animate();
}

function createVisorOverlay(){
  const visor = document.createElement('div');
  visor.id = 'helmet-visor-frame';
  visor.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1;box-shadow:inset 0 0 110px rgba(0,0,0,0.82), inset 0 0 30px rgba(255,140,70,0.14);border-radius:20px;transition:opacity 0.3s;';
  document.body.appendChild(visor);

  visorDustEl = document.createElement('div');
  visorDustEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2;opacity:0;transition:opacity 0.25s;background:radial-gradient(circle at 20% 25%, rgba(185,95,62,0.55) 0%, transparent 45%), radial-gradient(circle at 82% 75%, rgba(165,80,50,0.65) 0%, transparent 50%), radial-gradient(circle at 50% 50%, rgba(190,105,70,0.18) 0%, rgba(145,65,40,0.75) 100%);';
  document.body.appendChild(visorDustEl);

  // شاشة التشويش الإلكتروني عند انخفاض الموارد
  suitGlitchEl = document.createElement('div');
  suitGlitchEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:4;opacity:0;background:repeating-linear-gradient(0deg, rgba(255,50,50,0.15), rgba(255,50,50,0.15) 2px, transparent 2px, transparent 4px);transition:opacity 0.3s;';
  document.body.appendChild(suitGlitchEl);
}

function createPhotoBanner(){
  photoBanner = document.createElement('div');
  photoBanner.className = 'hidden';
  photoBanner.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:15;background:rgba(10,16,26,0.85);border:1px solid rgba(255,192,120,0.5);padding:8px 18px;border-radius:20px;font-family:"Orbitron",sans-serif;font-size:10px;letter-spacing:1.2px;color:#ffd19a;pointer-events:none;';
  photoBanner.innerHTML = 'CINEMATIC PHOTO MODE · WASD FLY · SPACE UP · SHIFT DOWN · PRESS <b>P</b> TO EXIT';
  document.body.appendChild(photoBanner);
}

function createStaminaHud(){
  const container = document.createElement('div');
  container.id = 'stamina-hud';
  container.style.cssText = 'position:fixed;z-index:3;right:25px;top:115px;width:165px;background:rgba(12,18,29,0.85);border:1px solid rgba(255,255,255,0.15);padding:8px 12px;border-radius:8px;font-family:"Orbitron",sans-serif;transition:opacity 0.3s;';
  container.innerHTML = '<div style="display:flex;justify-content:space-between;font-size:9px;color:#c4d0df;margin-bottom:5px;"><span>STAMINA</span><b id="stamina-val">100%</b></div><div style="height:4px;background:#364151;border-radius:4px;overflow:hidden;"><i id="stamina-bar" style="display:block;height:100%;width:100%;background:#54d9df;transition:width 0.2s;"></i></div><div style="margin-top:6px;font-size:8px;color:#ff9b66;letter-spacing:1px;">HEART RATE: <b id="hr-val">72</b> BPM</div><div style="margin-top:4px;font-size:8px;color:#a8edce;letter-spacing:0.8px;">VISOR DUST: <b id="dust-val">0%</b> [R]</div>';
  document.body.appendChild(container);
}

function mat(color,roughness=.8,metalness=0){return new THREE.MeshStandardMaterial({color,roughness,metalness});}
function addMesh(parent,geometry,material,x,y,z,cast=true){const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=cast;m.receiveShadow=true;parent.add(m);return m;}
function makeTerrain(){
 const ground=addMesh(scene,new THREE.PlaneGeometry(180,180,80,80),mat(0x9b4f39),0,-.25,0,false);
 ground.rotation.x=-Math.PI/2;
 const positions=ground.geometry.attributes.position;
 for(let i=0;i<positions.count;i++){const x=positions.getX(i),y=positions.getY(i);positions.setZ(i,(Math.sin(x*.22)*Math.cos(y*.18)+Math.sin(y*.4)*.35)*.28);}
 ground.geometry.computeVertexNormals();
 for(let i=0;i<900;i++){const x=(Math.random()-.5)*90,z=(Math.random()-.5)*90;if(Math.abs(x)<14&&Math.abs(z)<14)continue;const r=.12+Math.random()*.5;const rock=addMesh(scene,new THREE.DodecahedronGeometry(r,0),mat(Math.random()>.5?0x704033:0xb36b50),x,-.05,z);rock.rotation.set(Math.random(),Math.random(),Math.random());}
}
function makeSky(){
 sunSphere=new THREE.Mesh(new THREE.SphereGeometry(2.1,24,16),new THREE.MeshBasicMaterial({color:0xffd7a1}));
 sunSphere.position.set(-28,23,-65);scene.add(sunSphere);
 sunGlow=new THREE.PointLight(0xffa76e,65,100);sunGlow.position.copy(sunSphere.position);scene.add(sunGlow);
}
function makeDistantHills(){for(let i=0;i<16;i++){const h=4+Math.random()*9,w=7+Math.random()*12;const hill=addMesh(scene,new THREE.ConeGeometry(w,h,5),mat(i%2?0x754237:0x874a3d),-45+i*6,-.2,-48-Math.random()*10,false);hill.rotation.z=Math.PI;}}
function makeRocks(){for(let i=0;i<150;i++){let x=(Math.random()-.5)*32,z=(Math.random()-.5)*30;if(Math.abs(x)<5&&Math.abs(z)<5)continue;const rock=addMesh(scene,new THREE.DodecahedronGeometry(.3+Math.random()*.8,1),mat(0x744333),x,.05,z);rock.scale.y=.5+Math.random();}}
function makeHabitat(){
 const shell=addMesh(scene,new THREE.CylinderGeometry(3.2,3.2,3.2,16,1,true),mat(0xb8c4ce,.45,.35),0,1.35,-15);shell.rotation.z=Math.PI/2;
 const capMat=mat(0x627a8c,.4,.4);
 addMesh(scene,new THREE.SphereGeometry(1.6,20,12,0,Math.PI*2,0,Math.PI/2),capMat,-3.2,1.35,-15);
 addMesh(scene,new THREE.SphereGeometry(1.6,20,12,0,Math.PI*2,0,Math.PI/2),capMat,3.2,1.35,-15).rotation.z=Math.PI;
 for(let i=0;i<5;i++){const ring=addMesh(scene,new THREE.TorusGeometry(3.22,.055,8,32),mat(0xffa16e,.3,.5),-2.4+i*1.2,1.35,-15);ring.rotation.y=Math.PI/2;}
 addMesh(scene,new THREE.BoxGeometry(.15,1.8,1.3),mat(0x283d4e),0,.8,-11.75);
 addMesh(scene,new THREE.BoxGeometry(2.2,.5,.12),mat(0x17293b),0,3.2,-15);
}
const greenhouse = { group:null, beds:[], plants:[] };
const farms = [];
const allCropPlants = [];
function makeGreenhouse(){
 const g=new THREE.Group();g.position.set(-8,0,7);scene.add(g);greenhouse.group=g;
 const frame=mat(0xb9d4d8,.35,.35),glass=new THREE.MeshPhysicalMaterial({color:0x8edbd1,transparent:true,opacity:.13,roughness:.12,metalness:.08,side:THREE.DoubleSide});
 addMesh(g,new THREE.BoxGeometry(9.2,.22,7.2),mat(0x394b4b),0,.05,0);
 const walls=[[-4.5,1.65,0,.12,3.1,7],[4.5,1.65,0,.12,3.1,7],[0,1.65,-3.5,9,3.1,.12],[0,1.65,3.5,9,3.1,.12]];
 walls.forEach(([x,y,z,w,h,d])=>{addMesh(g,new THREE.BoxGeometry(w,h,d),glass,x,y,z,false);});
 const roof=new THREE.Mesh(new THREE.SphereGeometry(4.55,24,12,0,Math.PI*2,0,Math.PI/2),glass);roof.position.set(0,3.1,0);roof.scale.set(1,.55,.8);g.add(roof);
 for(let x=-4;x<=4;x+=2){const rib=addMesh(g,new THREE.CylinderGeometry(.035,.035,3.4,8),frame,x,1.7,-3.45);rib.rotation.z=.05;}
 for(let z=-3;z<=3;z+=2){addMesh(g,new THREE.BoxGeometry(8.8,.045,.045),frame,0,3.1,z);}
 const bedMat=mat(0x263b38),rim=mat(0xa5b8b0,.55),clayMats=[mat(0xc58b62),mat(0xb97850),mat(0xd6a477)];
 for(let row=0;row<2;row++){
  const z=-1.65+row*3.25;
  const bed=new THREE.Group();bed.position.set(0,.55,z);g.add(bed);
  addMesh(bed,new THREE.BoxGeometry(7.6,.34,1.55),bedMat,0,0,0);
  for(const [x,y,zz,w,h,d] of [[0,.19,-.76,7.7,.12,.09],[0,.19,.76,7.7,.12,.09],[-3.8,.19,0,.09,.12,1.5],[3.8,.19,0,.09,.12,1.5]])addMesh(bed,new THREE.BoxGeometry(w,h,d),rim,x,y,zz);
  for(let i=0;i<210;i++){const x=(Math.random()-.5)*7.35,zp=(Math.random()-.5)*1.35;const r=.045+Math.random()*.045;const pellet=addMesh(bed,new THREE.SphereGeometry(r,7,5),clayMats[i%3],x,.22+Math.random()*.025,zp);pellet.scale.y=.72+Math.random()*.5;}
  greenhouse.beds.push(bed);
 }
 const pipe=addMesh(g,new THREE.CylinderGeometry(.07,.07,7.8,10),mat(0x4a9f9c,.35,.4),-4.12,.8,0);pipe.rotation.z=Math.PI/2;
 addMesh(g,new THREE.BoxGeometry(1.1,1.35,.7),mat(0x29404b,.45,.25),3.65,.8,2.6);
 addMesh(g,new THREE.BoxGeometry(7.5,.08,.35),new THREE.MeshStandardMaterial({color:0xc9f7ff,emissive:0x72d8e8,emissiveIntensity:1.3}),0,2.85,0);
 const light=new THREE.PointLight(0x9de8d0,2.1,12);light.position.set(0,2.5,0);g.add(light);
 const sign=makeTextSprite('HYDROPONIC GREENHOUSE · LECA');sign.position.set(0,4.1,3.85);sign.scale.set(4.5,.65,1);g.add(sign);
 farms.push({name:'Main Hydroponic Greenhouse',center:[-8,7],rows:[-1.65,1.6],columns:6,xStart:-3.1,xStep:1.24,plants:[]});
}
function makeHouses(){
 const locations=[
  {name:'Crew House 01',position:[-2,0,-1],crew:'Commander + Engineer'},
  {name:'Crew House 02',position:[5,0,-2],crew:'Science team'},
  {name:'Crew House 03',position:[-9,0,-3],crew:'Medical + Botany team'},
  {name:'Crew House 04',position:[-17,0,-3],crew:'Maintenance team'},
  {name:'Crew House 05',position:[13,0,-4],crew:'Research team'},
  {name:'Crew House 06',position:[21,0,4],crew:'Agriculture team'},
  {name:'Crew House 07',position:[-16,0,16],crew:'Engineering team'},
  {name:'Crew House 08',position:[1,0,22],crew:'Operations team'},
  {name:'Crew House 09',position:[18,0,17],crew:'Exploration team'}
 ];
 locations.forEach((data,index)=>{
  const g=new THREE.Group();g.position.set(...data.position);scene.add(g);
  const wall=mat(0x83939b,.72,.18),inside=mat(0x9eabb0,.8),floor=mat(0x39464e),dark=mat(0x253642),regolith=mat(index%2?0x9a5540:0x874a38),windowMat=new THREE.MeshStandardMaterial({color:0x7bd9e8,emissive:0x236c7d,emissiveIntensity:.65,metalness:.25,roughness:.2});
  addMesh(g,new THREE.BoxGeometry(5.1,.22,4.8),floor,0,.05,0);
  addMesh(g,new THREE.BoxGeometry(.22,2.45,4.7),wall,-2.45,1.28,0);
  addMesh(g,new THREE.BoxGeometry(.22,2.45,4.7),wall,2.45,1.28,0);
  addMesh(g,new THREE.BoxGeometry(5.1,2.45,.22),wall,0,1.28,-2.35);
  addMesh(g,new THREE.BoxGeometry(1.45,2.35,.22),wall,-1.83,1.22,2.35);
  addMesh(g,new THREE.BoxGeometry(1.45,2.35,.22),wall,1.83,1.22,2.35);
  addMesh(g,new THREE.BoxGeometry(2.25,.3,.22),wall,0,2.32,2.35);
  const roof=new THREE.Mesh(new THREE.SphereGeometry(3.25,28,16,0,Math.PI*2,0,Math.PI/2),mat(0x92513d,.98));
  roof.position.set(0,2.35,0);roof.scale.set(1,.9,.92);roof.castShadow=true;roof.receiveShadow=true;g.add(roof);
  addMesh(g,new THREE.BoxGeometry(.9,1.05,4.9),regolith,-2.85,.48,0);
  addMesh(g,new THREE.BoxGeometry(.9,1.05,4.9),regolith,2.85,.48,0);
  addMesh(g,new THREE.BoxGeometry(5.5,.75,.7),regolith,0,.36,-2.85);
  addMesh(g,new THREE.BoxGeometry(2.45,.14,.18),mat(0xffb36e,.4,.3),0,2.52,2.48);
  addMesh(g,new THREE.BoxGeometry(.12,2.2,.16),mat(0xffb36e,.4,.3),-1.18,1.15,2.48);
  addMesh(g,new THREE.BoxGeometry(.12,2.2,.16),mat(0xffb36e,.4,.3),1.18,1.15,2.48);
  addMesh(g,new THREE.BoxGeometry(1.85,2.05,.07),dark,0,1.05,2.43,false);
  addMesh(g,new THREE.BoxGeometry(.06,.85,1.45),windowMat,-2.31,1.65,-.55,false);
  addMesh(g,new THREE.BoxGeometry(.06,.85,1.45),windowMat,2.31,1.65,-.55,false);
  for(const side of [-1,1]){
   const bed=new THREE.Group();bed.position.set(side*1.35,.18,-.75);g.add(bed);
   addMesh(bed,new THREE.BoxGeometry(1.35,.35,2.05),dark,0,.25,0);
   addMesh(bed,new THREE.BoxGeometry(1.25,.18,1.8),mat(side<0?0x7f9cae:0x9b806b),0,.5,0);
   addMesh(bed,new THREE.BoxGeometry(.7,.15,.45),inside,0,.62,-.58);
  }
  addMesh(g,new THREE.BoxGeometry(1.15,.12,.8),inside,0,.9,.55);
  for(const x of [-.42,.42])addMesh(g,new THREE.CylinderGeometry(.045,.045,.85,8),dark,x,.48,.55);
  addMesh(g,new THREE.BoxGeometry(.85,.75,.55),wall,0,.55,-1.85);
  addMesh(g,new THREE.BoxGeometry(3.4,.08,.25),new THREE.MeshStandardMaterial({color:0xe6f6f4,emissive:0x87c9c6,emissiveIntensity:.8}),0,2.35,0);
  const light=new THREE.PointLight(0xb8eaff,1.25,8);light.position.set(0,2.1,0);g.add(light);
  const oxygenMetal=mat(0xaab9c2,.38,.62), oxygenDark=mat(0x263c49,.55,.35);
  for(const side of [-1,1]){
   addMesh(g,new THREE.CylinderGeometry(.17,.17,.92,14),oxygenMetal,side*.62,.72,-2.02);
   addMesh(g,new THREE.SphereGeometry(.17,14,8,0,Math.PI*2,0,Math.PI/2),mat(0x54dfe5,.35,.4),side*.62,1.18,-2.02);
   addMesh(g,new THREE.TorusGeometry(.18,.025,7,16),mat(0x59dce5,.3,.4),side*.62,.72,-2.02);
  }
  addMesh(g,new THREE.BoxGeometry(.62,.82,.18),oxygenDark,0,.92,-2.12);
  addMesh(g,new THREE.BoxGeometry(.38,.2,.035),mat(0x48e2d4,.3,.25),0,1.08,-2.225);
  for(let i=0;i<3;i++) addMesh(g,new THREE.SphereGeometry(.045,8,8),mat([0x4ee4d7,0x9de76b,0xffc15a][i],.3,.2),-.12+i*.12,.76,-2.235);
  const indoorOxygenLabel=makeTextSprite('O₂ LIFE SUPPORT');indoorOxygenLabel.position.set(0,1.62,-2.05);indoorOxygenLabel.scale.set(1.85,.34,1);g.add(indoorOxygenLabel);
  const sign=makeTextSprite(data.name+' · REGOLITH SHIELDED');sign.position.set(0,3.35,2.9);sign.scale.set(3.5,.55,1);g.add(sign);
  houses.push({...data,group:g,interiorBounds:{minX:-1.85,maxX:1.85,minZ:-1.55,maxZ:1.65}});
 });
}

function makeAlgaeBioreactor(){
 const g=new THREE.Group();g.position.set(-19,0,8);scene.add(g);
 const frame=mat(0x899da8,.38,.55),dark=mat(0x263b49,.5,.3);
 const glass=new THREE.MeshPhysicalMaterial({color:0x9ce9e0,transparent:true,opacity:.22,roughness:.08,metalness:.12,side:THREE.DoubleSide});
 const algaeMats=[mat(0x238d58,.25,.08),mat(0x75b94c,.25,.05)];
 addMesh(g,new THREE.BoxGeometry(7,.22,4.8),dark,0,.08,0);
 for(let i=0;i<4;i++){
  const x=-2.55+i*1.7;
  addMesh(g,new THREE.CylinderGeometry(.48,.48,2.8,20),glass,x,1.65,0,false);
  addMesh(g,new THREE.CylinderGeometry(.405,.405,2.45,20),algaeMats[i%2],x,1.62,0,false);
  addMesh(g,new THREE.TorusGeometry(.49,.045,8,24),frame,x,.32,0);
  addMesh(g,new THREE.TorusGeometry(.49,.045,8,24),frame,x,2.98,0);
  addMesh(g,new THREE.CylinderGeometry(.055,.055,3.15,8),mat(0x4b9eaa,.4,.4),x+.62,1.6,0);
  const bubbles=new THREE.Group();g.add(bubbles);
  for(let b=0;b<7;b++){
   const bubble=addMesh(bubbles,new THREE.SphereGeometry(.045+(b%3)*.012,8,6),mat(0xc9fff0,.15,.05),x+(b%2?-.13:.12),.55+b*.31,.18,false);
   bubble.userData.baseY=bubble.position.y;
  }
 }
 addMesh(g,new THREE.BoxGeometry(1.35,1.45,.55),dark,0,.85,-2.05);
 addMesh(g,new THREE.BoxGeometry(.9,.48,.05),new THREE.MeshStandardMaterial({color:0x153c42,emissive:0x38d68b,emissiveIntensity:.6}),0,1.05,-2.34);
 const sign=makeTextSprite('SPIRULINA + CHLORELLA BIOREACTOR');sign.position.set(0,3.75,2.5);sign.scale.set(5.5,.68,1);g.add(sign);
 const glow=new THREE.PointLight(0x54d88d,1.7,10);glow.position.set(0,2,0);g.add(glow);
}

function makeSupportFacilities(){
 makeMedicalCenter(15,-14);
 makeRecyclingCenter(-16,-14);
 makeRadiationShelter(0,-24);
 makeCrewWellnessCenter(17,14);
 makeEmergencyClinic(-25,-13);
 makeMedicalWard(26,-13);
}
function makeOpenBuilding(x,z,title,accent){
 const g=new THREE.Group();g.position.set(x,0,z);scene.add(g);
 const floor=mat(0x59636a,.85),wall=mat(0xc1cbd0,.75),dark=mat(0x263b49,.55,.2),trim=mat(accent,.4,.25);
 addMesh(g,new THREE.BoxGeometry(7,.22,6),floor,0,.05,0);
 addMesh(g,new THREE.BoxGeometry(7,3.2,.2),wall,0,1.65,-2.9);
 addMesh(g,new THREE.BoxGeometry(.2,3.2,5.8),wall,-3.4,1.65,0);
 addMesh(g,new THREE.BoxGeometry(.2,3.2,5.8),wall,3.4,1.65,0);
 addMesh(g,new THREE.BoxGeometry(7.2,.16,.22),trim,0,3.25,-2.9);
 addMesh(g,new THREE.BoxGeometry(.18,.16,6),trim,-3.4,3.25,0);
 addMesh(g,new THREE.BoxGeometry(.18,.16,6),trim,3.4,3.25,0);
 const sign=makeTextSprite(title);sign.position.set(0,3.8,3.05);sign.scale.set(4.6,.72,1);g.add(sign);
 for(const lx of [-2,0,2])addMesh(g,new THREE.BoxGeometry(.85,.07,.22),new THREE.MeshStandardMaterial({color:0xe7fbff,emissive:accent,emissiveIntensity:.45}),lx,3.05,-1.2);
 return {g,dark,trim};
}
function makeMedicalCenter(x,z){
 const {g,dark}=makeOpenBuilding(x,z,'MEDICAL CENTER',0x5bd6d0);const white=mat(0xe7edf0,.5),blue=mat(0x4e91b5,.45);
 for(const bx of [-1.8,1.35]){addMesh(g,new THREE.BoxGeometry(1.55,.22,2.35),white,bx,.72,.25);addMesh(g,new THREE.BoxGeometry(1.55,.18,.42),blue,bx,1.02,-.55);for(const dx of [-.58,.58])addMesh(g,new THREE.CylinderGeometry(.055,.055,.65,8),dark,bx+dx,.35,.25);addMesh(g,new THREE.BoxGeometry(.48,.42,.12),mat(0x153c4d),bx,.98,-1.55);}
 addMesh(g,new THREE.BoxGeometry(1.15,1.05,.16),dark,0,1.75,-2.55);addMesh(g,new THREE.BoxGeometry(.92,.62,.04),mat(0x153c4d),0,1.78,-2.44);
 addMesh(g,new THREE.BoxGeometry(.85,1.65,.65),white,-2.65,.95,-1.65);
 const cross=mat(0xe85d5d);addMesh(g,new THREE.BoxGeometry(.16,.72,.08),cross,2.65,2.05,-2.48);addMesh(g,new THREE.BoxGeometry(.72,.16,.08),cross,2.65,2.05,-2.48);
}
function makeEmergencyClinic(x,z){
 const {g,dark}=makeOpenBuilding(x,z,'EMERGENCY CLINIC',0xe66d68);const bed=mat(0xe5e9ed),blue=mat(0x4d92b4);
 addMesh(g,new THREE.BoxGeometry(2.1,.25,2.6),bed,-1,.7,0);addMesh(g,new THREE.BoxGeometry(2.1,.18,.45),blue,-1,1,-.55);
 addMesh(g,new THREE.BoxGeometry(1.15,1.4,.18),dark,2,1.1,-2.4);addMesh(g,new THREE.BoxGeometry(.9,.65,.05),mat(0x183d4a),2,1.3,-2.28);
 addMesh(g,new THREE.BoxGeometry(.8,.8,.7),mat(0xe8edf0),2,.55,.9);addMesh(g,new THREE.BoxGeometry(.16,.55,.08),mat(0xe85d5d),2,1.35,.54);addMesh(g,new THREE.BoxGeometry(.55,.16,.08),mat(0xe85d5d),2,1.35,.54);
}
function makeMedicalWard(x,z){
 const {g,dark}=makeOpenBuilding(x,z,'MEDICAL WARD',0x6baed6);const bed=mat(0xe5e9ed),blue=mat(0x4d92b4);
 for(const x of [-2,0,2]){addMesh(g,new THREE.BoxGeometry(1.25,.2,1.9),bed,x,.65,.2);addMesh(g,new THREE.BoxGeometry(1.25,.15,.35),blue,x,.9,-.25);addMesh(g,new THREE.BoxGeometry(.75,.65,.08),dark,x,1.55,-1.5);addMesh(g,new THREE.BoxGeometry(.58,.4,.04),mat(0x173b4a),x,1.58,-1.44);}
}
function makeRecyclingCenter(x,z){
 const {g,dark}=makeOpenBuilding(x,z,'RECYCLING CENTER',0x77c98a);const colors=[0x4f9bd4,0x67b979,0xd6a34f,0x9c83c9],names=['WATER','ORGANIC','METAL','PLASTIC'];
 for(let i=0;i<4;i++){const bx=-2.55+i*1.7;addMesh(g,new THREE.BoxGeometry(1.15,1.15,1.15),mat(colors[i],.55),bx,.68,.75);addMesh(g,new THREE.BoxGeometry(1.22,.12,1.22),dark,bx,1.3,.75);const tag=makeTextSprite(names[i]);tag.position.set(bx,1.65,1.4);tag.scale.set(1.15,.3,1);g.add(tag);}
 addMesh(g,new THREE.BoxGeometry(5.7,.22,.85),dark,0,.48,-1.15);for(let i=0;i<8;i++)addMesh(g,new THREE.CylinderGeometry(.09,.09,.78,10),mat(0x9daab0,.4,.4),-2.45+i*.7,.48,-1.15).rotation.z=Math.PI/2;
}
function makeRadiationShelter(x,z){
 const g=new THREE.Group();g.position.set(x,0,z);scene.add(g);const regolith=mat(0x9a624d),inner=mat(0x56636a),orange=mat(0xf0a15f,.45,.2);
 addMesh(g,new THREE.CylinderGeometry(4.2,4.2,1.1,16),regolith,0,.45,0);addMesh(g,new THREE.CylinderGeometry(3.25,3.25,.18,16),inner,0,1.05,0);
 const dome=addMesh(g,new THREE.SphereGeometry(3.25,24,12,0,Math.PI*2,0,Math.PI/2),regolith,0,1.1,0);dome.scale.y=.8;
 addMesh(g,new THREE.BoxGeometry(1.6,2.1,.22),mat(0x263b49),0,1.1,3.2);addMesh(g,new THREE.BoxGeometry(1.1,1.7,.08),mat(0x5a8290),0,1.1,3.34);
 for(const sx of [-1.7,1.7]){addMesh(g,new THREE.BoxGeometry(1.25,.18,2.1),mat(0xc5d0d2),sx,1.2,.25);addMesh(g,new THREE.BoxGeometry(1.25,.55,.16),orange,sx,1.48,-.72);for(const dx of [-.48,.48])addMesh(g,new THREE.CylinderGeometry(.045,.045,.55,8),inner,sx+dx,.88,.25);}
 addMesh(g,new THREE.BoxGeometry(1.25,.95,.18),inner,0,1.75,-2.75);const sign=makeTextSprite('RADIATION SAFE SHELTER');sign.position.set(0,3.7,3.65);sign.scale.set(4.7,.65,1);g.add(sign);
}
function makeCrewWellnessCenter(x,z){
 const {g,dark}=makeOpenBuilding(x,z,'CREW WELLNESS',0xe6b96c);const seat=mat(0x557d83),plantMat=mat(0x4b9c5b),pot=mat(0x9b6d52);
 for(const sx of [-1.8,1.8]){addMesh(g,new THREE.BoxGeometry(1.55,.35,.8),seat,sx,.48,-.25);addMesh(g,new THREE.BoxGeometry(1.55,.65,.18),seat,sx,.82,-.62);}
 addMesh(g,new THREE.CylinderGeometry(.65,.72,.18,16),mat(0xc9b48c),0,.62,.1);
 for(const px of [-2.65,2.65]){addMesh(g,new THREE.CylinderGeometry(.28,.34,.42,10),pot,px,.28,1.85);for(let i=0;i<5;i++){const leaf=addMesh(g,new THREE.SphereGeometry(.22,8,6),plantMat,px+Math.cos(i*1.25)*.2,.75+(i%2)*.12,1.85+Math.sin(i*1.25)*.2);leaf.scale.set(.65,1.5,.65);}}
 addMesh(g,new THREE.BoxGeometry(1.7,1.05,.14),dark,0,2.1,-2.65);addMesh(g,new THREE.BoxGeometry(1.42,.78,.05),mat(0x284f58),0,2.1,-2.55);
}

function makeColonyExpansion(){
 const metal=mat(0x9baab2,.45,.5),dark=mat(0x354650,.55,.35),glass=new THREE.MeshPhysicalMaterial({color:0x8ddbd4,transparent:true,opacity:.17,roughness:.12,side:THREE.DoubleSide});
 let domeNumber=1;
 for(const [x,z] of [[-27,8],[8,27]]){
  const dome=new THREE.Group();dome.position.set(x,0,z);scene.add(dome);
  farms.push({name:'Hydroponic Food Dome '+(++domeNumber),center:[x,z],rows:[-2.2,0,2.2],columns:6,xStart:-2.7,xStep:1.08,plants:[]});
  addMesh(dome,new THREE.CylinderGeometry(4.3,4.3,.25,24),dark,0,.15,0);
  const shell=new THREE.Mesh(new THREE.SphereGeometry(4.3,24,16,0,Math.PI*2,0,Math.PI/2),glass);shell.position.y=.25;shell.scale.y=.72;dome.add(shell);
  for(let row=0;row<3;row++){
   addMesh(dome,new THREE.BoxGeometry(6.8,.32,.85),mat(0x314a3e),0,.55,-2.2+row*2.1);
   for(let n=0;n<12;n++){const x0=-3+n*.54;const plant=new THREE.Group();plant.position.set(x0,.78,-2.2+row*2.1);dome.add(plant);for(let l=0;l<5;l++){const leaf=addMesh(plant,new THREE.SphereGeometry(.17,7,5),mat([0x4b9b4e,0x75bd5c,0x327b40][l%3]),Math.cos(l*1.25)*.13,.18+(l%2)*.07,Math.sin(l*1.25)*.13);leaf.scale.set(.7,.25,1.2);}}
  }
  const label=makeTextSprite('FOOD GROWTH DOME');label.position.set(0,4.1,4.2);label.scale.set(3.6,.55,1);dome.add(label);
 }
 for(let i=0;i<6;i++){
  const x=24+(i%3)*2.1,z=7+Math.floor(i/3)*2.4;
  addMesh(scene,new THREE.CylinderGeometry(.72,.72,2.6,16),metal,x,1.3,z);
  addMesh(scene,new THREE.SphereGeometry(.72,16,8,0,Math.PI*2,0,Math.PI/2),mat(0x718c9c,.35,.5),x,2.6,z);
  addMesh(scene,new THREE.TorusGeometry(.74,.06,8,20),mat(0x52cbd1,.35,.45),x,.6,z);
 }
 for(let row=0;row<4;row++)for(let col=0;col<7;col++){
  const x=-3+col*1.7,z=31+row*2.6;
  const panel=addMesh(scene,new THREE.BoxGeometry(1.4,.09,2.15),mat(0x173e68,.28,.62),x,1.05,z);panel.rotation.x=-.24;
  addMesh(scene,new THREE.CylinderGeometry(.055,.07,.9,8),metal,x,.52,z);
 }
 addMesh(scene,new THREE.CylinderGeometry(7.2,7.2,.24,48),mat(0x626a70,.8,.15),-34,.05,-24);
 addMesh(scene,new THREE.TorusGeometry(6.2,.13,10,48),mat(0xf0b66e,.45,.25),-34,.2,-24);
 addMesh(scene,new THREE.BoxGeometry(3.5,.12,.5),mat(0xf0b66e),-34,.22,-24);
 addMesh(scene,new THREE.BoxGeometry(.5,.12,3.5),mat(0xf0b66e),-34,.22,-24);
 addMesh(scene,new THREE.CylinderGeometry(.18,.25,5,12),metal,-27,.1,-24);addMesh(scene,new THREE.SphereGeometry(.28,12,8),mat(0xffb55d),-27,2.7,-24);
 const beaconLight=new THREE.PointLight(0xffa75c,2.5,12);beaconLight.position.set(-27,3,-24);scene.add(beaconLight);
 
 roverRef=new THREE.Group();roverRef.position.set(27,0,-23);scene.add(roverRef);
 addMesh(roverRef,new THREE.BoxGeometry(3.4,.85,2.1),mat(0xb7c4cb,.45,.45),0,1,0);
 addMesh(roverRef,new THREE.BoxGeometry(1.4,.55,1.1),mat(0x526b79,.3,.4),0,1.62,-.15);
 for(const sx of [-1,1])for(const sz of [-.8,.8]){const wheel=addMesh(roverRef,new THREE.CylinderGeometry(.48,.48,.28,16),dark,sx*1.55,.55,sz);wheel.rotation.z=Math.PI/2;}
 addMesh(roverRef,new THREE.CylinderGeometry(.07,.07,1.6,8),metal,1.1,2,0);addMesh(roverRef,new THREE.SphereGeometry(.3,12,8),mat(0x6fc4d4,.3,.5),1.1,2.9,0);

 const roadMat=mat(0x6d5148,.95),lineMat=mat(0xd6a47b,.8);
 addMesh(scene,new THREE.BoxGeometry(76,.06,3.2),roadMat,0,.015,0,false);
 addMesh(scene,new THREE.BoxGeometry(3.2,.06,70),roadMat,0,.02,0,false);
 for(let x=-35;x<=35;x+=4)addMesh(scene,new THREE.BoxGeometry(1.5,.025,.12),lineMat,x,.06,0,false);
 for(let z=-32;z<=32;z+=4)addMesh(scene,new THREE.BoxGeometry(.12,.025,1.5),lineMat,0,.065,z,false);
 for(let i=0;i<18;i++){
  const x=-34+i*4,z=(i%2?2.5:-2.5);
  addMesh(scene,new THREE.CylinderGeometry(.055,.08,3.2,8),metal,x,1.6,z);
  addMesh(scene,new THREE.SphereGeometry(.19,10,8),new THREE.MeshStandardMaterial({color:0xffe3b2,emissive:0xffb56b,emissiveIntensity:1.2}),x,3.25,z);
 }
 for(let i=0;i<24;i++){
  const x=-30+(i*13%59),z=-18+(i*17%51);
  if(Math.abs(x)<6&&Math.abs(z)<6)continue;
  addMesh(scene,new THREE.BoxGeometry(1.1,1.0,.9),mat(i%2?0x687b83:0x9c765d,.65,.2),x,.5,z);
  addMesh(scene,new THREE.BoxGeometry(1.18,.09,.98),mat(0xe1a36a,.5,.2),x,1.03,z);
 }
 for(let i=0;i<5;i++){
  const x=-28+i*14,z=-34+(i%2)*4;
  const pod=new THREE.Group();pod.position.set(x,0,z);scene.add(pod);
  addMesh(pod,new THREE.CylinderGeometry(1.8,1.8,2.5,16),mat(0x9eabb3,.5,.35),0,1.25,0).rotation.z=Math.PI/2;
  for(let r=0;r<3;r++){const ring=addMesh(pod,new THREE.TorusGeometry(1.82,.05,8,24),mat(0xe6a36c,.4,.3),-0.8+r*.8,1.25,0);ring.rotation.y=Math.PI/2;}
  addMesh(pod,new THREE.BoxGeometry(1.0,1.8,.12),dark,0,.9,1.8);
 }
}

function makeCropPlant(type,position){
 const group=new THREE.Group();group.position.copy(position);const stemMat=mat(0x397b45),leafMats=[mat(0x4eaa55),mat(0x79c96b),mat(0x2f8247)];
 addMesh(group,new THREE.CylinderGeometry(.035,.055,.72,7),stemMat,0,.38,0);
 const leafCount=type==='wheat'?7:6;
 for(let i=0;i<leafCount;i++){
  const a=i*Math.PI*2/leafCount;const leaf=addMesh(group,new THREE.SphereGeometry(.22,8,6),leafMats[i%3],Math.cos(a)*.2,.28+(i%3)*.12,Math.sin(a)*.2);leaf.scale.set(.55,.22,1.45);leaf.rotation.y=-a;leaf.rotation.z=(i%2?-.35:.35);
 }
 if(type==='tomato'){
  for(let i=0;i<3;i++){const fruit=addMesh(group,new THREE.SphereGeometry(.14,12,10),mat(0xd94b38),Math.cos(i*2.1)*.24,.48+(i%2)*.22,Math.sin(i*2.1)*.24);fruit.scale.set(1,1,.95);}
 } else if(type==='potato'){
  for(let i=0;i<3;i++){const tuber=addMesh(group,new THREE.SphereGeometry(.16,10,8),mat(0xb88a55),Math.cos(i*2.1)*.22,.12,Math.sin(i*2.1)*.22);tuber.scale.set(1.25,.72,.9);}
 } else if(type==='wheat'){
  for(let i=0;i<4;i++){const head=addMesh(group,new THREE.ConeGeometry(.07,.32,6),mat(0xd9b45c),Math.cos(i*1.57)*.12,1.02,Math.sin(i*1.57)*.12);head.rotation.z=.15;}
 }
 return group;
}
function plantCrop(type){
 if(!activeStation||activeStation.id!=='food')return;
 if(resources.water<3||resources.energy<3){notify('Not enough water or energy to plant. Choose a resource strategy first.');return;}
 const labels={tomato:'Tomato',potato:'Potato',lettuce:'Lettuce',wheat:'Dwarf wheat',kale:'Kale'};
 const farm=farms[activeStation.farmIndex??0];
 if(!farm)return;
 const index=farm.plants.length;
 const capacity=farm.rows.length*farm.columns;
 if(index>=capacity){notify('This greenhouse is full. Choose another growing dome.');return;}
 const row=Math.floor(index/farm.columns),slot=index%farm.columns;
 const x=farm.xStart+slot*farm.xStep,z=farm.rows[row];
 const plant=makeCropPlant(type,new THREE.Vector3(farm.center[0]+x,.78,farm.center[1]+z));
 plant.scale.setScalar(.08);plant.userData.growStart=clock.elapsedTime;scene.add(plant);
 farm.plants.push(plant);allCropPlants.push(plant);
 resources.water=Math.max(0,resources.water-3);resources.energy=Math.max(0,resources.energy-2);foodSupply=Math.min(100,foodSupply+2);updateResourceUI();
 if(activeStation.farmIndex===0)greenhouse.plants.push(plant);
 $('plant-count').textContent=farm.plants.length+' / '+capacity+' plants placed in '+farm.name;
 $('food-supply-label').textContent='Food reserve: '+Math.round(foodSupply)+' units';
 notify(labels[type]+' planted. −3 water, −2 energy; food reserve +2.');
}

function makeSolarArray(){
 for(let i=0;i<4;i++){const x=12+i*1.65;const panel=addMesh(scene,new THREE.BoxGeometry(1.35,.08,3),mat(0x1d4567,.3,.55),x,.8,0);panel.rotation.x=-.18;addMesh(scene,new THREE.CylinderGeometry(.06,.08,1,8),mat(0x9caab4),x,.35,0);}
}
function makeAstronaut(parent){
 const suit=mat(0xe8edf0,.6),dark=mat(0x263847,.5),gold=mat(0xffa65e,.35,.3),visor=new THREE.MeshStandardMaterial({color:0x173447,metalness:.7,roughness:.18});
 const body=new THREE.Group();parent.add(body);
 addMesh(body,new THREE.CylinderGeometry(.34,.4,.85,12),suit,0,1.05,0);
 addMesh(body,new THREE.SphereGeometry(.31,16,12),suit,0,1.72,0);
 addMesh(body,new THREE.SphereGeometry(.245,16,12),visor,0,1.74,.12);
 addMesh(body,new THREE.BoxGeometry(.55,.55,.25),dark,0,1.05,-.28);
 addMesh(body,new THREE.BoxGeometry(.12,.62,.025),gold,0,1.1,.205);
 for(const side of [-1,1]){
  const arm=addMesh(body,new THREE.CylinderGeometry(.11,.13,.68,10),suit,side*.48,1.12,0);arm.rotation.z=side*-.18;
  addMesh(body,new THREE.SphereGeometry(.13,10,8),dark,side*.5,.78,0);
  const leg=addMesh(body,new THREE.CylinderGeometry(.14,.16,.65,10),suit,side*.19,.38,0);
  addMesh(body,new THREE.BoxGeometry(.28,.16,.42),dark,side*.19,.08,.06);
 }
}
function makeStation(s){
 const g=new THREE.Group();g.position.set(...s.position);scene.add(g);s.group=g;
 addMesh(g,new THREE.CylinderGeometry(1.1,1.3,.35,12),mat(0x3c4148),0,.1,0);
 addMesh(g,new THREE.BoxGeometry(1.35,1.5,1.1),mat(0x344858,.45,.25),0,1,0);
 addMesh(g,new THREE.BoxGeometry(1.38,.16,1.13),mat(s.color,.35,.2),0,1.15,.01);
 addMesh(g,new THREE.SphereGeometry(.42,16,12),new THREE.MeshStandardMaterial({color:s.color,emissive:s.color,emissiveIntensity:.35}),0,2,0);
 addMesh(g,new THREE.CylinderGeometry(.05,.05,.45,8),mat(0xcbd5df),0,2.45,0);
 const ring=addMesh(g,new THREE.TorusGeometry(.65,.045,8,24),mat(s.color,.3,.5),0,2.8,0);ring.rotation.x=Math.PI/2;
 const label=makeTextSprite(s.name);label.position.set(0,3.35,0);g.add(label);
 if(s.id==='oxygen'){
  const steel=mat(0x9aa9b5,.35,.7), darkSteel=mat(0x263744,.55,.45), white=mat(0xdce5e9,.45,.25);
  for(const side of [-1,1]){
   addMesh(g,new THREE.CylinderGeometry(.38,.38,2.15,16),white,side*1.45,1.12,-.12);
   addMesh(g,new THREE.SphereGeometry(.38,16,8,0,Math.PI*2,0,Math.PI/2),steel,side*1.45,2.2,-.12);
   addMesh(g,new THREE.SphereGeometry(.38,16,8,0,Math.PI*2,Math.PI/2,Math.PI/2),steel,side*1.45,.05,-.12);
   const band=addMesh(g,new THREE.TorusGeometry(.39,.045,8,20),mat(side<0?0x53dce4:0x9ce5ee,.35,.4),side*1.45,1.15,-.12);band.rotation.x=Math.PI/2;
   addMesh(g,new THREE.CylinderGeometry(.09,.09,.3,10),darkSteel,side*1.45,2.42,-.12);
  }
  const pipe1=addMesh(g,new THREE.CylinderGeometry(.075,.075,1.9,10),steel,-.78,1.65,-.72);pipe1.rotation.z=Math.PI/2;
  const pipe2=addMesh(g,new THREE.CylinderGeometry(.075,.075,1.9,10),steel,.78,1.35,-.72);pipe2.rotation.z=Math.PI/2;
  addMesh(g,new THREE.BoxGeometry(.82,1.15,.48),darkSteel,0,.82,-1.02);
  addMesh(g,new THREE.BoxGeometry(.58,.28,.04),mat(0x4ee4d7,.3,.3),0,1.05,-1.28);
  for(let i=0;i<3;i++) addMesh(g,new THREE.SphereGeometry(.055,8,8),mat([0x4ee4d7,0x9de76b,0xffc15a][i],.3,.2),-.18+i*.18,.65,-1.29);
  const moxie=makeTextSprite('MOXIE · CO₂ TO O₂');moxie.position.set(0,4.05,0);moxie.scale.set(3.8,.72,1);g.add(moxie);
 }
 s.light=new THREE.PointLight(s.color,2.2,7);s.light.position.set(0,2,0);g.add(s.light);
}
function makeTextSprite(text){
 const c=document.createElement('canvas');c.width=512;c.height=96;const ctx=c.getContext('2d');
 ctx.fillStyle='rgba(7,15,25,.82)';ctx.fillRect(0,0,512,96);ctx.strokeStyle='#ffffff55';ctx.strokeRect(2,2,508,92);
 ctx.font='bold 30px Arial';ctx.fillStyle='white';ctx.textAlign='center';ctx.fillText(text.toUpperCase(),256,60);
 const tex=new THREE.CanvasTexture(c);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true}));sprite.scale.set(3.2,.6,1);return sprite;
}
const dust=[];
function makeDust(){
  const geo=new THREE.BufferGeometry();
  const count = 1400;
  const arr=new Float32Array(count*3);
  for(let i=0;i<count;i++){arr[i*3]=(Math.random()-.5)*75;arr[i*3+1]=Math.random()*14;arr[i*3+2]=(Math.random()-.5)*75;}
  geo.setAttribute('position',new THREE.BufferAttribute(arr,3));
  const points=new THREE.Points(geo,new THREE.PointsMaterial({color:0xf3b18b,size:.085,transparent:true,opacity:.5}));
  scene.add(points);dust.push(points);
}
function setupMobileControls(){
  if(!isTouchDevice)return;
  const stick=$('mobile-stick'), knob=$('mobile-stick-knob'), canvas=renderer.domElement;
  let stickPointer=null;
  const updateStick=(e)=>{
    const rect=stick.getBoundingClientRect();
    const cx=rect.left+rect.width/2, cy=rect.top+rect.height/2;
    const max=rect.width*.34;
    let dx=e.clientX-cx, dy=e.clientY-cy;
    const len=Math.hypot(dx,dy); if(len>max){dx=dx/len*max;dy=dy/len*max;}
    knob.style.transform=`translate(${dx}px,${dy}px)`;
    mobileMoveX=dx/max; mobileMoveY=-dy/max;
  };
  stick.addEventListener('pointerdown',e=>{e.preventDefault();stickPointer=e.pointerId;stick.setPointerCapture(e.pointerId);updateStick(e);});
  stick.addEventListener('pointermove',e=>{if(e.pointerId===stickPointer){e.preventDefault();updateStick(e);}});
  const releaseStick=e=>{if(e.pointerId===stickPointer){stickPointer=null;mobileMoveX=0;mobileMoveY=0;knob.style.transform='translate(0,0)';}};
  stick.addEventListener('pointerup',releaseStick);stick.addEventListener('pointercancel',releaseStick);
  canvas.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch'||!started||!$('mobile-controls')||$('mobile-controls').classList.contains('hidden'))return;if(e.clientX<innerWidth*.38||e.clientY>innerHeight*.86)return;lookPointerId=e.pointerId;lastLookX=e.clientX;lastLookY=e.clientY;canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(e.pointerId!==lookPointerId)return;const dx=e.clientX-lastLookX,dy=e.clientY-lastLookY;lastLookX=e.clientX;lastLookY=e.clientY;yaw-=dx*.004; pitch=Math.max(-.65,Math.min(.65,pitch-dy*.003));});
  const endLook=e=>{if(e.pointerId===lookPointerId)lookPointerId=null;};canvas.addEventListener('pointerup',endLook);canvas.addEventListener('pointercancel',endLook);
  const bindHold=(id,down,up=()=>{})=>{const el=$(id);el.addEventListener('pointerdown',e=>{e.preventDefault();down();});['pointerup','pointercancel','pointerleave'].forEach(type=>el.addEventListener(type,e=>{e.preventDefault();up();}));};
  bindHold('mobile-run',()=>{mobileRun=true;$('mobile-run').classList.add('active');},()=>{mobileRun=false;$('mobile-run').classList.remove('active');});
  $('mobile-jump').addEventListener('pointerdown',e=>{e.preventDefault();if(started&&!activeStation&&!photoMode&&isGrounded&&!currentHouse&&stamina>10){velocityY=JUMP_FORCE;isGrounded=false;stamina=Math.max(0,stamina-12);playBreathSound(true);}});
  $('mobile-use').addEventListener('pointerdown',e=>{e.preventDefault();mobileInteract();});
  $('mobile-flash').addEventListener('pointerdown',e=>{e.preventDefault();if(!started||activeStation)return;flashlightOn=!flashlightOn;flashlight.visible=flashlightOn;$('mobile-flash').classList.toggle('active',flashlightOn);notify(flashlightOn?'Helmet Flashlight ON':'Helmet Flashlight OFF');});
}
function mobileInteract(){
  if(activeStation){toggleStationReference();return;}
  if(currentHouse){leaveHouse();return;}
  if(nearby){if(nearby.type==='house')enterHouse(nearby);else openStation(nearby);return;}
  notify('Move closer to a station to interact.');
}

function startGame(){
 started=true;missionDay=0;foodSupply=55;activated.clear();deferredEffects.length=0;
 initAmbientAudio();
 const scenarios=[
  {name:'Dusty Solar Panels',description:'Dust reduces solar collection. Energy starts lower; cleaning panels will use water.',start:{oxygen:82,water:74,energy:62}},
  {name:'Water Filter Maintenance',description:'The recovery filters need attention. Water starts lower; intensive recovery will use extra power.',start:{oxygen:82,water:56,energy:88}},
  {name:'Cold Night Cycle',description:'Heating and life support need extra power. Energy starts lower and oxygen demand is higher.',start:{oxygen:76,water:74,energy:60}},
  {name:'Stable Arrival Conditions',description:'The colony begins with balanced supplies and no special starting penalty.',start:{oxygen:82,water:74,energy:90}}
 ];
 missionScenario=scenarios[Math.floor(Math.random()*scenarios.length)];
 Object.assign(resources,missionScenario.start);
 $('scenario-label').textContent='SCENARIO: '+missionScenario.name+' — '+missionScenario.description;
 $('food-supply-label').textContent='Food reserve: '+foodSupply+' units';
 updateResourceUI();updateMission();
 ui.start.classList.add('hidden');ui.hud.classList.remove('hidden');ui.mission.classList.remove('hidden');ui.location.classList.remove('hidden');ui.controls.classList.remove('hidden');if(isTouchDevice)$('mobile-controls').classList.remove('hidden');else renderer.domElement.requestPointerLock();
 notify('Mission started! [F] Flashlight · [R] Wipe Visor · [P] Photo Mode');
}
function openHelp(){ui.help.classList.remove('hidden');document.exitPointerLock();}
function openSources(){$('sources-modal').classList.remove('hidden');document.exitPointerLock();}
function openLearning(){document.exitPointerLock();$('learning-modal').classList.remove('hidden');}
function closeLearning(){$('learning-modal').classList.add('hidden');if(started&&!activeStation&&ui.help.classList.contains('hidden')&&ui.win.classList.contains('hidden')&&!isTouchDevice)renderer.domElement.requestPointerLock();}
function closeSources(){$('sources-modal').classList.add('hidden');if(started&&ui.station.classList.contains('hidden')&&ui.help.classList.contains('hidden')&&ui.win.classList.contains('hidden')&&!isTouchDevice)renderer.domElement.requestPointerLock();}
function closeHelp(){ui.help.classList.add('hidden');if(started&&!activeStation&&ui.win.classList.contains('hidden')&&!isTouchDevice)renderer.domElement.requestPointerLock();}

function togglePhotoMode(){
  photoMode = !photoMode;
  const hudEls = [ui.hud, ui.mission, ui.location, ui.controls, $('stamina-hud'), $('helmet-visor-frame'), visorDustEl, suitGlitchEl];
  hudEls.forEach(el => {
    if(el) el.style.opacity = photoMode ? '0' : '1';
  });
  photoBanner.classList.toggle('hidden', !photoMode);

  if(photoMode){
    photoCamPos.copy(camera.position);
    ui.prompt.classList.add('hidden');
  } else {
    camera.position.set(player.position.x, player.position.y + 2.15, player.position.z);
  }
}

function wipeVisor(){
  if(visorDustLevel <= 0.02){
    notify('Visor is already clean.');
    return;
  }
  visorDustLevel = 0;
  visorDustEl.style.opacity = '0';
  $('dust-val').textContent = '0%';
  playWipeSound();
  notify('Visor wiped clean!');
}

function onKeyDown(e){
  if(e.code==='Escape'){
    if(photoMode){togglePhotoMode();return;}
    if(!$('sources-modal').classList.contains('hidden')){closeSources();return;}
    if(!$('learning-modal').classList.contains('hidden')){closeLearning();return;}
    if(!ui.help.classList.contains('hidden')){closeHelp();return;}
    if(!ui.station.classList.contains('hidden')){closeStation();return;}
    document.exitPointerLock();
  }
  if(e.repeat)return;
  keys[e.code]=true;

  if(e.code==='KeyP' && started && !activeStation && ui.help.classList.contains('hidden')){
    togglePhotoMode();
    return;
  }

  if(e.code==='KeyR' && started && !activeStation && !photoMode){
    wipeVisor();
    return;
  }

  if(e.code==='KeyF' && started && !activeStation){
    flashlightOn = !flashlightOn;
    flashlight.visible = flashlightOn;
    notify(flashlightOn ? 'Helmet Flashlight ON' : 'Helmet Flashlight OFF');
  }

  if(e.code==='Space' && started && !activeStation && !photoMode && isGrounded && !currentHouse && stamina > 10){
    velocityY = JUMP_FORCE;
    isGrounded = false;
    stamina = Math.max(0, stamina - 12);
    playBreathSound(true);
  }
  if(e.code==='KeyE'&&started&&!photoMode&&currentHouse){leaveHouse();return;}
  if(e.code==='KeyE'&&started&&!photoMode&&!activeStation&&nearby){if(nearby.type==='house')enterHouse(nearby);else openStation(nearby);return;}
  if(e.code==='KeyE'&&activeStation){toggleStationReference();}
}
function onResize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);}

function updatePhotoCamera(dt){
  const forward=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw));
  const right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
  const move=new THREE.Vector3();
  if(keys.KeyW||keys.ArrowUp)move.add(forward);
  if(keys.KeyS||keys.ArrowDown)move.sub(forward);
  if(keys.KeyD||keys.ArrowRight)move.add(right);
  if(keys.KeyA||keys.ArrowLeft)move.sub(right);
  if(keys.Space)move.y += 1;
  if(keys.ShiftLeft)move.y -= 1;

  if(move.lengthSq() > 0){
    move.normalize().multiplyScalar(11 * dt);
    photoCamPos.add(move);
  }
  camera.position.copy(photoCamPos);
  camera.rotation.order='YXZ';
  camera.rotation.y=yaw;
  camera.rotation.x=pitch;
}

function updatePlayer(dt){
 if(!started||activeStation)return;
 if(photoMode){
   updatePhotoCamera(dt);
   return;
 }

 const forward=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw));
 const right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
 const move=new THREE.Vector3();
 if(keys.KeyW||keys.ArrowUp)move.add(forward);
 if(keys.KeyS||keys.ArrowDown)move.sub(forward);
 if(keys.KeyD||keys.ArrowRight)move.add(right);
 if(keys.KeyA||keys.ArrowLeft)move.sub(right);
 if(isTouchDevice && (mobileMoveX || mobileMoveY)){move.addScaledVector(right,mobileMoveX);move.addScaledVector(forward,-mobileMoveY);}

 const isMoving = move.lengthSq() > 0;
 const isRunning = (keys.ShiftLeft || mobileRun) && isMoving && stamina > 5;

 if(isRunning){
  stamina = Math.max(0, stamina - dt * 22);
 } else if(!(keys.ShiftLeft || mobileRun) && stamina < 100){
  stamina = Math.min(100, stamina + dt * 14);
 }

 $('stamina-bar').style.width = stamina + '%';
 $('stamina-val').textContent = Math.round(stamina) + '%';
 
 // التحقق من انخفاض الموارد لتفعيل التشويش والإنذار (Suit Glitch)
 const minRes = Math.min(resources.oxygen, resources.water, resources.energy);
 if(minRes < 20){
   suitGlitchEl.style.opacity = (Math.random() * 0.4 + 0.2).toFixed(2);
   $('hr-val').textContent = '145 [CRITICAL]';
 } else {
   suitGlitchEl.style.opacity = '0';
   $('hr-val').textContent = isRunning ? '138' : (isMoving ? '102' : '74');
 }

 if(isMoving){
  const speed = isRunning ? 7.5 : 4.2;
  move.normalize().multiplyScalar(speed * dt);
  player.position.add(move);

  bobTimer += dt * (isRunning ? 12 : 7.5);
  if(clock.elapsedTime - lastBreathTime > (isRunning ? 1.6 : 3.0)){
    playBreathSound(isRunning);
    lastBreathTime = clock.elapsedTime;
  }

  if(currentHouse){const b=currentHouse.interiorBounds;player.position.x=THREE.MathUtils.clamp(player.position.x,currentHouse.position[0]+b.minX,currentHouse.position[0]+b.maxX);player.position.z=THREE.MathUtils.clamp(player.position.z,currentHouse.position[2]+b.minZ,currentHouse.position[2]+b.maxZ);}
  else {player.position.x=THREE.MathUtils.clamp(player.position.x,-24,24);player.position.z=THREE.MathUtils.clamp(player.position.z,-24,32);}
 } else {
  bobTimer = 0;
 }

 if(!isGrounded || player.position.y > 0){
  velocityY += MARS_GRAVITY * dt;
  player.position.y += velocityY * dt;
  if(player.position.y <= 0){
    player.position.y = 0;
    velocityY = 0;
    isGrounded = true;
  }
 }

 player.rotation.y=yaw;
 const bobOffsetY = (isMoving && isGrounded) ? Math.sin(bobTimer) * 0.055 : 0;
 const bobOffsetX = (isMoving && isGrounded) ? Math.cos(bobTimer * 0.5) * 0.03 : 0;

 camera.position.set(
   player.position.x + bobOffsetX,
   player.position.y + 2.15 + bobOffsetY,
   player.position.z
 );
 camera.rotation.order='YXZ';camera.rotation.y=yaw;camera.rotation.x=pitch;
}

function updateEnvironmentAndWeather(dt){
  if(!started || photoMode) return;
  
  dayTime += dt * 0.05;
  const sunAngle = dayTime % (Math.PI * 2);
  const sunX = Math.cos(sunAngle) * 55;
  const sunY = Math.sin(sunAngle) * 45;
  if(sunSphere){
    sunSphere.position.set(sunX, Math.max(-10, sunY), -45);
    sunGlow.position.copy(sunSphere.position);
    sunLight.position.copy(sunSphere.position);
  }

  if(sunY < 0){
    sunLight.intensity = Math.max(0.1, 3.1 + sunY * 0.1);
    scene.background.setHex(0x351f1a);
  } else {
    sunLight.intensity = 3.1;
    scene.background.setHex(0x9b5945);
  }

  stormTimer -= dt;
  if(stormTimer <= 0){
    dustStormActive = !dustStormActive;
    stormTimer = dustStormActive ? (14 + Math.random()*10) : (28 + Math.random()*20);
    if(dustStormActive){
      notify('⚠️ WARNING: Martian dust storm! Press [R] to wipe visor.');
    } else {
      notify('Dust storm clearing.');
    }
  }

  const targetIntensity = dustStormActive ? 1 : 0;
  stormIntensity = THREE.MathUtils.lerp(stormIntensity, targetIntensity, dt * 0.6);

  // عدم تراكم الغبار عند التواجد داخل المباني المحمية
  if(!currentHouse && visorDustLevel < 1){
    const dustRate = dustStormActive ? 0.045 : 0.004;
    visorDustLevel = Math.min(1, visorDustLevel + dt * dustRate);
    visorDustEl.style.opacity = (visorDustLevel * 0.85).toFixed(2);
    $('dust-val').textContent = Math.round(visorDustLevel * 100) + '%';
  }

  if(scene.fog){
    scene.fog.density = 0.014 + stormIntensity * 0.032;
  }
  
  // فلترة الصوت عند الدخول للمباني (Spatial Acoustics)
  if(windGainNode && windFilterNode && soundOn){
    const targetGain = currentHouse ? 0.003 : (0.015 + stormIntensity * 0.075);
    const targetFreq = currentHouse ? 120 : 320;
    windGainNode.gain.value = THREE.MathUtils.lerp(windGainNode.gain.value, targetGain, dt * 2);
    windFilterNode.frequency.value = THREE.MathUtils.lerp(windFilterNode.frequency.value, targetFreq, dt * 2);
  }

  if(dustStormActive && !activeStation && resources.energy > 5){
    resources.energy = Math.max(0, resources.energy - dt * 0.35);
    updateResourceUI();
  }

  if(roverRef){
    const roverTime = clock.elapsedTime * 0.3;
    roverRef.position.x = 27 + Math.cos(roverTime) * 8;
    roverRef.position.z = -23 + Math.sin(roverTime) * 5;
    roverRef.rotation.y = -roverTime;
  }
}

function findNearby(){
 if(photoMode) return;
 nearby=null;let min=6.5;
 if(currentHouse){
  const d=Math.hypot(player.position.x-currentHouse.position[0],player.position.z-(currentHouse.position[2]+2.05));
  if(d<2.5)nearby={...currentHouse,type:'exit'};
  ui.prompt.classList.toggle('hidden',!nearby||!!activeStation);
  if(nearby)ui.prompt.innerHTML='PRESS <b>E</b> TO EXIT HOUSE';
  ui.location.textContent='INSIDE · '+currentHouse.name.toUpperCase();
  return;
 }
 for(const h of houses){const d=Math.hypot(player.position.x-h.position[0],player.position.z-(h.position[2]+2.65));if(d<min){min=d;nearby={...h,type:'house'};}}
 for(const s of stations){const d=Math.hypot(player.position.x-s.position[0],player.position.z-s.position[2]);if(d<min){min=d;nearby=s;}}
 for(let i=1;i<farms.length;i++){const f=farms[i],d=Math.hypot(player.position.x-f.center[0],player.position.z-f.center[1]);if(d<min){min=d;nearby={id:'food',name:f.name,category:'FOOD PRODUCTION',position:[f.center[0],0,f.center[1]],desc:'Choose crops and plant them in this hydroponic growing dome. The growing rows are a visual prototype of controlled-environment food production.',info:'Growing rows: 3 · Crops: tomato · potato · lettuce · dwarf wheat · kale',farmIndex:i,type:'farm'};}}
 ui.prompt.classList.toggle('hidden',!nearby||!!activeStation);
 if(nearby&&!activeStation){ui.location.textContent=(nearby.type==='house'?'CREW RESIDENCE · ':'NEARBY · ')+nearby.name.toUpperCase();ui.prompt.innerHTML=nearby.type==='house'?'PRESS <b>E</b> TO ENTER HOUSE':'PRESS <b>E</b> TO INTERACT';}
 else if(!nearby&&!activeStation){ui.location.textContent=dustStormActive ? 'MARS · DUST STORM ALERT' : 'MARS · HABITAT ZONE';}
}
function enterHouse(h){
 currentHouse=h;player.position.set(h.position[0],0,h.position[2]+1.25);yaw=Math.PI;pitch=0;
 ui.location.textContent='INSIDE · '+h.name.toUpperCase();
 notify('Entered '+h.name+'. Regolith shielding active & acoustic echo engaged.');
}
function leaveHouse(){
 const h=currentHouse;player.position.set(h.position[0],0,h.position[2]+3.5);currentHouse=null;yaw=0;pitch=0;
 ui.location.textContent='MARS · HABITAT ZONE';
 notify('You stepped outside onto the Martian surface.');
}
function openStation(s){
 activeStation=s;referenceVisible=false;ui.station.classList.remove('hidden');
 $('station-category').textContent=s.category;$('station-title').textContent=s.name;
 $('station-description').textContent=s.desc;$('station-info').textContent=s.info;
 $('activate-btn').classList.add('hidden');
 renderDecisionChoices(s);
 $('farm-controls').classList.toggle('hidden',s.id!=='food');
 if(s.id==='food'){activeStation.farmIndex=s.farmIndex??0;const f=farms[activeStation.farmIndex];$('plant-count').textContent=(f?.plants.length??0)+' / '+((f?.rows.length??0)*(f?.columns??0))+' plants placed in '+(f?.name??'greenhouse');}
 renderStationReferences(s.id);
 $('station-reference').classList.add('hidden');
 document.exitPointerLock();
}
const strategyChoices={
 oxygen:[
  {name:'Full oxygen production',cost:'Oxygen +20 · Energy −14',effect:{oxygen:20,energy:-14},why:'More power is used now, but the crew receives a stronger oxygen reserve for the next days.'},
  {name:'Conserve power',cost:'Oxygen +8 · Energy −4',effect:{oxygen:8,energy:-4},defer:{oxygen:-7},why:'This saves energy now, but the smaller oxygen reserve creates a greater risk during the next mission day.'}
 ],
 water:[
  {name:'Deep water recovery',cost:'Water +24 · Energy −14',effect:{water:24,energy:-14},why:'More water is recovered now, but the pumps leave less energy for oxygen and greenhouse systems.'},
  {name:'Low-power filtration',cost:'Water +11 · Energy −5',effect:{water:11,energy:-5},defer:{water:-6},why:'It saves power, but less water is recovered and the reserve may become tight later.'}
 ],
 food:[
  {name:'Balanced greenhouse cycle',cost:'Food reserve +18 · Water −9 · Energy −8',effect:{water:-9,energy:-8},food:18,why:'A balanced crop cycle supports future meals while sharing water and energy with the other systems.'},
  {name:'Fast-growth lighting',cost:'Food reserve +25 · Water −14 · Energy −15',effect:{water:-14,energy:-15},food:25,defer:{energy:-6},why:'Faster growth improves the food reserve, but high lighting demand reduces energy available later.'}
 ],
 energy:[
  {name:'Clean solar panels',cost:'Energy +25 · Water −5',effect:{energy:25,water:-5},why:'Cleaning improves panel output in this simplified model, but uses some water.'},
  {name:'Use battery reserve',cost:'Energy +12 · No water cost',effect:{energy:12},defer:{energy:-9},why:'This is quick and saves water, but drawing down stored battery power leaves less energy for the next day.'}
 ],
 algae:[
  {name:'Full-light algae cycle',cost:'Oxygen +14 · Water −6 · Energy −8',effect:{oxygen:14,water:-6,energy:-8},why:'More light supports photosynthesis and oxygen output, but the bioreactor needs water and electricity.'},
  {name:'Reduced-light cycle',cost:'Oxygen +6 · Water −3 · Energy −3',effect:{oxygen:6,water:-3,energy:-3},defer:{oxygen:-5},why:'This saves water and energy now, but lower light reduces the oxygen contribution on the next day.'}
 ]
};
function renderDecisionChoices(station){
 const panel=$('decision-options');const feedback=$('decision-feedback');panel.innerHTML='';feedback.textContent='';
 const choices=strategyChoices[station.id]||[];
 if(activated.has(station.id)){panel.innerHTML='<p>This system has already been assigned a strategy in this mission. Its effects remain part of your colony results.</p>';return;}
 choices.forEach((choice)=>{
  const button=document.createElement('button');button.type='button';button.className='decision-option';
  const title=document.createElement('b');title.textContent=choice.name;
  const cost=document.createElement('span');cost.textContent=choice.cost;
  const why=document.createElement('span');why.textContent=choice.why;
  button.append(title,cost,why);button.addEventListener('click',()=>applyStrategy(station,choice));panel.appendChild(button);
 });
}
function applyStrategy(station,choice){
 if(!activeStation||activated.has(station.id))return;
 for(const [key,delta] of Object.entries(choice.effect||{})){
  const next=(key==='food'?foodSupply:resources[key])+delta;
  if(next<0){$('decision-feedback').textContent='Not enough '+key+' to choose this strategy. Try the lower-cost option or activate another system first.';return;}
 }
 for(const [key,delta] of Object.entries(choice.effect||{})){
  if(key==='food')foodSupply=THREE.MathUtils.clamp(foodSupply+delta,0,100);
  else resources[key]=THREE.MathUtils.clamp(resources[key]+delta,0,100);
 }
 if(choice.defer)deferredEffects.push({...choice.defer,day:missionDay+2});
 activated.add(station.id);missionDay++;
 resources.oxygen=Math.max(0,resources.oxygen-(missionScenario.name==='Cold Night Cycle'?5:3));
 resources.water=Math.max(0,resources.water-2);resources.energy=Math.max(0,resources.energy-2);foodSupply=Math.max(0,foodSupply-3);
 for(let i=deferredEffects.length-1;i>=0;i--){if(deferredEffects[i].day<=missionDay){for(const [key,delta] of Object.entries(deferredEffects[i]))if(key!=='day'&&key!=='food')resources[key]=THREE.MathUtils.clamp(resources[key]+delta,0,100);deferredEffects.splice(i,1);}}
 updateResourceUI();$('food-supply-label').textContent='Food reserve: '+Math.round(foodSupply)+' units';
 $('decision-feedback').textContent='DAY '+missionDay+': '+choice.why+' Ongoing crew use: oxygen −'+(missionScenario.name==='Cold Night Cycle'?5:3)+', water −2, energy −2, food reserve −3.';
 station.light.intensity=5;station.group.scale.setScalar(1.06);setTimeout(()=>station.group.scale.setScalar(1),250);
 updateMission();
 const summary=choice.name+' selected. '+choice.why;
 activeStation=null;ui.station.classList.add('hidden');
 if(activated.size===stations.length)finishMission();else if(started&&!isTouchDevice)renderer.domElement.requestPointerLock();
 notify(summary);
}
function finishMission(){
 const lowest=Math.min(resources.oxygen,resources.water,resources.energy,foodSupply);
 let title,summary;
 if(lowest<20){title='Colony under pressure';summary='The colony completed its five decisions, but at least one reserve is critically low. The crew would need emergency resupply, reduced operations, or a revised plan.';}
 else if(resources.oxygen>=55&&resources.water>=45&&resources.energy>=40&&foodSupply>=40){title='Sustainable colony plan';summary='Your choices kept the main life-support reserves in a workable range. The colony has a stronger starting position for the next mission phase.';}
 else{title='Colony survives with trade-offs';summary='The crew can continue, but some reserves are limited. Your next mission would need to prioritize the weakest system.';}
 $('ending-summary').textContent=summary;
 $('ending-details').textContent='Final reserves — Oxygen: '+Math.round(resources.oxygen)+'% · Water: '+Math.round(resources.water)+'% · Energy: '+Math.round(resources.energy)+'% · Food reserve: '+Math.round(foodSupply)+' units. Scenario: '+missionScenario.name+'.';
 $('win-screen').querySelector('.eyebrow').textContent=title.toUpperCase();$('win-screen').querySelector('h1').innerHTML=title.toUpperCase();
 ui.win.classList.remove('hidden');document.exitPointerLock();
}

function renderStationReferences(id){
 const panel=$('station-reference');
 const references={
  oxygen:{title:'NASA REFERENCE & MEASURED RESULTS · MOXIE',text:'NASA’s MOXIE experiment tested oxygen production from Martian atmospheric CO₂. NASA reports 122 grams of oxygen produced in total; its best production rate was 12 grams per hour at 98% purity or better.',data:'NASA result: 122 g total O₂ · up to 12 g/hour · 98% purity or better.',links:[['NASA MOXIE mission results','https://science.nasa.gov/mission/mars-2020-perseverance/science-instruments/']]},
  algae:{title:'NASA RESEARCH CONTEXT · BIOLOGICAL SYSTEMS',text:'NASA OSDR contains space-biology datasets about plants, microbes, and other organisms.',data:'No specific OSDR dataset for this exact Spirulina/Chlorella bioreactor is claimed here.',links:[['NASA OSDR repository','https://osdr.nasa.gov/bio/repo/search']]},
  food:{title:'NASA DATASET · PLANT GROWTH IN SPACE',text:'LIFELOOP’s greenhouse is informed by NASA space-plant research.',data:'Dataset OSD-217: Arabidopsis spaceflight methylome · ISS plant experiment.',links:[['Open NASA OSDR study OSD-217','https://osdr.nasa.gov/bio/repo/data/studies/OSD-217']]},
  water:{title:'NASA RESEARCH REFERENCE · LIFE-SUPPORT SYSTEMS',text:'Water recovery is essential for long-duration space missions.',data:'No water-recovery dataset is integrated in this prototype.',links:[['NASA OSDR repository','https://osdr.nasa.gov/bio/repo/search']]},
  energy:{title:'NASA DONKI · LATEST SPACE-WEATHER UPDATE',text:'DONKI records coronal mass ejections (CMEs) and solar flares.',data:'VERIFIED UPDATE · 13 NOV 2026, 03:24 UTC: CME activity ID 2026-11-13T03:24:00-CME-001.',links:[['Open NASA DONKI database','https://ccmc.gsfc.nasa.gov/DONKI/']]}
 };
 const r=references[id];
 if(!r){panel.classList.add('hidden');panel.innerHTML='';return;}
 panel.innerHTML=`<h3>${r.title}</h3><p>${r.text}</p><div class="reference-data"><strong>NASA DATA / RESULT</strong><p>${r.data}</p></div>${id==='energy'?'<button type="button" id="load-donki" class="data-load-btn">LOAD RECENT DONKI CME DATA</button><div id="donki-data-output" class="donki-output">Live event data will appear here after loading.</div>':''}${r.links.map(([label,url])=>`<a href="${url}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`).join('')}`;
 panel.classList.add('hidden');
 const loadButton=$('load-donki');
 if(loadButton)loadButton.addEventListener('click',loadDonkiData);
}
async function loadDonkiData(){
 const output=$('donki-data-output');const button=$('load-donki');
 if(!output||!button)return;
 button.disabled=true;button.textContent='LOADING NASA DATA…';output.textContent='Requesting recent CME records from the NASA CCMC DONKI API…';
 const end=new Date(),start=new Date(end.getTime()-30*24*60*60*1000);
 const fmt=d=>d.toISOString().slice(0,10);
 const url=`https://ccmc.gsfc.nasa.gov/DONKI-API/get/CME?startDate=${fmt(start)}&endDate=${fmt(end)}`;
 try{
  const response=await fetch(url);if(!response.ok)throw new Error('NASA API response '+response.status);
  const events=await response.json();
  if(!Array.isArray(events)||events.length===0){output.textContent='NASA DONKI returned no CME records for this 30-day period.';}
  else{
   const recent=events.slice().sort((a,b)=>String(b.startTime||'').localeCompare(String(a.startTime||''))).slice(0,6);
   const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
   output.innerHTML=`<strong>${events.length} CME record(s) returned for ${fmt(start)} to ${fmt(end)}. Latest records:</strong>`+recent.map(e=>{
    const analyses=Array.isArray(e.cmeAnalyses)?e.cmeAnalyses:[];
    const analysis=analyses.find(a=>a.isMostAccurate)||analyses[0];
    const details=analysis?`Estimated speed: ${analysis.speed??'not reported'} km/s · half-angle: ${analysis.halfAngle??'not reported'}°`:'No CME speed analysis attached.';
    return `<p><b>${esc(e.startTime||'Date not provided')}</b><br>${esc(e.activityID||'CME event')}<br>${esc(details)}</p>`;
   }).join('')+`<small>Source: NASA CCMC DONKI API.</small>`;
  }
 }catch(error){output.innerHTML='Could not load live API data in this browser session.';}
 finally{button.disabled=false;button.textContent='REFRESH DONKI CME DATA';}
}

function closeStation(){ui.station.classList.add('hidden');activeStation=null;referenceVisible=false;if(started&&!isTouchDevice)renderer.domElement.requestPointerLock();}
function toggleStationReference(){const panel=$('station-reference');if(!activeStation||!panel||panel.innerHTML.trim()==='')return;referenceVisible=!referenceVisible;panel.classList.toggle('hidden',!referenceVisible);if(referenceVisible){panel.scrollIntoView({behavior:'smooth',block:'nearest'});notify('Scientific information and NASA source links displayed.');}else{notify('NASA reference panel hidden.');}}
function activateStation(){notify('Choose one of the strategy options to commit this system.');}
function updateResourceUI(){for(const k of Object.keys(resources)){$(k+'-value').textContent=Math.round(resources[k])+'%';$(k+'-bar').style.width=resources[k]+'%';}}
function updateMission(){const n=activated.size;$('mission-progress').style.width=(n/stations.length*100)+'%';$('mission-count').textContent='DAY '+missionDay+' · '+n+' / '+stations.length+' DECISIONS';$('mission-title').textContent=n===stations.length?'Mission decisions complete':'Stabilize the colony';$('mission-description').textContent='Choose a strategy at each system. Balance oxygen, water, and energy while maintaining food reserves.';}
function notify(msg){ui.notification.textContent=msg;ui.notification.classList.add('show');clearTimeout(notifyTimer);notifyTimer=setTimeout(()=>ui.notification.classList.remove('show'),3000);if(soundOn)beep();}

let audioCtx;
function initAmbientAudio(){
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (windGainNode) return;
    const bufferSize = 2 * audioCtx.sampleRate;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;

    const whiteNoise = audioCtx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    windFilterNode = audioCtx.createBiquadFilter();
    windFilterNode.type = 'lowpass';
    windFilterNode.frequency.value = 320;

    windGainNode = audioCtx.createGain();
    windGainNode.gain.value = soundOn ? 0.015 : 0;

    whiteNoise.connect(windFilterNode);
    windFilterNode.connect(windGainNode);
    windGainNode.connect(audioCtx.destination);
    whiteNoise.start(0);
  } catch (e) {}
}

function playWipeSound(){
  if(!soundOn || !audioCtx) return;
  try {
    const bufferSize = audioCtx.sampleRate * 0.28;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * Math.sin((i / bufferSize) * Math.PI);

    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1100;

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.26);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    noise.start();
  } catch (e) {}
}

function playBreathSound(heavy = false){
  if(!soundOn || !audioCtx) return;
  try {
    const bufferSize = audioCtx.sampleRate * 0.6;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * Math.sin((i / bufferSize) * Math.PI);

    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = heavy ? 520 : 400;
    filter.Q.value = 1.5;

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(heavy ? 0.035 : 0.018, audioCtx.currentTime + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.58);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    noise.start();
  } catch (e) {}
}

function beep(){try{audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.connect(g);g.connect(audioCtx.destination);o.frequency.value=620;o.type='sine';g.gain.setValueAtTime(.045,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+.13);o.start();o.stop(audioCtx.currentTime+.14);}catch(e){}}

function animate(){
 requestAnimationFrame(animate);
 const dt=Math.min(clock.getDelta(),.04);
 if(started){
   updatePlayer(dt);
   updateEnvironmentAndWeather(dt);
   findNearby();
 }
 const t=clock.elapsedTime;
 allCropPlants.forEach(p=>{const age=t-p.userData.growStart;p.scale.setScalar(Math.min(1,.08+age*.75));});
 stations.forEach((s,i)=>{s.group.children[3].rotation.y=t*.6+i;s.group.children[4].position.y=2.45+Math.sin(t*2+i)*.08;});
 dust.forEach(p=>{
   const a=p.geometry.attributes.position;
   const dustSpeed = 0.008 + stormIntensity * 0.095;
   for(let i=0;i<a.count;i++){
     a.array[i*3] += dustSpeed;
     if(a.array[i*3]>37) a.array[i*3]=-37;
   }
   a.needsUpdate=true;
 });
 renderer.render(scene,camera);
}
init();