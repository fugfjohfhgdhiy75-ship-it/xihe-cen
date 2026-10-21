// 页面：首页、世界地图、关卡、对战、孵蛋屋、恐龙乐园、游乐场、家长
(function(){
const D=window.DATA,G=window.GAMES,H=G._helpers;
const {$,el,esc,rnd,shuffle,sleep,say,stop,SFX,bubble,flyTo,bounce,shake,burstAt,bigConfetti,save,today}=C;
const S=()=>C.S();
const dimg=H.dimg;
const DN=id=>D.DINOS.find(d=>d.id===id);
const app=()=>$('#app');
let cleanupFns=[];
function show(node){stop();cleanupFns.forEach(f=>{try{f()}catch(e){}});cleanupFns=[];document.querySelectorAll('.pzp.drag,.overlay').forEach(p=>p.remove());
  if(S().brk&&!node.classList.contains('brk')&&!node.classList.contains('parent'))node=breakNode();
  const a=app();a.innerHTML='';a.append(node);window.scrollTo(0,0)}
const onLeave=f=>cleanupFns.push(f);
const wide=()=>innerWidth>innerHeight*1.15;

// ---------- 蛋 ----------
const NEED={1:60,2:120,3:200};
const DAYS={1:3,2:5,3:7};
const STEPS={1:5,2:6,3:8};
const capOf=e=>Math.ceil(e.need/e.minDays);
const prog=e=>e?Math.min(1,e.warm/e.need,(e.days||0)/e.minDays):0;
const ready=e=>e&&e.warm>=e.need&&(e.days||0)>=e.minDays;
const RNAME={1:'恐龙蛋',2:'稀有蛋',3:'金蛋'};
function newEgg(r){const s=S();const own=new Set(s.dinos.map(d=>d.id).concat(s.eggs.map(e=>e.dino)));
  const pool=D.DINOS.filter(d=>d.r===r);const fresh=pool.filter(d=>!own.has(d.id));const d=(fresh.length?fresh:pool)[rnd((fresh.length?fresh:pool).length)];
  const e={id:'e'+Date.now()+rnd(1000),r,dino:d.id,warm:0,need:NEED[r],minDays:DAYS[r],days:0,day:'',dayWarm:0,pat:rnd(4)};s.eggs.push(e);if(!s.inc)s.inc=e.id;save();return e}
const incEgg=()=>{const s=S();return s.eggs.find(e=>e.id===s.inc)||null};
function eggHTML(e,cls=''){const p=e&&e.minDays?prog(e):e?Math.min(1,e.warm/e.need):0;const st=p>=1?4:p>=.75?3:p>=.5?2:p>=.25?1:0;
  return `<div class="egg r${e?e.r:1} pat${e?e.pat:0} st${st} ${cls}"><svg viewBox="0 0 100 130" class="cracks"><path class="c1" d="M18 58 L30 50 L38 61 L50 52"/><path class="c2" d="M50 52 L61 63 L71 54 L84 62"/><path class="c3" d="M30 86 L41 78 L49 89 L60 80 L72 91"/><path class="c4" d="M12 72 L26 66 L35 76 L48 68 L57 79 L70 70 L88 78"/></svg></div>`}
// 每天能加的温度有上限，蛋至少要孵 3/5/7 天；照顾蛋（care）不算在上限里
function addWarm(n,fromEl,{care=false}={}){const e=incEgg();if(!e||n<=0)return;const t=today();
  if(e.day!==t){e.day=t;e.dayWarm=0;e.days=(e.days||0)+1}
  let add=care?n:Math.max(0,Math.min(n,capOf(e)-e.dayWarm));add=Math.min(add,e.need-e.warm);
  if(add<=0){if(e.capMsg!==t&&!ready(e)){e.capMsg=t;save();setTimeout(()=>bubble('🥚 蛋今天已经很暖和啦，明天再来照顾它！',2600),900)}save();return}
  const before=prog(e);e.warm+=add;if(!care)e.dayWarm+=add;save();
  if(fromEl)flyTo(fromEl,'#warmBox','🔥','fly fire');
  setTimeout(updateWarm,fromEl?850:0);
  const after=prog(e);[.25,.5,.75].forEach(q=>{if(before<q&&after>=q){setTimeout(()=>{SFX.crack();bubble('🥚 蛋动了一下！')},900)}});
  if(before<1&&ready(e))setTimeout(()=>{SFX.fanfare();bubble('🐣 蛋快孵出来了！快去孵蛋屋！',2400)},1000)}
function updateWarm(){const b=$('#warmBox');if(!b)return;const e=incEgg();b.innerHTML=e?`${eggHTML(e,'mini')}<span>${Math.floor(prog(e)*100)}%</span>`:'<span>🥚 —</span>'}
function addCoins(n,fromEl){S().coins+=n;save();if(fromEl)for(let i=0;i<Math.min(n,4);i++)setTimeout(()=>flyTo(fromEl,'#coinBox','🪙'),i*120);setTimeout(()=>{const b=$('#coinBox b');if(b)b.textContent=S().coins},950);SFX.coin()}

function topbar(back){const t=el('div','topbar');const h=el('button','tbtn','🏠');h.onclick=back||home;
  const coin=el('div','chip','🪙 <b>'+S().coins+'</b>');coin.id='coinBox';
  const warm=el('button','chip warm');warm.id='warmBox';warm.onclick=hatchery;
  const food=el('div','chip','🍖 <b>'+S().food+'</b>');food.id='foodBox';
  t.append(h,el('div','grow'),food,coin,warm);setTimeout(updateWarm);return t}

(S().eggs||[]).forEach(e=>{if(!e.minDays){e.need=Math.max(e.need,NEED[e.r]);e.minDays=DAYS[e.r];e.days=e.warm>0?1:0;e.day='';e.dayWarm=0}});save();

// ---------- 首页 ----------
function home(){
  const s=S();
  if(!s.started)return intro();
  dailyGift();
  const v=el('div','screen home');v.style.backgroundImage='url(assets/img/bg_grass.webp)';
  v.append(topbar(home));
  const hero=el('div','homehero',`<img src="${dimg(s.hero)}" alt=""><div class="hname">${esc(DN(s.hero).n)}</div>`);
  const title=el('h1','title','恐龙认字<span>大冒险</span>');
  const grid=el('div','menu');
  const e=incEgg();const rdy=ready(e);
  const items=[['🗺️','冒险地图',`第 ${Math.min(40,s.unlocked)} 关`,worldMap,'big'],['🥚','孵蛋屋',rdy?'快孵出来了！':`${s.eggs.length} 颗蛋`,hatchery,rdy?'pulse':''],['🎪','游乐场','对对碰·消消乐·拼图',arcade,''],['🦕','恐龙乐园',`${s.dinos.length} 只恐龙`,park,''],['🏘️','恐龙小镇',`${(s.town||[]).length} 座房子`,town,'']];
  items.forEach(([i,n,sub,f,c])=>{const b=el('button','mbtn '+c,`<span class="mi">${i}</span><span class="mn">${n}</span><span class="ms">${esc(sub)}</span>`);b.onclick=()=>{SFX.pop();f()};grid.append(b)});
  const par=el('button','parentbtn','⚙️ 家长');par.onclick=parentGate;
  v.append(title,hero,grid,par);show(v);
  hero.onclick=()=>{SFX.jump();bounce(hero);say(DN(s.hero).n)}}
function dailyGift(){const s=S();if(s.gift===today())return;s.gift=today();const wait=s.eggs.length;if(wait>=2){save();return}
  const e=newEgg(Math.random()<.2?2:1);setTimeout(()=>{bubble('🎁 今天的礼物：一颗'+RNAME[e.r]+'！',2600);say('找到一颗恐龙蛋！')},600)}

// ---------- 第一次：选一只恐龙宝宝当伙伴，再领一颗要孵好几天的蛋 ----------
function intro(){
  const v=el('div','screen intro');v.style.backgroundImage='url(assets/img/bg_jungle.webp)';
  const card=el('div','card-c');
  card.innerHTML='<h1 class="title">恐龙认字<span>大冒险</span></h1><p class="lead">选一只恐龙宝宝，当你的冒险伙伴！</p>';
  const row=el('div','dpick starters');
  shuffle(D.DINOS.filter(d=>d.r===1)).slice(0,3).forEach(d=>{const b=el('button','dp',`<img src="${dimg(d.id)}" alt=""><span>${esc(d.n)}</span>`);
    b.onclick=async()=>{C.ac();SFX.fanfare();const s=S();s.started=true;s.hero=d.id;s.dinos=[{id:d.id,uid:'d'+Date.now(),stage:0,fed:0}];s.eggs=[];s.inc=null;s.gift=today();save();newEgg(1);
      await say(d.n);bubble('🥚 还送你一颗恐龙蛋！每天照顾它，三天以后才会孵出来。',3600);say('还送你一颗恐龙蛋！每天照顾它，三天以后才会孵出来。');hatchery()};row.append(b)});
  const go=el('button','pbtn good','🔊 开始');go.onclick=()=>{C.ac();say('选一只恐龙宝宝，当你的冒险伙伴！')};
  card.append(row,go);v.append(card);show(v)}

// ---------- 孵蛋仪式 ----------
function ceremony(egg,{first=false}={}){
  const steps=first?3:STEPS[egg.r];let k=0;
  const v=el('div','screen ceremony');v.style.backgroundImage='url(assets/img/bg_night.webp)';
  v.append(topbar(hatchery));
  const stage=el('div','cerstage');const eggEl=el('div','cegg',eggHTML(Object.assign({},egg,{warm:0}),'huge'));const bar=el('div','stepdots');for(let i=0;i<steps;i++)bar.append(el('span'));
  stage.append(eggEl,bar);
  const panelHost=el('div','cerq');
  v.append(stage,panelHost);show(v);
  const W=curW();
  const setCrack=()=>{const e=eggEl.querySelector('.egg');e.className=e.className.replace(/st\d/,'st'+Math.min(4,Math.ceil(k/steps*4)))};
  const types=['hear','count','match','pattern','hear','word'];
  const next=()=>{panelHost.innerHTML='';runStage(types[k%types.length],{w:W,host:panelHost,compact:true,onDone:async(ctx)=>{
      k++;bar.children[k-1].classList.add('on');SFX.crack();setCrack();eggEl.classList.remove('jump');void eggEl.offsetWidth;eggEl.classList.add('jump');
      if(k===2)say('蛋裂开了！');
      if(k<steps){await sleep(700);if(panelHost.isConnected)next()}else{panelHost.innerHTML='';await sleep(600);if(panelHost.isConnected)hatch()}}})};
  async function hatch(){
    const d=DN(egg.dino);eggEl.innerHTML=`<div class="shell top"></div><div class="shell bot"></div><img class="born" src="${dimg(d.id)}" alt="">`;
    SFX.boom();bigConfetti();SFX.fanfare();
    const s=S();s.eggs=s.eggs.filter(e=>e.id!==egg.id);if(s.inc===egg.id)s.inc=s.eggs[0]?s.eggs[0].id:null;
    s.dinos.push({id:d.id,uid:'d'+Date.now(),stage:0,fed:0});if(first||!s.hero)s.hero=d.id;
    save();
    const card=el('div','borncard',`<h2>孵出来啦！</h2><div class="bn">${esc(d.n)}</div><p>${esc(d.f)}</p>`);
    const btns=el('div','vbtns');
    const b1=el('button','pbtn good',first?'🗺️ 开始冒险':'🦕 去恐龙乐园');b1.onclick=()=>first?worldMap():park();
    const b2=el('button','pbtn','🥚 孵蛋屋');b2.onclick=hatchery;btns.append(b1);if(!first)btns.append(b2);
    card.append(btns);await sleep(900);stage.append(card);
    await say('孵出来啦！',d.n);if(first)say('它就是你的英雄！我们去冒险吧！');else say(d.f)}
  say(first?'答对三题，恐龙蛋就会孵出来！':'帮小恐龙出来！每答对一题，蛋就裂开一点！').then(next)}

// ---------- 孵蛋屋 ----------
function hatchery(){
  const s=S();const v=el('div','screen hatch');v.style.backgroundImage='url(assets/img/bg_night.webp)';
  v.append(topbar());
  const e=incEgg();
  const main=el('div','hmain');
  if(!e){main.innerHTML='<div class="empty">还没有蛋。去冒险、去游乐场，就能找到恐龙蛋！</div>';const b=el('button','pbtn good','🗺️ 去冒险');b.onclick=worldMap;main.append(b);v.append(main);show(v);say('去冒险，就能找到恐龙蛋！');return}
  const p=prog(e);const rdy=ready(e);const t=today();const dw=e.day===t?e.dayWarm:0;const cap=capOf(e);
  const nest=el('div','nest',`<div class="lamp ${rdy?'hot':''}">💡</div>${eggHTML(e,'huge wob'+(p>=.5?' wob2':''))}<div class="hay"></div>`);
  const dots=[...Array(e.minDays)].map((_,i)=>`<span class="${i<(e.days||0)?'on':''}"></span>`).join('');
  const thermo=el('div','thermo',`<div class="tlabel">${RNAME[e.r]} · 要孵 ${e.minDays} 天</div><div class="daydots">${dots}</div><div class="tnum">第 ${Math.min(e.days||0,e.minDays)} / ${e.minDays} 天</div><div class="tbar"><i style="width:${Math.min(100,e.warm/e.need*100)}%"></i></div><div class="tnum">温度 ${e.warm} / ${e.need} 🔥　今天 ${dw} / ${cap}</div>`);
  const left=Math.max(0,e.minDays-(e.days||0));
  const tip=el('div','htip',rdy?'蛋在动！快帮它出来！':dw>=cap?'今天蛋已经够暖和了，明天再来！':e.warm>=e.need?`还要再孵 ${left} 天`:p>=.75?'蛋里有声音：咚咚咚！':p>=.5?'蛋上有裂缝了！':p>=.25?'蛋动了一下……':'每答对一题，蛋就暖和一点。');
  main.append(nest,thermo,tip);
  if(rdy){const b=el('button','pbtn good big pulse','🐣 帮它出来！');b.onclick=()=>ceremony(e);main.append(b)}
  // 每天照顾蛋
  const care=el('div','care');const ct=s.care[today()]||{};
  const CARE=[['blanket','🧣','盖被子'],['rub','🧽','擦一擦'],['sing','🎵','跟它说话'],['story','📖','读给它听']];
  CARE.forEach(([k,i,n])=>{const b=el('button','cbtn'+(ct[k]?' done':''),`<span>${i}</span>${n}${ct[k]?' ✔':''}`);b.disabled=!!ct[k]||rdy;b.onclick=()=>doCare(k,e);care.append(b)});
  main.append(el('div','ctitle','每天照顾它（每样一天一次，+3 🔥）'),care);
  const gob=el('button','pbtn good','🗺️ 去冒险，让蛋更暖和');gob.onclick=()=>worldMap();
  // 蛋篮子
  const basket=el('div','basket');s.eggs.filter(x=>x.id!==s.inc).forEach(x=>{const b=el('button','bk',eggHTML(x,'small')+`<span>${Math.floor(x.warm/x.need*100)}%</span>`);b.onclick=()=>{s.inc=x.id;save();SFX.pop();hatchery()};basket.append(b)});
  if(basket.children.length)main.append(el('div','ctitle','篮子里的蛋（点一下换着孵）'),basket);
  main.append(gob);
  v.append(main);show(v);
  nest.querySelector('.egg').onclick=ev=>{SFX.tick();shake(ev.currentTarget);say(rdy?'快帮我出来！':p>=.5?'咚咚咚！':'好暖和！')};
  say(tip.textContent)}
function doCare(k,e){
  const s=S();const done=()=>{s.care={[today()]:Object.assign(s.care[today()]||{},{[k]:1})};save();addWarm(3,null,{care:true});SFX.ok();bigConfetti();setTimeout(hatchery,1200)};
  if(k==='blanket'){const n=$('.nest');n.insertAdjacentHTML('beforeend','<div class="blanket">🧣</div>');say('盖上被子，好暖和！');done();return}
  if(k==='rub'){ // 用手指把蛋上的泥擦掉
    const egg=$('.nest .egg');const mud=el('div','mud');for(let i=0;i<7;i++){const m=el('i');m.style.left=(15+rnd(65))+'%';m.style.top=(15+rnd(65))+'%';mud.append(m)}egg.append(mud);say('蛋脏了，用手指擦一擦！');
    let left=7;mud.addEventListener('pointermove',ev=>{const t=document.elementFromPoint(ev.clientX,ev.clientY);if(t&&t.parentNode===mud&&!t.dataset.x){t.dataset.x=1;t.style.opacity=0;SFX.tick();left--;if(left===0){say('好干净！');done()}}});
    mud.addEventListener('pointerdown',ev=>{const t=ev.target;if(t.parentNode===mud&&!t.dataset.x){t.dataset.x=1;t.style.opacity=0;left--;SFX.tick();if(left===0){say('好干净！');done()}}});return}
  // 跟它说话 = 跟读；读给它听 = 大声读
  const host=el('div','overlay');const box=el('div','ovbox');host.append(box);document.body.append(host);
  runStage(k==='sing'?'speak':'read',{w:curW(),host:box,onDone:()=>{host.remove();done()}});
  const x=el('button','tbtn close','✕');x.onclick=()=>{stop();host.remove()};box.append(x)}

// ---------- 世界地图 ----------
const curWorld=()=>D.WORLDS[Math.min(4,Math.floor((Math.min(40,S().unlocked)-1)/8))];
const curW=()=>Object.assign({},curWorld(),{phase:D.phaseOf(Math.min(40,S().unlocked))});
function worldMap(wi){
  const s=S();if(wi==null)wi=D.WORLDS.indexOf(curWorld());const W=D.WORLDS[wi];
  const v=el('div','screen map');v.style.backgroundImage=`url(assets/img/bg_${W.bgs[0]}.webp)`;
  v.append(topbar());
  const tabs=el('div','wtabs');D.WORLDS.forEach((w,i)=>{const lock=s.unlocked<i*8+1;const b=el('button','wtab'+(i===wi?' on':'')+(lock?' lock':''),`${w.ico}<span>${lock?'🔒':w.n}</span>`);b.onclick=()=>{if(lock){say('先打败前面的大魔王！');shake(b);return}SFX.pop();worldMap(i)};tabs.append(b)});
  const path=el('div','path');
  for(let k=0;k<8;k++){const n=wi*8+k+1;const lock=n>s.unlocked;const st=s.stars[n]||0;const isB=k===3||k===7;
    const b=el('button','node'+(lock?' lock':'')+(isB?' boss':'')+(n===s.unlocked?' cur':''),`<span class="nn">${lock?'🔒':isB?(k===7?'👑':'⚔️'):n}</span><span class="nst">${'★'.repeat(st)}${'☆'.repeat(lock?0:3-st)}</span><span class="nl">${esc(W.names[k])}</span>`);
    b.onclick=()=>{if(lock){say('先过前面的关卡哦！');shake(b);return}SFX.pop();startLevel(n)};path.append(b)}
  const heroN=Math.min(s.unlocked,wi*8+8);
  v.append(tabs,el('h2','wname',`${W.ico} ${W.n}`),path);show(v);
  const cur=path.children[Math.max(0,Math.min(7,heroN-wi*8-1))];if(cur&&heroN>=wi*8+1){const h=el('img','maphero');h.src=dimg(s.hero);cur.append(h)}
  say(W.n)}

// ---------- 关卡 ----------
function levelPlan(n){
  const wi=Math.floor((n-1)/8),W=D.WORLDS[wi],k=(n-1)%8;
  if(k===3)return{battle:true,boss:W.mini,hp:6+wi,W:lvW(W,n),k};
  if(k===7)return{battle:true,boss:W.boss,hp:8+wi*2,W:lvW(W,n),k,big:true};
  const c=D.PHASES[D.phaseOf(n)],e=W.en,M=D.MINI,m=W.math;
  const ni=k<3?k:k-1;
  const raw=[c[n%c.length],m[(ni*2+wi)%m.length],e[n%e.length],c[(n+2)%c.length],M[(n-1)%M.length],n%2?'read':'speak',m[(ni*2+1+wi)%m.length],c[(n+4)%c.length],e[(n+2)%e.length]];
  const pools=[c,m,e,c,M,null,m,c,e];
  // 同一关里不出两次同样的游戏（英语数字 enum 可以出两次）
  for(let i=1;i<raw.length;i++){if(raw[i]!=='enum'&&raw.slice(0,i).includes(raw[i])&&pools[i]){const alt=pools[i].find(x=>!raw.includes(x));if(alt)raw[i]=alt}}
  return{stages:raw,W:lvW(W,n),k}}
const lvW=(W,n)=>Object.assign({},W,{phase:D.phaseOf(n),opts:Math.min(5,W.opts+(S().adapt||0))});
const PHN={1:'词语',2:'短语',3:'句子'};
const OBST=['🪨','🌊','🌉','⛰️','🪵','🌵','🔥','🧊','🍄','🌳'];
function startLevel(n){
  const plan=levelPlan(n);if(plan.battle)return battle(n,plan);
  C.newLevelSession();
  const s=S();const W=plan.W;const bg=W.bgs[plan.k];
  const v=el('div','screen level');v.style.backgroundImage=`url(assets/img/bg_${bg}.webp)`;
  const wIdx=Math.floor((n-1)/8);v.append(topbar(()=>worldMap(wIdx)));
  const N=plan.stages.length;
  const prog=el('div','prog');for(let i=0;i<N;i++)prog.append(el('span'));
  const track=el('div','track');const obs=[];
  for(let i=0;i<N;i++){const o=el('div','obst',OBST[(n+i*3)%OBST.length]);o.style.left=(8+(i+1)*(84/(N+1)))+'%';track.append(o);obs.push(o)}
  const flag=el('div','obst flag','🚩');flag.style.left='94%';track.append(flag);
  const hero=el('img','hero');hero.src=dimg(s.hero);hero.style.left='3%';track.append(hero);
  const host=el('div','stagehost');
  const lv=livesUI();
  v.append(el('div','lvtitle',`第 ${n} 关 · ${esc(W.names[plan.k])} · ${PHN[W.phase]}`),lv.el,prog,host,track);show(v);
  let i=0,mist=0;
  const intro=el('div','storycard',`<div class="sico">${W.ico}</div><h2>第 ${n} 关</h2><div class="sname">${esc(W.names[plan.k])}</div><p>${PHN[W.phase]}关，一共 ${N} 个难关。${lv.max?`有 ${lv.max} 颗心，认真想好再点哦！`:''}</p>`);
  const go=el('button','pbtn good big','出发！');intro.append(go);host.append(intro);
  say(`第${n}关，${W.names[plan.k]}`);
  go.onclick=()=>{SFX.pop();say('出发！');next()};
  function next(){host.innerHTML='';
    const cur=runStage(plan.stages[i],{w:W,host,hero:s.hero,bg,onWrong:lv.hit(()=>cur,host,n),onDone:async(ctx)=>{
      mist+=ctx.mist;prog.children[i].classList.add('on');
      const perfect=ctx.mist===0&&!ctx.skipped;
      if(!ctx.skipped){say(H.PRAISE[rnd(H.PRAISE.length)]);addCoins(1,prog.children[i]);addWarm(perfect?2:1,prog.children[i])}
      host.innerHTML='';
      // 恐龙走到下一个障碍
      hero.style.left=`calc(${obs[i].style.left} - 2%)`;hero.classList.add('walk');SFX.jump();
      const ob=obs[i];setTimeout(()=>{ob.classList.add('passed');hero.classList.remove('walk')},900);
      i++;await sleep(1300);if(!host.isConnected)return;
      if(i<N)next();else{hero.style.left='90%';hero.classList.add('walk');await sleep(1000);hero.classList.remove('walk');if(host.isConnected)finishLevel(n,mist,host)}}})}}
async function finishLevel(n,mist,host,{battle}={}){
  const s=S();const stars=mist<=2?3:mist<=5?2:1;const first=!s.stars[n];s.stars[n]=Math.max(s.stars[n]||0,stars);
  if(n>=s.unlocked)s.unlocked=Math.min(41,n+1);s.food+=3;s.plays++;
  const W=D.WORLDS[Math.floor((n-1)/8)];const k=(n-1)%8;
  let egg=null;const waiting=s.eggs.filter(e=>e.id!==s.inc).length;
  if(k===7)egg=newEgg(3);else if(k===3&&waiting<3)egg=newEgg(2);else if(first&&waiting<2&&(k===1||k===5))egg=newEgg(n>16&&Math.random()<.35?2:1);
  if(mist<=1){s.pstreak=(s.pstreak||0)+1;if(s.pstreak>=2)s.adapt=1}else{s.pstreak=0;if(mist>=3)s.adapt=0}
  save();
  host.innerHTML='';
  const card=el('div','storycard win',`<h2>${battle?'赢啦！':'过关啦！'}</h2><div class="stars">${'⭐'.repeat(stars)}${'<span class="dim">⭐</span>'.repeat(3-stars)}</div><div class="rew">🪙 +3　🍖 +3　🔥 +5</div>`);
  if(egg){card.insertAdjacentHTML('beforeend',`<div class="gotegg">${eggHTML(egg,'wob')}<div>找到一颗${RNAME[egg.r]}！</div></div>`)}
  const btns=el('div','vbtns');
  const nx=el('button','pbtn good big',n<40?'下一关 ▶':'🏆');nx.onclick=()=>n<40?startLevel(n+1):worldMap(4);
  const hb=el('button','pbtn','🥚 孵蛋屋');hb.onclick=hatchery;
  const mb=el('button','pbtn','🗺️ 地图');mb.onclick=()=>worldMap(D.WORLDS.indexOf(W));
  btns.append(nx,hb,mb);card.append(btns);host.append(card);
  bigConfetti();SFX.fanfare();addCoins(3,card);addWarm(5,card);
  if(sessionOver()){btns.remove();card.append(timeUp())}
  await say(battle?'赢啦！':'过关啦！');if(egg)say('找到一颗恐龙蛋！');
  if(n===40&&battle){await sleep(800);say('你是大王！')}}

// ---------- 对战 ----------
function battle(n,plan){
  C.newLevelSession();
  const s=S();const W=plan.W;const boss=DN(plan.boss);
  const v=el('div','screen level battle');v.style.backgroundImage=`url(assets/img/bg_${W.bgs[plan.k]}.webp)`;
  const wIdx=Math.floor((n-1)/8);v.append(topbar(()=>worldMap(wIdx)));
  const arena=el('div','arena');
  const hero=el('img','bhero');hero.src=dimg(s.hero);
  const bo=el('div','bboss',`<img src="${dimg(boss.id)}" alt=""><div class="hp"></div><div class="bn">${esc(boss.n)}</div>`);
  const hp=bo.querySelector('.hp');let life=plan.hp;const draw=()=>{hp.innerHTML='❤️'.repeat(life)+'<span class="dim">'+'🤍'.repeat(plan.hp-life)+'</span>'};draw();
  arena.append(hero,bo);
  const host=el('div','stagehost');
  const lv=livesUI();
  v.append(el('div','lvtitle',`第 ${n} 关 · ${plan.big?'👑 ':'⚔️ '}${esc(boss.n)}`),lv.el,host,arena);show(v);
  const pool=[...D.PHASES[W.phase],'enum','eletter','count','more','pattern','shadow',...(W.id>=2?['ephon','numorder','oddone']:[]),...(W.id>=3?['add','spatial']:[]),...(W.id>=4?['eword','sudoku']:[])];
  let mist=0,last='';
  const intro=el('div','storycard',`<h2>${esc(boss.n)}来了！</h2><p>${plan.big?'这是大魔王！':'它要考考你！'}每答对一题，就攻击它一次。</p>`);
  const go=el('button','pbtn good big','⚔️ 开战！');intro.append(go);host.append(intro);
  say(boss.n,'哼！我来考考你！');
  go.onclick=()=>{SFX.pop();next()};
  function next(){host.innerHTML='';let t;do{t=pool[rnd(pool.length)]}while(t===last);last=t;
    const cur=runStage(t,{w:W,host,compact:true,onDone:async(ctx)=>{mist+=ctx.mist;host.innerHTML='';
      if(!ctx.skipped){hero.classList.add('dash');SFX.whoosh();await sleep(350);SFX.hit();bo.classList.add('hurt');burstAt(bo,30);life--;draw();addCoins(1,bo);addWarm(1,bo);say(['哎哟！','哎哟！好痛！'][rnd(2)]);await sleep(500);hero.classList.remove('dash');bo.classList.remove('hurt')}
      if(!host.isConnected)return;
      if(life<=0){bo.classList.add('ko');SFX.boom();await sleep(1200);if(host.isConnected)finishLevel(n,mist,host,{battle:true})}else{await sleep(400);if(host.isConnected)next()}},
      onWrong:(soft,k)=>{lv.hit(()=>cur,host,n)(soft,k);bo.classList.add('roar');setTimeout(()=>{bo.classList.remove('roar');hero.classList.add('ouch');setTimeout(()=>hero.classList.remove('ouch'),400)},300)}})}}

// ---------- 心：认真答错扣一颗，用完这一关就结束 ----------
function livesUI(){const cfg=S().cfg||{};const max=cfg.lives==null?3:cfg.lives;let lives=max;const missed=[];let over=false;
  const e=el('div','hearts');const draw=()=>{e.innerHTML=max?'❤️'.repeat(lives)+'<span class="dim">'+'🤍'.repeat(max-lives)+'</span>':''};draw();
  const hit=(getCur,host,n)=>(soft,k)=>{if(soft||!max||over)return;if(k)missed.push(k);lives--;draw();bounce(e);
    if(lives<=0){over=true;const cur=getCur();if(cur){cur._d=1;cur.cleanup&&cur.cleanup()}setTimeout(()=>{if(host.isConnected)strikeOut(n,missed,host)},700)}};
  return{el:e,max,hit}}
const NOTVOC=new Set(['比多少','大小','影子']);
const isVoc=k=>typeof k==='string'&&!NOTVOC.has(k)&&[...k].every(c=>D.KNOWN.has(c)||/[，。！？]/.test(c));
const itemBtns=items=>{const g=el('div','itemlist');items.forEach(t=>{const b=el('button','opt wordopt',H.tzw(t));b.onclick=()=>{bounce(b);say(t)};g.append(b)});return g};
async function strikeOut(n,missed,host){
  stop();const s=S();s.adapt=0;s.pstreak=0;save();host.innerHTML='';
  const items=[...new Set(missed)].filter(isVoc).slice(0,6);
  const card=el('div','storycard',`<div class="sico">💔</div><h2>心用完啦</h2><p>这一关有点难，我们先休息一下，等会儿再来挑战！</p>`);
  if(items.length){card.append(el('div','ctitle','和妈妈一起看看这几个（点一下听一听）：'),itemBtns(items))}
  const b=el('button','pbtn good big','👩 去亲子时间');b.onclick=()=>startBreak('strike',items);card.append(b);host.append(card);
  SFX.no();await say('心用完啦！这一关有点难，我们先休息一下。');if(items.length)say('和妈妈一起看看这几个。')}

// ---------- 亲子时间：游戏锁住，做完线下任务、妈妈确认才能继续 ----------
const TASKS=[['📖','和妈妈一起看一本书','看完一本，或者看 10 分钟。看到认识的字，指给妈妈看！'],['🧱','和妈妈用积木搭一座真房子','先搭下面再搭上面，搭好数一数用了几块。'],['🔴','在家里找 5 个红色的东西','找到一个，就说：“这是红色的。”'],['🪜','和妈妈一起数楼梯或者数筷子','数到 10，再倒着数回来。'],['🦖','和妈妈一起画一只恐龙','画好给它起个名字。'],['🙋','和妈妈玩“我说你做”','把小熊放在桌子的上面、下面、前面、后面。'],['🤸','做 10 个恐龙跳，再喝一杯水','跳的时候大声数：一、二、三……'],['🗣️','给妈妈讲一讲今天学了什么','说说今天遇到了哪只恐龙，认识了哪些字。'],['🧩','和妈妈玩一个真的拼图或者翻牌',''],['🌳','和妈妈到窗边或楼下看一看','找一找：树、花、小鸟、小狗。']];
function startBreak(reason,items){const s=S();const cfg=s.cfg||{};const mins=cfg.brk||10;s.brk={until:Date.now()+mins*60000,task:rnd(TASKS.length),items:items||[],reason};s.sess=null;save();show(breakNode())}
function holdBtn(label,ms,cb,cls='pbtn good big'){const b=el('button',cls+' hold',label);b.style.setProperty('--hold',ms+'ms');let t=0;
  const start=e=>{e.preventDefault();b.classList.add('holding');t=setTimeout(cb,ms)};const end=()=>{clearTimeout(t);b.classList.remove('holding')};
  b.addEventListener('pointerdown',start);b.addEventListener('pointerup',end);b.addEventListener('pointerleave',end);b.addEventListener('pointercancel',end);return b}
function breakNode(){
  const s=S();const B=s.brk;const T=TASKS[B.task%TASKS.length];
  const v=el('div','screen brk');v.style.backgroundImage='url(assets/img/bg_river.webp)';
  const card=el('div','card-c brkcard',`<div class="sico">${T[0]}</div><h2>亲子时间</h2><div class="btask">${esc(T[1])}</div>${T[2]?`<p>${esc(T[2])}</p>`:''}`);
  if(B.items&&B.items.length){card.append(el('div','ctitle','先和妈妈一起读一读：'),itemBtns(B.items))}
  const timer=el('div','btimer');const zone=el('div','vbtns');
  const fin=()=>{const s=S();s.brk=null;s.sess=null;save();bigConfetti();SFX.fanfare();say('完成啦！真棒！');setTimeout(home,800)};
  const confirm=holdBtn('👩 妈妈按住：完成啦',2000,fin);
  const early=holdBtn('家长按住 3 秒：提前结束',3000,fin,'pbtn ghost');
  let announced=false;
  const tick=()=>{if(v.isConnected)v._on=1;else if(v._on)return clearInterval(iv);const ms=B.until-Date.now();
    if(ms>0){const m=Math.floor(ms/60000),sec=Math.floor(ms%60000/1000);timer.textContent=`⏳ ${m}:${String(sec).padStart(2,'0')}`;if(!zone.contains(early)){zone.innerHTML='';zone.append(early)}}
    else{timer.textContent='⏰ 时间到！';if(!zone.contains(confirm)){zone.innerHTML='';zone.append(confirm)}if(!announced){announced=true;SFX.fanfare();say('时间到啦！请妈妈来确认。')}}};
  const iv=setInterval(tick,1000);tick();
  card.append(timer,zone,el('div','pnote','游戏先锁住。做完了，请妈妈按住按钮确认。'));
  const par=el('button','parentbtn','⚙️ 家长');par.onclick=parentGate;
  v.append(card,par);
  setTimeout(()=>{if(v.isConnected&&!announced)say('亲子时间！',T[1])},500);
  return v}
// 连续玩太久也要休息
function touchSession(){const s=S();const now=Date.now();if(!s.sess||now-s.sess.last>15*60000)s.sess={start:now,last:now};else s.sess.last=now;save()}
function sessionOver(){const s=S();const lim=(s.cfg&&s.cfg.sess!=null)?s.cfg.sess:20;return !!(lim&&s.sess&&Date.now()-s.sess.start>=lim*60000)}
function timeUp(){const s=S();const m=Math.round((Date.now()-s.sess.start)/60000);const w=el('div','timeup',`<p>已经玩了 ${m} 分钟啦，眼睛要休息一下！</p>`);
  const b=el('button','pbtn good big','👩 去亲子时间');b.onclick=()=>startBreak('time',[]);w.append(b);setTimeout(()=>say('玩了好久啦，我们休息一下吧！'),2200);return w}

// ---------- 题板（所有题型共用）----------
function runStage(type,{w,host,hero,bg,onDone,onWrong,compact}){
  const panel=el('div','panel'+(compact?' compact':''));const head=el('div','phead');const rb=el('button','replay','🔊');const tx=el('div','ptext');head.append(rb,tx);
  const body=el('div','pbody');panel.append(head,body);host.append(panel);
  const ctx={w,box:body,hero:hero||S().hero,bg,mist:0,wide:wide(),
    prompt(t,fn){tx.textContent=t;ctx.replay=fn||(()=>say(t))},replay(){},
    right(e,k){SFX.ok();burstAt(e,30);C.markRight(k)},
    wrong(e,k,re,o){SFX.no();shake(e);const soft=!!(o&&o.soft);if(!soft){C.markMiss(k);ctx.mist++}if(onWrong)onWrong(soft,k);setTimeout(()=>{if(!ctx._d)(re||ctx.replay)()},450)},
    done(){if(ctx._d)return;ctx._d=1;if(ctx.cleanup)ctx.cleanup();touchSession();onDone(ctx)}};
  rb.onclick=()=>{bounce(rb);ctx.replay()};
  window.__ctx=ctx;
  onLeave(()=>{ctx._d=1;ctx.cleanup&&ctx.cleanup()});
  try{G[type](ctx)}catch(err){console.error(type,err);body.textContent='（这题出错了，跳过）';setTimeout(()=>ctx.done(),800)}
  return ctx}

// ---------- 游乐场 ----------
function arcade(){
  const v=el('div','screen arcade');v.style.backgroundImage='url(assets/img/bg_falls.webp)';
  v.append(topbar(),el('h2','wname','🎪 游乐场'),el('div','asub','每玩一局：🔥 +3　🍖 +1　🪙 +1'));
  const g=el('div','agrid');
  const A=[['🦖','恐龙对对碰',()=>pickOpt('恐龙对对碰',[['3 对',3],['4 对',4],['6 对',6],['8 对',8]],n=>pickOpt('配什么？',[['🦕 恐龙配恐龙','dino'],['词语 配 图','ch'],['A 配 a','en']],m=>playArcade('memory',{n,m})))],
    ['🍬','恐龙消消乐',()=>pickOpt('恐龙消消乐',[['🦕 恐龙版','dino'],['📝 认字版','ch']],m=>playArcade('match3',{m}))],
    ['🧩','拼图',()=>pickOpt('拼几块？',[['2 块',2],['4 块',4],['6 块',6],['9 块',9]],n=>pickDino(id=>playArcade('puzzle',{n,id})))],
    ['🔨','打恐龙地鼠',()=>playArcade('whack')],['🥚','孵蛋找字',()=>playArcade('eggs')],['🪨','跳石头',()=>playArcade('stones')],['🔍','找不同',()=>playArcade('find')],['🔢','按顺序点',()=>playArcade('schulte')],['🔗','连一连',()=>playArcade('line')]];
  const MA=[['🏠','搭房子','house'],['👆','数一数','count'],['🧺','拿给恐龙','give'],['⚖️','比多少','more'],['➕','合起来','add'],['🚂','排排队','numorder'],['🔁','找规律','pattern'],['🗂️','分一分','sort'],['📏','大小排队','size'],['🌳','上下前后','spatial'],['🔺','找形状','shape'],['👤','影子配对','shadow'],['🤔','哪个不一样','oddone'],['🧩','小数独','sudoku'],['🔢','数字连连看','qmatch']];
  const mg=el('div','agrid');MA.forEach(([i,n,t])=>{const b=el('button','abtn',`<span class="mi">${i}</span><span class="mn">${n}</span>`);b.onclick=()=>{SFX.pop();say(n);playArcade(t)};mg.append(b)});
  A.forEach(([i,n,f])=>{const b=el('button','abtn',`<span class="mi">${i}</span><span class="mn">${n}</span>`);b.onclick=()=>{SFX.pop();say(n);f()};g.append(b)});
  const sc=el('div','ascroll');sc.append(el('div','ctitle','🎮 好玩的'),g,el('div','ctitle','🧮 数学和动脑'),mg);
  v.append(sc);show(v);say('游乐场')}
function pickOpt(title,opts,cb){const host=el('div','overlay');const box=el('div','ovbox',`<h2>${esc(title)}</h2>`);const g=el('div','opts');g.style.setProperty('--cols',Math.min(4,opts.length));
  opts.forEach(([l,val])=>{const b=el('button','opt optl',esc(l));b.onclick=()=>{SFX.pop();host.remove();cb(val)};g.append(b)});
  const x=el('button','tbtn close','✕');x.onclick=()=>host.remove();box.append(g,x);host.append(box);document.body.append(host)}
function pickDino(cb){const host=el('div','overlay');const box=el('div','ovbox',`<h2>拼哪只恐龙？</h2>`);const g=el('div','dpick');
  D.DINOS.forEach(d=>{const b=el('button','dp',`<img src="${dimg(d.id)}" alt=""><span>${esc(d.n)}</span>`);b.onclick=()=>{SFX.pop();host.remove();say(d.n);cb(d.id)};g.append(b)});
  const x=el('button','tbtn close','✕');x.onclick=()=>host.remove();box.append(g,x);host.append(box);document.body.append(host)}
function playArcade(type,o={}){
  C.newLevelSession();
  const W=curW();const v=el('div','screen level');v.style.backgroundImage=`url(assets/img/bg_${H.BGS[rnd(H.BGS.length)]}.webp)`;
  v.append(topbar(arcade));const host=el('div','stagehost');v.append(host);show(v);
  const done=async(ctx)=>{host.innerHTML='';const s=S();s.food+=1;save();const c=el('div','storycard win','<h2>真棒！</h2><div class="rew">🔥 +3　🍖 +1　🪙 +1</div>');
    const again=el('button','pbtn good big','🔁 再玩一次');again.onclick=()=>playArcade(type,o);const back=el('button','pbtn','🎪 游乐场');back.onclick=arcade;const hb=el('button','pbtn','🥚 孵蛋屋');hb.onclick=hatchery;
    const b=el('div','vbtns');b.append(again,back,hb);c.append(b);host.append(c);if(sessionOver()){b.remove();c.append(timeUp())}bigConfetti();SFX.fanfare();addCoins(1,c);addWarm(3,c);const f=$('#foodBox b');if(f)f.textContent=s.food;say('真棒！')};
  const ctx=runStage(type==='memory'||type==='match3'||type==='puzzle'?'_arcade':type,{w:Object.assign({},W,{pairs:o.n||W.pairs}),host,onDone:done});
  if(type==='memory'){ctx.box.innerHTML='';const n=o.n;
    if(o.m==='dino'){const ds=shuffle(D.DINOS).slice(0,n);H.memoryGame(ctx,ds.map(d=>({a:`<img class="mimg" src="${dimg(d.id)}" alt="">`,b:`<img class="mimg" src="${dimg(d.id)}" alt="">`,k:d.id,say:d.n})),{prompt:'恐龙对对碰！找出两只一样的恐龙',preview:2200+n*150})}
    else if(o.m==='en'){const Ls=shuffle(D.EN.L).slice(0,Math.min(9,n));H.memoryGame(ctx,Ls.map(L=>({a:`<span class="lat">${L[0]}</span>`,b:`<span class="lat">${L[1]}</span>`,k:'L'+L[0],say:L[0]})),{prompt:'记忆翻牌！大写字母和小写字母配成一对。'})}
    else{const P=H.withPic(D.WD).filter(x=>x[0].length<=3);const f=C.pick(P);const rest=H.uniqEmo(f,P,n-1);H.memoryGame(ctx,[f,...rest].map(x=>({a:H.tzw(x[0]),b:H.emo(x[1]),k:x[0],say:x[0]})),{prompt:'记忆翻牌！把词语和图配成一对。'})}}
  if(type==='match3'){ctx.box.innerHTML='';
    if(o.m==='dino'){const ds=shuffle(D.DINOS).slice(0,5);H.match3(ctx,{tiles:ds.map((d,i)=>({k:d.id,html:`<img src="${dimg(d.id)}" alt="">`,color:H.CANDY[i]})),goal:15,size:6,prompt:`恐龙消消乐！三只一样的恐龙排一排，消掉${ds[0].n}`,sayT:ds[0].n})}
    else{G.match3(ctx)}}
  if(type==='puzzle'){ctx.box.innerHTML='';H.puzzle(ctx,{n:o.n,dino:o.id,bg:H.BGS[rnd(H.BGS.length)]})}}
G._arcade=ctx=>{ctx.prompt('',()=>{})};

// ---------- 恐龙小镇：搭好的房子都在这里 ----------
function town(){
  const s=S();const M=G._math;const hs=s.town||[];
  const v=el('div','screen park town');v.style.backgroundImage='url(assets/img/bg_river.webp)';
  v.append(topbar());
  const head=el('div','phd',`<h2 class="wname">🏘️ 恐龙小镇</h2><div class="asub">搭了 ${hs.length} 座房子</div>`);
  const b=el('button','pbtn good','🔨 去搭房子');b.onclick=()=>playArcade('house');head.append(b);
  const field=el('div','tfield');
  if(!hs.length)field.innerHTML='<div class="empty card-c">还没有房子。闯关或者去游乐场“搭房子”，搭好的房子会住进小镇！</div>';
  hs.forEach((h,i)=>{const c=el('div','thouse',M.houseMini(h));const d=s.dinos[i%Math.max(1,s.dinos.length)];if(d){c.insertAdjacentHTML('beforeend',`<img class="tdino" src="${dimg(d.id)}" alt="">`)}field.append(c)});
  v.append(head,field);show(v);say(hs.length?'恐龙小镇':'去搭房子吧！')}

// ---------- 恐龙乐园 / 图鉴 ----------
const STAGE=['宝宝','小恐龙','大恐龙'];const GROW=[5,15];
function park(){
  const s=S();const v=el('div','screen park');v.style.backgroundImage='url(assets/img/bg_grass.webp)';
  v.append(topbar());
  const head=el('div','phd',`<h2 class="wname">🦕 恐龙乐园</h2><div class="asub">收集了 ${new Set(s.dinos.map(d=>d.id)).size} / 15 种 · 长大的 ${s.dinos.filter(d=>d.stage===2).length} 只</div>`);
  const buy=el('button','pbtn','🪙5 → 🍖1 买食物');buy.onclick=()=>{if(s.coins<5){say('金币不够啦，去冒险赚金币吧！');shake(buy);return}s.coins-=5;s.food++;save();SFX.coin();park()};
  head.append(buy);
  const field=el('div','field');
  s.dinos.forEach((d,i)=>{const info=DN(d.id);const b=el('button','pd st'+d.stage,`<img src="${dimg(d.id)}" alt=""><span class="pn">${esc(info.n)}</span><span class="pst">${STAGE[d.stage]}</span>${s.hero===d.id?'<span class="crown">⭐</span>':''}`);b.style.animationDelay=(i*.7)+'s';b.onclick=()=>dinoCard(d);field.append(b)});
  const dex=el('div','dex');D.DINOS.forEach(info=>{const has=s.dinos.some(d=>d.id===info.id);const b=el('div','dx'+(has?'':' no'),`<img src="${dimg(info.id)}" alt=""><span>${has?esc(info.n):'？'}</span>`);dex.append(b)});
  v.append(head,field,el('div','ctitle','恐龙图鉴'),dex);show(v);
  if(!s.dinos.length)say('还没有恐龙。去孵蛋屋孵蛋吧！')}
function dinoCard(d){
  const s=S();const info=DN(d.id);const host=el('div','overlay');const box=el('div','ovbox dcard');
  const need=d.stage<2?GROW[d.stage]:0;
  box.innerHTML=`<img class="dbig st${d.stage}" src="${dimg(d.id)}" alt=""><h2>${esc(info.n)} <small>${STAGE[d.stage]}</small></h2>${d.stage<2?`<div class="tbar"><i style="width:${Math.min(100,d.fed/need*100)}%"></i></div><div class="tnum">喂 ${d.fed} / ${need} 次就长大</div>`:'<div class="tnum">🏅 已经是大恐龙啦！</div>'}<p>${esc(info.f)}</p>`;
  const btns=el('div','vbtns');
  const feed=el('button','pbtn good',`${info.food} 喂食（有 ${s.food}）`);feed.disabled=d.stage>=2;
  feed.onclick=async()=>{if(s.food<=0){say('没有食物了，去冒险或者去游乐场找食物吧！');shake(feed);return}
    s.food--;d.fed++;SFX.chomp();flyTo(feed,'.dbig',info.food);bounce(box.querySelector('.dbig'));
    if(d.stage<2&&d.fed>=GROW[d.stage]){d.stage++;save();SFX.fanfare();bigConfetti();await say(info.n,'长大啦！');host.remove();dinoCard(d);return}
    save();say('好吃！');feed.textContent=`${info.food} 喂食（有 ${s.food}）`;box.querySelector('.tnum').textContent=`喂 ${d.fed} / ${GROW[d.stage]} 次就长大`;box.querySelector('.tbar i').style.width=Math.min(100,d.fed/GROW[d.stage]*100)+'%'};
  const hero=el('button','pbtn','⭐ 当英雄');hero.onclick=()=>{s.hero=d.id;save();say(info.n,'出发！');host.remove();park()};
  const read=el('button','pbtn','🔊 听介绍');read.onclick=()=>say(info.n,info.f);
  btns.append(feed,hero,read);box.append(btns);
  const x=el('button','tbtn close','✕');x.onclick=()=>{stop();host.remove()};box.append(x);host.append(box);document.body.append(host);say(info.n)}

// ---------- 家长 ----------
function parentGate(){const host=el('div','overlay');const box=el('div','ovbox','<h2>家长入口</h2><p>按住下面的按钮 2 秒</p>');const b=el('button','pbtn hold','按住');let t=0;
  const start=()=>{b.classList.add('holding');t=setTimeout(()=>{host.remove();parent()},2000)};const end=()=>{clearTimeout(t);b.classList.remove('holding')};
  b.addEventListener('pointerdown',start);b.addEventListener('pointerup',end);b.addEventListener('pointerleave',end);
  const x=el('button','tbtn close','✕');x.onclick=()=>host.remove();box.append(b,x);host.append(box);document.body.append(host)}
function parent(){
  const s=S();const v=el('div','screen parent');
  const miss=Object.entries(s.miss).filter(x=>x[1]>=1).sort((a,b)=>b[1]-a[1]).slice(0,16);
  const nm=k=>k.startsWith('n')&&/^n\d+$/.test(k)?'数字 '+k.slice(1):k.startsWith('L')&&k.length===2?'字母 '+k[1]:k;
  v.innerHTML=`<div class="pwrap"><h2>家长页</h2>
  <div class="pgrid"><div><b>${s.stats.right}</b>答对</div><div><b>${s.stats.wrong}</b>答错</div><div><b>${Math.max(0,s.unlocked-1)}</b>/40 关</div><div><b>${s.dinos.length}</b>只恐龙</div></div>
  <h3>最近容易错的（会自动多出）</h3><div class="misslist">${miss.length?miss.map(([k,v])=>`<span>${esc(nm(k))} <i>×${Math.ceil(v)}</i></span>`).join(''):'还没有错题'}</div>
  <h3>说明</h3><ul class="pl"><li>只用《小羊上山》第 1–3 级总字表（照片）里的字。第 1、2 级的字不单独考，只出现在词语和句子里；单字题只考第 3 级新字和容易混的字（很/狼、我/找、爬/把/爸、在/再……）。</li><li>第 1–10 关词语，11–25 关短语，26–40 关句子。一开始就是 4 个选项，干扰项故意找长得像的词（小猫 / 黑猫 / 小狗）。连续两关只错 0–1 次，下一关多一个选项。</li><li>每关 3 颗心：认真答错一次扣一颗（翻牌、拼图这类试来试去的不扣）。心用完这一关就结束，列出错的字词，请和孩子一起看一看，然后进入亲子时间。</li><li>亲子时间：游戏锁住，给一个线下任务（看书、搭积木、找颜色、数数……），倒计时结束后要家长按住按钮确认才能继续。连续玩够设定的时间也会进入亲子时间。</li><li>每关 9 题：3 道认字、1 道开口说、2 道数学、2 道英语、1 个小游戏。第 4 关小对战，第 8 关大魔王。</li><li>数学和动脑（参考《3–6 岁儿童学习与发展指南》4–5 岁的目标）：手口一致点数到 10、按数取物、比多少、数字排排队、找规律（AB → AAB/ABB → ABC/AABB）、分类、大小排序、上下前后里、认图形、影子配对、哪个不一样、3×3 小数独、照图纸搭房子（先下后上）。后面的世界有 5 以内、10 以内的加减（用实物，不背算式），这是 5–6 岁的目标，先慢慢接触。</li><li>孵蛋按天算：普通蛋至少 3 天（60 🔥）、稀有蛋 5 天（120 🔥）、金蛋 7 天（200 🔥），每天答题能加的温度有上限，照顾蛋另外加。满了还要再答 5–8 题帮它破壳。孵出来后喂食长大（宝宝 → 小恐龙 → 大恐龙）。</li><li>“跟读 / 大声读”：浏览器支持时可以点 🎤 识别；不支持时请家长听，读对了点“读对了”。</li></ul>
  <h3>设置</h3></div>`;
  const w=v.querySelector('.pwrap');
  const cfg=s.cfg=s.cfg||{};
  const setting=(label,key,opts,def)=>{const r=el('div','setrow',`<b>${label}</b>`);const g=el('div','setopts');
    opts.forEach(([l,val])=>{const cur=cfg[key]==null?def:cfg[key];const b=el('button','pbtn'+(cur===val?' good':''),l);b.onclick=()=>{cfg[key]=val;save();parent()};g.append(b)});r.append(g);return r};
  w.append(setting('答错几次，这一关结束','lives',[['3 次',3],['5 次',5],['不限',0]],3),setting('亲子时间多久（分钟）','brk',[['5',5],['10',10],['15',15]],10),setting('连续玩多久要休息（分钟）','sess',[['15',15],['20',20],['30',30],['不限',0]],20));
  if(s.brk){const e=el('button','pbtn danger','⏹ 结束现在的亲子时间');e.onclick=()=>{s.brk=null;s.sess=null;save();bubble('已结束')};w.append(e)}
  const row=el('div','vbtns');
  const ul=el('button','pbtn','🔓 解锁全部关卡');ul.onclick=()=>{s.unlocked=41;save();bubble('已解锁')};
  const eg=el('button','pbtn','🥚 给一颗蛋（测试）');eg.onclick=()=>{newEgg(1+rnd(3));bubble('已加一颗蛋')};
  const rs=el('button','pbtn danger','🗑️ 清空存档');let armed=false;rs.onclick=()=>{if(!armed){armed=true;rs.textContent='再点一次确认清空';return}C.setS(C.fresh());save();home()};
  const bk=el('button','pbtn good','← 返回');bk.onclick=home;
  row.append(bk,ul,eg,rs);w.append(row);show(v)}

window.SCREENS={_addWarm:addWarm,town,home,worldMap,startLevel,hatchery,park,arcade,ceremony,runStage,levelPlan,newEgg,parent};
})();
