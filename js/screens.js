// 页面：首页、世界地图、关卡、对战、孵蛋屋、恐龙乐园、游乐场、家长
(function(){
const D=window.DATA,G=window.GAMES,H=G._helpers;
const {$,el,esc,rnd,shuffle,sleep,say,stop,SFX,bubble,flyTo,bounce,shake,burstAt,bigConfetti,save,today}=C;
const S=()=>C.S();
const dimg=H.dimg;
const DN=id=>D.DINOS.find(d=>d.id===id);
const app=()=>$('#app');
let cleanupFns=[];
function show(node){stop();cleanupFns.forEach(f=>{try{f()}catch(e){}});cleanupFns=[];document.querySelectorAll('.pzp.drag').forEach(p=>p.remove());const a=app();a.innerHTML='';a.append(node);window.scrollTo(0,0)}
const onLeave=f=>cleanupFns.push(f);
const wide=()=>innerWidth>innerHeight*1.15;

// ---------- 蛋 ----------
const NEED={1:30,2:55,3:90};
const STEPS={1:4,2:5,3:6};
const RNAME={1:'恐龙蛋',2:'稀有蛋',3:'金蛋'};
function newEgg(r){const s=S();const own=new Set(s.dinos.map(d=>d.id).concat(s.eggs.map(e=>e.dino)));
  const pool=D.DINOS.filter(d=>d.r===r);const fresh=pool.filter(d=>!own.has(d.id));const d=(fresh.length?fresh:pool)[rnd((fresh.length?fresh:pool).length)];
  const e={id:'e'+Date.now()+rnd(1000),r,dino:d.id,warm:0,need:NEED[r],pat:rnd(4)};s.eggs.push(e);if(!s.inc)s.inc=e.id;save();return e}
const incEgg=()=>{const s=S();return s.eggs.find(e=>e.id===s.inc)||null};
function eggHTML(e,cls=''){const p=e?Math.min(1,e.warm/e.need):0;const st=p>=1?4:p>=.75?3:p>=.5?2:p>=.25?1:0;
  return `<div class="egg r${e?e.r:1} pat${e?e.pat:0} st${st} ${cls}"><svg viewBox="0 0 100 130" class="cracks"><path class="c1" d="M18 58 L30 50 L38 61 L50 52"/><path class="c2" d="M50 52 L61 63 L71 54 L84 62"/><path class="c3" d="M30 86 L41 78 L49 89 L60 80 L72 91"/><path class="c4" d="M12 72 L26 66 L35 76 L48 68 L57 79 L70 70 L88 78"/></svg></div>`}
function addWarm(n,fromEl){const e=incEgg();if(!e||n<=0)return;const before=e.warm/e.need;e.warm=Math.min(e.need,e.warm+n);save();
  if(fromEl)flyTo(fromEl,'#warmBox','🔥','fly fire');
  setTimeout(updateWarm,fromEl?850:0);
  const after=e.warm/e.need;[.25,.5,.75].forEach(q=>{if(before<q&&after>=q){setTimeout(()=>{SFX.crack();bubble('🥚 蛋动了一下！')},900)}});
  if(before<1&&after>=1)setTimeout(()=>{SFX.fanfare();bubble('🐣 蛋快孵出来了！快去孵蛋屋！',2400)},1000)}
function updateWarm(){const b=$('#warmBox');if(!b)return;const e=incEgg();b.innerHTML=e?`${eggHTML(e,'mini')}<span>${Math.floor(e.warm/e.need*100)}%</span>`:'<span>🥚 —</span>'}
function addCoins(n,fromEl){S().coins+=n;save();if(fromEl)for(let i=0;i<Math.min(n,4);i++)setTimeout(()=>flyTo(fromEl,'#coinBox','🪙'),i*120);setTimeout(()=>{const b=$('#coinBox b');if(b)b.textContent=S().coins},950);SFX.coin()}

function topbar(back){const t=el('div','topbar');const h=el('button','tbtn','🏠');h.onclick=back||home;
  const coin=el('div','chip','🪙 <b>'+S().coins+'</b>');coin.id='coinBox';
  const warm=el('button','chip warm');warm.id='warmBox';warm.onclick=hatchery;
  const food=el('div','chip','🍖 <b>'+S().food+'</b>');food.id='foodBox';
  t.append(h,el('div','grow'),food,coin,warm);setTimeout(updateWarm);return t}

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
  const e=incEgg();const ready=e&&e.warm>=e.need;
  const items=[['🗺️','冒险地图',`第 ${Math.min(40,s.unlocked)} 关`,worldMap,'big'],['🥚','孵蛋屋',ready?'快孵出来了！':`${s.eggs.length} 颗蛋`,hatchery,ready?'pulse':''],['🎪','游乐场','对对碰·消消乐·拼图',arcade,''],['🦕','恐龙乐园',`${s.dinos.length} 只恐龙`,park,'']];
  items.forEach(([i,n,sub,f,c])=>{const b=el('button','mbtn '+c,`<span class="mi">${i}</span><span class="mn">${n}</span><span class="ms">${esc(sub)}</span>`);b.onclick=()=>{SFX.pop();f()};grid.append(b)});
  const par=el('button','parentbtn','⚙️ 家长');par.onclick=parentGate;
  v.append(title,hero,grid,par);show(v);
  hero.onclick=()=>{SFX.jump();bounce(hero);say(DN(s.hero).n)}}
function dailyGift(){const s=S();if(s.gift===today())return;s.gift=today();const wait=s.eggs.length;if(wait>=4){save();return}
  const e=newEgg(Math.random()<.2?2:1);setTimeout(()=>{bubble('🎁 今天的礼物：一颗'+RNAME[e.r]+'！',2600);say('找到一颗恐龙蛋！')},600)}

// ---------- 第一次：选蛋、孵出英雄 ----------
function intro(){
  const v=el('div','screen intro');v.style.backgroundImage='url(assets/img/bg_jungle.webp)';
  const card=el('div','card-c');
  card.innerHTML='<h1 class="title">恐龙认字<span>大冒险</span></h1><p class="lead">选一颗恐龙蛋，答对题它就会孵出来！</p>';
  const row=el('div','eggpick');
  const starters=shuffle(D.DINOS.filter(d=>d.r===1)).slice(0,3);
  starters.forEach((d,i)=>{const e={id:'start'+i,r:1,dino:d.id,warm:0,need:1,pat:i};const b=el('button','eggbtn',eggHTML(e,'wob'));b.onclick=()=>{C.ac();SFX.pop();const s=S();s.started=true;s.eggs=[];s.inc=null;const eg={id:'e0',r:1,dino:d.id,warm:1,need:1,pat:i};s.eggs.push(eg);s.inc=eg.id;save();ceremony(eg,{first:true})};row.append(b)});
  const go=el('button','pbtn good','🔊 开始');go.onclick=()=>{C.ac();say('选一颗恐龙蛋！','答对三题，恐龙蛋就会孵出来！')};
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
  const W=curWorld();
  const setCrack=()=>{const e=eggEl.querySelector('.egg');e.className=e.className.replace(/st\d/,'st'+Math.min(4,Math.ceil(k/steps*4)))};
  const types=['hear','match','hear','pic','hear','word'];
  const next=()=>{panelHost.innerHTML='';runStage(types[k%types.length],{w:W,host:panelHost,compact:true,onDone:async(ctx)=>{
      k++;bar.children[k-1].classList.add('on');SFX.crack();setCrack();eggEl.classList.remove('jump');void eggEl.offsetWidth;eggEl.classList.add('jump');
      if(k===2)say('蛋裂开了！');
      if(k<steps){await sleep(700);if(panelHost.isConnected)next()}else{panelHost.innerHTML='';await sleep(600);if(panelHost.isConnected)hatch()}}})};
  async function hatch(){
    const d=DN(egg.dino);eggEl.innerHTML=`<div class="shell top"></div><div class="shell bot"></div><img class="born" src="${dimg(d.id)}" alt="">`;
    SFX.boom();bigConfetti();SFX.fanfare();
    const s=S();s.eggs=s.eggs.filter(e=>e.id!==egg.id);if(s.inc===egg.id)s.inc=s.eggs[0]?s.eggs[0].id:null;
    s.dinos.push({id:d.id,uid:'d'+Date.now(),stage:0,fed:0});if(first||!s.hero)s.hero=d.id;
    if(first){const e2=newEgg(1);e2.need=20}
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
  const p=e.warm/e.need;
  const nest=el('div','nest',`<div class="lamp ${p>=1?'hot':''}">💡</div>${eggHTML(e,'huge wob'+(p>=.5?' wob2':''))}<div class="hay"></div>`);
  const thermo=el('div','thermo',`<div class="tlabel">${RNAME[e.r]} · 温度</div><div class="tbar"><i style="width:${Math.min(100,p*100)}%"></i></div><div class="tnum">${e.warm} / ${e.need} 🔥</div>`);
  const tip=el('div','htip',p>=1?'蛋在动！快帮它出来！':p>=.75?'蛋里有声音：咚咚咚！':p>=.5?'蛋上有裂缝了！':p>=.25?'蛋动了一下……':'每答对一题，蛋就暖和一点。');
  main.append(nest,thermo,tip);
  if(p>=1){const b=el('button','pbtn good big pulse','🐣 帮它出来！');b.onclick=()=>ceremony(e);main.append(b)}
  // 每天照顾蛋
  const care=el('div','care');const ct=s.care[today()]||{};
  const CARE=[['blanket','🧣','盖被子'],['rub','🧽','擦一擦'],['sing','🎵','跟它说话'],['story','📖','读给它听']];
  CARE.forEach(([k,i,n])=>{const b=el('button','cbtn'+(ct[k]?' done':''),`<span>${i}</span>${n}${ct[k]?' ✔':''}`);b.disabled=!!ct[k]||p>=1;b.onclick=()=>doCare(k,e);care.append(b)});
  main.append(el('div','ctitle','每天照顾它（每样一天一次，+3 🔥）'),care);
  // 蛋篮子
  const basket=el('div','basket');s.eggs.filter(x=>x.id!==s.inc).forEach(x=>{const b=el('button','bk',eggHTML(x,'small')+`<span>${Math.floor(x.warm/x.need*100)}%</span>`);b.onclick=()=>{s.inc=x.id;save();SFX.pop();hatchery()};basket.append(b)});
  if(basket.children.length)main.append(el('div','ctitle','篮子里的蛋（点一下换着孵）'),basket);
  v.append(main);show(v);
  nest.querySelector('.egg').onclick=ev=>{SFX.tick();shake(ev.currentTarget);say(p>=1?'快帮我出来！':p>=.5?'咚咚咚！':'好暖和！')};
  say(p>=1?'蛋在动！快帮它出来！':tip.textContent)}
function doCare(k,e){
  const s=S();const done=()=>{s.care={[today()]:Object.assign(s.care[today()]||{},{[k]:1})};save();addWarm(3);SFX.ok();bigConfetti();setTimeout(hatchery,1200)};
  if(k==='blanket'){const n=$('.nest');n.insertAdjacentHTML('beforeend','<div class="blanket">🧣</div>');say('盖上被子，好暖和！');done();return}
  if(k==='rub'){ // 用手指把蛋上的泥擦掉
    const egg=$('.nest .egg');const mud=el('div','mud');for(let i=0;i<7;i++){const m=el('i');m.style.left=(15+rnd(65))+'%';m.style.top=(15+rnd(65))+'%';mud.append(m)}egg.append(mud);say('蛋脏了，用手指擦一擦！');
    let left=7;mud.addEventListener('pointermove',ev=>{const t=document.elementFromPoint(ev.clientX,ev.clientY);if(t&&t.parentNode===mud&&!t.dataset.x){t.dataset.x=1;t.style.opacity=0;SFX.tick();left--;if(left===0){say('好干净！');done()}}});
    mud.addEventListener('pointerdown',ev=>{const t=ev.target;if(t.parentNode===mud&&!t.dataset.x){t.dataset.x=1;t.style.opacity=0;left--;SFX.tick();if(left===0){say('好干净！');done()}}});return}
  // 跟它说话 = 跟读；读给它听 = 大声读
  const host=el('div','overlay');const box=el('div','ovbox');host.append(box);document.body.append(host);
  runStage(k==='sing'?'speak':'read',{w:curWorld(),host:box,onDone:()=>{host.remove();done()}});
  const x=el('button','tbtn close','✕');x.onclick=()=>{stop();host.remove()};box.append(x)}

// ---------- 世界地图 ----------
const curWorld=()=>D.WORLDS[Math.min(4,Math.floor((Math.min(40,S().unlocked)-1)/8))];
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
  if(k===3)return{battle:true,boss:W.mini,hp:6+wi,W,k};
  if(k===7)return{battle:true,boss:W.boss,hp:8+wi*2,W,k,big:true};
  const c=W.core,e=W.en,M=D.MINI;
  const raw=[c[n%c.length],M[(n*2-2)%M.length],e[n%e.length],c[(n+2)%c.length],M[(n*2-1)%M.length],n%2?'read':'speak',c[(n+4)%c.length],e[(n+2)%e.length]];
  // 同一关里不出两次同样的游戏（英语数字 enum 可以出两次）
  for(let i=1;i<raw.length;i++){if(raw[i]!=='enum'&&raw.slice(0,i).includes(raw[i])){const pool=raw[i].startsWith('e')&&raw[i]!=='eggs'?e:c;const alt=pool.find(x=>!raw.includes(x));if(alt)raw[i]=alt}}
  return{stages:raw,W,k}}
const OBST=['🪨','🌊','🌉','⛰️','🪵','🌵','🔥','🧊','🍄','🌳'];
function startLevel(n){
  const plan=levelPlan(n);if(plan.battle)return battle(n,plan);
  C.newLevelSession();
  const s=S();const W=plan.W;const bg=W.bgs[plan.k];
  const v=el('div','screen level');v.style.backgroundImage=`url(assets/img/bg_${bg}.webp)`;
  v.append(topbar(()=>worldMap(D.WORLDS.indexOf(W))));
  const N=plan.stages.length;
  const prog=el('div','prog');for(let i=0;i<N;i++)prog.append(el('span'));
  const track=el('div','track');const obs=[];
  for(let i=0;i<N;i++){const o=el('div','obst',OBST[(n+i*3)%OBST.length]);o.style.left=(8+(i+1)*(84/(N+1)))+'%';track.append(o);obs.push(o)}
  const flag=el('div','obst flag','🚩');flag.style.left='94%';track.append(flag);
  const hero=el('img','hero');hero.src=dimg(s.hero);hero.style.left='3%';track.append(hero);
  const host=el('div','stagehost');
  v.append(el('div','lvtitle',`第 ${n} 关 · ${esc(W.names[plan.k])}`),prog,host,track);show(v);
  let i=0,mist=0;
  const intro=el('div','storycard',`<div class="sico">${W.ico}</div><h2>第 ${n} 关</h2><div class="sname">${esc(W.names[plan.k])}</div><p>一共 ${N} 个难关，答对就能过去。</p>`);
  const go=el('button','pbtn good big','出发！');intro.append(go);host.append(intro);
  say(`第${n}关，${W.names[plan.k]}`);
  go.onclick=()=>{SFX.pop();say('出发！');next()};
  function next(){host.innerHTML='';
    runStage(plan.stages[i],{w:W,host,hero:s.hero,bg,onDone:async(ctx)=>{
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
  if(k===7)egg=newEgg(3);else if(k===3)egg=newEgg(2);else if(first&&waiting<3)egg=newEgg(n>16&&Math.random()<.35?2:1);
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
  await say(battle?'赢啦！':'过关啦！');if(egg)say('找到一颗恐龙蛋！');
  if(n===40&&battle){await sleep(800);say('你是大王！')}}

// ---------- 对战 ----------
function battle(n,plan){
  C.newLevelSession();
  const s=S();const W=plan.W;const boss=DN(plan.boss);
  const v=el('div','screen level battle');v.style.backgroundImage=`url(assets/img/bg_${W.bgs[plan.k]}.webp)`;
  v.append(topbar(()=>worldMap(D.WORLDS.indexOf(W))));
  const arena=el('div','arena');
  const hero=el('img','bhero');hero.src=dimg(s.hero);
  const bo=el('div','bboss',`<img src="${dimg(boss.id)}" alt=""><div class="hp"></div><div class="bn">${esc(boss.n)}</div>`);
  const hp=bo.querySelector('.hp');let life=plan.hp;const draw=()=>{hp.innerHTML='❤️'.repeat(life)+'<span class="dim">'+'🤍'.repeat(plan.hp-life)+'</span>'};draw();
  arena.append(hero,bo);
  const host=el('div','stagehost');
  v.append(el('div','lvtitle',`第 ${n} 关 · ${plan.big?'👑 ':'⚔️ '}${esc(boss.n)}`),host,arena);show(v);
  const pool=['hear','match','pic','word','enum','eletter',...(W.id>=2?['ctx','cloze','ephon']:[]),...(W.id>=3?['phrase','sent']:[]),...(W.id>=4?['eword']:[])];
  let mist=0,last='';
  const intro=el('div','storycard',`<h2>${esc(boss.n)}来了！</h2><p>${plan.big?'这是大魔王！':'它要考考你！'}每答对一题，就攻击它一次。</p>`);
  const go=el('button','pbtn good big','⚔️ 开战！');intro.append(go);host.append(intro);
  say(boss.n,'哼！我来考考你！');
  go.onclick=()=>{SFX.pop();next()};
  function next(){host.innerHTML='';let t;do{t=pool[rnd(pool.length)]}while(t===last);last=t;
    runStage(t,{w:W,host,compact:true,onDone:async(ctx)=>{mist+=ctx.mist;host.innerHTML='';
      if(!ctx.skipped){hero.classList.add('dash');SFX.whoosh();await sleep(350);SFX.hit();bo.classList.add('hurt');burstAt(bo,30);life--;draw();addCoins(1,bo);addWarm(1,bo);say(['哎哟！','哎哟！好痛！'][rnd(2)]);await sleep(500);hero.classList.remove('dash');bo.classList.remove('hurt')}
      if(!host.isConnected)return;
      if(life<=0){bo.classList.add('ko');SFX.boom();await sleep(1200);if(host.isConnected)finishLevel(n,mist,host,{battle:true})}else{await sleep(400);if(host.isConnected)next()}},
      onWrong:()=>{bo.classList.add('roar');setTimeout(()=>{bo.classList.remove('roar');hero.classList.add('ouch');setTimeout(()=>hero.classList.remove('ouch'),400)},300)}})}}

// ---------- 题板（所有题型共用）----------
function runStage(type,{w,host,hero,bg,onDone,onWrong,compact}){
  const panel=el('div','panel'+(compact?' compact':''));const head=el('div','phead');const rb=el('button','replay','🔊');const tx=el('div','ptext');head.append(rb,tx);
  const body=el('div','pbody');panel.append(head,body);host.append(panel);
  const ctx={w,box:body,hero:hero||S().hero,bg,mist:0,wide:wide(),
    prompt(t,fn){tx.textContent=t;ctx.replay=fn||(()=>say(t))},replay(){},
    right(e,k){SFX.ok();burstAt(e,30);C.markRight(k)},
    wrong(e,k,re){SFX.no();shake(e);C.markMiss(k);ctx.mist++;if(onWrong)onWrong();setTimeout(()=>{if(!ctx._d)(re||ctx.replay)()},450)},
    done(){if(ctx._d)return;ctx._d=1;if(ctx.cleanup)ctx.cleanup();onDone(ctx)}};
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
  const A=[['🦖','恐龙对对碰',()=>pickOpt('恐龙对对碰',[['3 对',3],['4 对',4],['6 对',6],['8 对',8]],n=>pickOpt('配什么？',[['🦕 恐龙配恐龙','dino'],['字 配 图','ch'],['A 配 a','en']],m=>playArcade('memory',{n,m})))],
    ['🍬','恐龙消消乐',()=>pickOpt('恐龙消消乐',[['🦕 恐龙版','dino'],['📝 认字版','ch']],m=>playArcade('match3',{m}))],
    ['🧩','拼图',()=>pickOpt('拼几块？',[['2 块',2],['4 块',4],['6 块',6],['9 块',9]],n=>pickDino(id=>playArcade('puzzle',{n,id})))],
    ['🔨','打恐龙地鼠',()=>playArcade('whack')],['🥚','孵蛋找字',()=>playArcade('eggs')],['🪨','跳石头',()=>playArcade('stones')],['🔍','找不同',()=>playArcade('find')],['🔢','按顺序点',()=>playArcade('schulte')],['🔗','连一连',()=>playArcade('line')]];
  A.forEach(([i,n,f])=>{const b=el('button','abtn',`<span class="mi">${i}</span><span class="mn">${n}</span>`);b.onclick=()=>{SFX.pop();say(n);f()};g.append(b)});
  v.append(g);show(v);say('游乐场')}
function pickOpt(title,opts,cb){const host=el('div','overlay');const box=el('div','ovbox',`<h2>${esc(title)}</h2>`);const g=el('div','opts');g.style.setProperty('--cols',Math.min(4,opts.length));
  opts.forEach(([l,val])=>{const b=el('button','opt optl',esc(l));b.onclick=()=>{SFX.pop();host.remove();cb(val)};g.append(b)});
  const x=el('button','tbtn close','✕');x.onclick=()=>host.remove();box.append(g,x);host.append(box);document.body.append(host)}
function pickDino(cb){const host=el('div','overlay');const box=el('div','ovbox',`<h2>拼哪只恐龙？</h2>`);const g=el('div','dpick');
  D.DINOS.forEach(d=>{const b=el('button','dp',`<img src="${dimg(d.id)}" alt=""><span>${esc(d.n)}</span>`);b.onclick=()=>{SFX.pop();host.remove();say(d.n);cb(d.id)};g.append(b)});
  const x=el('button','tbtn close','✕');x.onclick=()=>host.remove();box.append(g,x);host.append(box);document.body.append(host)}
function playArcade(type,o={}){
  C.newLevelSession();
  const W=curWorld();const v=el('div','screen level');v.style.backgroundImage=`url(assets/img/bg_${H.BGS[rnd(H.BGS.length)]}.webp)`;
  v.append(topbar(arcade));const host=el('div','stagehost');v.append(host);show(v);
  const done=async(ctx)=>{host.innerHTML='';const s=S();s.food+=1;save();const c=el('div','storycard win','<h2>真棒！</h2><div class="rew">🔥 +3　🍖 +1　🪙 +1</div>');
    const again=el('button','pbtn good big','🔁 再玩一次');again.onclick=()=>playArcade(type,o);const back=el('button','pbtn','🎪 游乐场');back.onclick=arcade;const hb=el('button','pbtn','🥚 孵蛋屋');hb.onclick=hatchery;
    const b=el('div','vbtns');b.append(again,back,hb);c.append(b);host.append(c);bigConfetti();SFX.fanfare();addCoins(1,c);addWarm(3,c);const f=$('#foodBox b');if(f)f.textContent=s.food;say('真棒！')};
  const ctx=runStage(type==='memory'||type==='match3'||type==='puzzle'?'_arcade':type,{w:Object.assign({},W,{pairs:o.n||W.pairs}),host,onDone:done});
  if(type==='memory'){ctx.box.innerHTML='';const n=o.n;
    if(o.m==='dino'){const ds=shuffle(D.DINOS).slice(0,n);H.memoryGame(ctx,ds.map(d=>({a:`<img class="mimg" src="${dimg(d.id)}" alt="">`,b:`<img class="mimg" src="${dimg(d.id)}" alt="">`,k:d.id,say:d.n})),{prompt:'恐龙对对碰！找出两只一样的恐龙',preview:2200+n*150})}
    else if(o.m==='en'){const Ls=shuffle(D.EN.L).slice(0,Math.min(9,n));H.memoryGame(ctx,Ls.map(L=>({a:`<span class="lat">${L[0]}</span>`,b:`<span class="lat">${L[1]}</span>`,k:'L'+L[0],say:L[0]})),{prompt:'记忆翻牌！大写字母和小写字母配成一对。'})}
    else{const f=C.pick(D.CH);const rest=H.uniqEmo(f,D.CH,n-1);H.memoryGame(ctx,[f,...rest].map(x=>({a:H.tz(x[0]),b:H.emo(x[1]),k:x[0],say:x[0]})))}}
  if(type==='match3'){ctx.box.innerHTML='';
    if(o.m==='dino'){const ds=shuffle(D.DINOS).slice(0,5);H.match3(ctx,{tiles:ds.map((d,i)=>({k:d.id,html:`<img src="${dimg(d.id)}" alt="">`,color:H.CANDY[i]})),goal:15,size:6,prompt:`恐龙消消乐！三只一样的恐龙排一排，消掉${ds[0].n}`,sayT:ds[0].n})}
    else{G.match3(ctx)}}
  if(type==='puzzle'){ctx.box.innerHTML='';H.puzzle(ctx,{n:o.n,dino:o.id,bg:H.BGS[rnd(H.BGS.length)]})}}
G._arcade=ctx=>{ctx.prompt('',()=>{})};

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
  <h3>说明</h3><ul class="pl"><li>只用《小羊上山》第 1–3 级总字表（照片）里的字，第 1 级字只占约一成，用来复习。</li><li>40 关分 5 个世界：词语 → 短语 → 句子，选项从 3 个加到 5 个，干扰项越来越多用形近字（很/狼、我/找、爬/把/爸……）和同音字（在/再、门/们……放进句子里选）。</li><li>每关 8 题，第 4 关小对战，第 8 关大魔王。</li><li>孵蛋：每答对一题蛋暖和一点，普通蛋 30 🔥、稀有蛋 55 🔥、金蛋 90 🔥；满了还要再答 4–6 题帮它破壳。孵出来后喂食长大（宝宝 → 小恐龙 → 大恐龙）。</li><li>“跟读 / 大声读”：浏览器支持时可以点 🎤 识别；不支持时请家长听，读对了点“读对了”。</li></ul>
  <h3>设置</h3></div>`;
  const w=v.querySelector('.pwrap');const row=el('div','vbtns');
  const ul=el('button','pbtn','🔓 解锁全部关卡');ul.onclick=()=>{s.unlocked=41;save();bubble('已解锁')};
  const eg=el('button','pbtn','🥚 给一颗蛋（测试）');eg.onclick=()=>{newEgg(1+rnd(3));bubble('已加一颗蛋')};
  const rs=el('button','pbtn danger','🗑️ 清空存档');let armed=false;rs.onclick=()=>{if(!armed){armed=true;rs.textContent='再点一次确认清空';return}C.setS(C.fresh());save();home()};
  const bk=el('button','pbtn good','← 返回');bk.onclick=home;
  row.append(bk,ul,eg,rs);w.append(row);show(v)}

window.SCREENS={home,worldMap,startLevel,hatchery,park,arcade,ceremony,runStage,levelPlan,newEgg,parent};
})();
