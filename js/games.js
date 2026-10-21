// 题型和小游戏。每个游戏 GAMES[type](ctx)：ctx.box 是题板，ctx.prompt() 设置题干，ctx.right()/ctx.wrong() 给反馈，ctx.done() 结束这一题。
(function(){
const D=window.DATA,{el,shuffle,rnd,sleep,say,phon,SFX,pick,pickNum,pickLetter,distractChars,esc,bounce,shake,burstAt}=C;
const tz=(c,cls='')=>`<span class="tz ${cls}">${esc(c)}</span>`;
const tzw=w=>`<span class="tzw">${[...w].map(c=>/[，。！？]/.test(c)?`<span class="pun">${c}</span>`:tz(c,'sm')).join('')}</span>`;
const emo=e=>`<span class="emo">${e}</span>`;
const dimg=id=>`assets/img/dino_${id}.webp`;
const PRAISE=['真棒！','答对啦！','太厉害了！','你真棒！','超级棒！'];
const optN=(ctx,max=5)=>Math.min(max,ctx.w.opts);

// 通用选择题
function choices(ctx,opts,{cls='opt',key,onRight,cols}={}){
  const g=el('div','opts');g.style.setProperty('--cols',cols||Math.min(opts.length,opts.length===4?2:opts.length>4?3:opts.length));
  if(opts.length===4&&ctx.wide)g.style.setProperty('--cols',4);
  let wrongs=0,locked=false;
  shuffle(opts).forEach(o=>{const b=el('button',cls,o.html);if(o.ok)b.dataset.ok='1';
    b.onclick=async()=>{if(locked||b.disabled)return;
      if(o.ok){locked=true;b.classList.add('right');ctx.right(b,key);if(onRight)await onRight(o,b);else await sleep(500);ctx.done()}
      else{b.classList.add('nope');b.disabled=true;wrongs++;ctx.wrong(b,key);if(wrongs>=2){const k=g.querySelector('[data-ok]');k&&k.classList.add('hint')}}};
    g.appendChild(b)});
  return g}
function uniqEmo(target,pool,n,getE=x=>x[1]){const out=[],es=new Set([getE(target)]);for(const x of shuffle(pool)){if(out.length>=n)break;const e=getE(x);if(es.has(e)||x[0]===target[0])continue;es.add(e);out.push(x)}return out}
function bigShow(html){return el('div','show',html)}

const G={};

const ph=ctx=>ctx.w.phase||1;
const withPic=L=>L.filter(x=>x[1]);
// 词语/短语干扰项：优先找有相同字的（小猫 → 黑猫、小狗），要认真看才能分清
function simItems(t,pool,n,{pic=false,strict=pic}={}){
  const share=x=>[...new Set(t[0])].filter(c=>x[0].includes(c)).length;
  const core=w=>w.replace(/[，。！？]/g,'');const tail=w=>core(w).slice(-1);
  // 看图的题：干扰项不能和答案说的是同一种东西（小猫/黑猫、小牛/老牛），也不能互相包含（小兔/小白兔）
  const clash=x=>strict&&(tail(x[0])===tail(t[0])||core(x[0]).includes(core(t[0]))||core(t[0]).includes(core(x[0])));
  const es=new Set([t[1]]);const out=[];
  const cand=shuffle(pool.filter(x=>x[0]!==t[0])).sort((a,b)=>share(b)-share(a));
  for(const x of cand){if(out.length>=n)break;if(clash(x))continue;if(pic&&(!x[1]||es.has(x[1])))continue;if(pic)es.add(x[1]);out.push(x)}
  return out}
const wordPool=ctx=>ph(ctx)===1?D.WD:[...D.PH,...D.WD.filter(x=>x[0].length>=3)];

// ---- 听音选字：只考第三级新字和容易混的字 ----
G.hear=ctx=>{
  const t=pick(D.HARD,1,x=>x,{review:false});const n=optN(ctx);
  const ds=distractChars(t,n-1,Math.max(.7,ctx.w.look));
  ctx.prompt('听一听，点出这个字',()=>say(t));
  ctx.box.append(bigShow('<span class="ear">👂</span>'),choices(ctx,[{html:tz(t),ok:1},...ds.map(d=>({html:tz(d)}))],{key:t,onRight:()=>say(t)}));
  say('听一听，点出这个字',t)};

// ---- 听词语，选对的词语（不看图，几个词长得像）----
G.hearw=ctx=>{
  const pool=wordPool(ctx);const t=pick(pool);const n=optN(ctx);const ds=simItems(t,pool,n-1);
  ctx.prompt('听一听，点出这个词',()=>say(t[0]));
  ctx.box.append(bigShow('<span class="ear">👂</span>'),choices(ctx,[{html:tzw(t[0]),ok:1},...ds.map(d=>({html:tzw(d[0])}))],{key:t[0],cls:'opt wordopt',onRight:()=>say(t[0])}));
  say('听一听，点出这个词',t[0])};

// ---- 看字选图（旧题型，现在用词语）----
G.pic=ctx=>G.word(ctx);

// ---- 看图选词语（干扰项和答案有相同的字）----
G.match=ctx=>{
  const pool=withPic(wordPool(ctx));const t=pick(pool);const n=optN(ctx);const ds=simItems(t,wordPool(ctx),n-1,{strict:true});
  const p=ph(ctx)===1?'这张图是哪个词语？':'这张图说的是哪一个？';
  ctx.prompt(p,()=>say(p));
  ctx.box.append(bigShow(emo(t[1])),choices(ctx,[{html:tzw(t[0]),ok:1},...ds.map(d=>({html:tzw(d[0])}))],{key:t[0],cls:'opt wordopt',onRight:()=>say(t[0])}));
  say(p)};

// ---- 词语选图（看词 / 听词），图里有长得像的词 ----
G.word=ctx=>{
  const pool=withPic(D.WD);const t=pick(pool);const n=optN(ctx,4);const ds=simItems(t,pool,n-1,{pic:true});const listen=Math.random()<.4;
  const p=listen?'听一听，点对的图':'这个词语是哪张图？';
  ctx.prompt(p,()=>listen?say(t[0]):say(p));
  ctx.box.append(bigShow(listen?'<span class="ear">👂</span>':tzw(t[0])),choices(ctx,[{html:emo(t[1]),ok:1},...ds.map(d=>({html:emo(d[1])}))],{key:t[0],cls:'opt pic',onRight:()=>say(t[0])}));
  listen?say(p,t[0]):say(p)};

// ---- 短语选图：一半看字读，一半听 ----
G.phrase=ctx=>{
  const pool=withPic(D.PH);const t=pick(pool);const n=optN(ctx,4);const ds=simItems(t,pool,n-1,{pic:true});const listen=Math.random()<.4;
  const p=listen?'听一听，点对的图':'读一读，点对的图';
  ctx.prompt(p,()=>listen?say(t[0]):say(p));
  ctx.box.append(bigShow(listen?'<span class="ear">👂</span>':tzw(t[0])),choices(ctx,[{html:emo(t[1]),ok:1},...ds.map(d=>({html:emo(d[1])}))],{key:t[0],cls:'opt pic',onRight:async()=>{const s=ctx.box.querySelector('.show');s.innerHTML=tzw(t[0]);await say(t[0])}}));
  listen?say(p,t[0]):say(p)};

// ---- 短语填空：颜色（＿＿的花）或者数量（＿只小鸟）----
const COLOR_PH=[['红红','的花','🌺'],['白白','的云','☁️'],['黑黑','的猫','🐈‍⬛'],['绿绿','的叶子','🍃'],['蓝蓝','的大海','🌊'],['黄黄','的月亮','🌕'],['黄黄','的叶子','🍂'],['白白','的雪人','☃️'],['绿绿','的小草','🌿'],['黑黑','的天','🌃']];
const COLORS=['红红','白白','黑黑','绿绿','蓝蓝','黄黄'];
const QTY=[['小鸟','🐦'],['小猫','🐱'],['小兔','🐰'],['小鱼','🐟'],['蜜蜂','🐝'],['小狗','🐶']];
const QN=['','一','两','三','四','五'];
G.pfill=ctx=>{
  const n=optN(ctx,4);
  if(Math.random()<.5){const t=pick(COLOR_PH,1,x=>x[0]+x[1]);const ds=shuffle(COLORS.filter(c=>c!==t[0])).slice(0,n-1);const full=t[0]+t[1];
    ctx.prompt('看图，选一选放进去',()=>say(full));
    const box=bigShow(`<div class="sent">${emo(t[2])}<div class="stext big"><span class="blank">　　</span>${esc(t[1])}</div></div>`);
    ctx.box.append(box,choices(ctx,[{html:tzw(t[0]),ok:1},...ds.map(x=>({html:tzw(x)}))],{key:full,cls:'opt wordopt',onRight:async()=>{const b=box.querySelector('.blank');b.textContent=t[0];b.classList.add('filled');await say(full)}}));
    say('看图，选一选放进去');return}
  const k=1+rnd(ctx.w.id>=3?5:3);const q=QTY[rnd(QTY.length)];const full=QN[k]+'只'+q[0];
  const ds=shuffle([1,2,3,4,5].filter(x=>x!==k&&(ctx.w.id>=3||x<=4))).slice(0,n-1);
  ctx.prompt('数一数，选一选放进去',()=>say('数一数，有几只？'));
  const box=bigShow(`<div class="sent"><span class="og big">${q[1].repeat(k)}</span><div class="stext big"><span class="blank one">　</span>只${esc(q[0])}</div></div>`);
  ctx.box.append(box,choices(ctx,[{html:tz(QN[k]),ok:1},...ds.map(x=>({html:tz(QN[x])}))],{key:full,onRight:async()=>{const b=box.querySelector('.blank');b.textContent=QN[k];b.classList.add('filled');await say(full)}}));
  say('数一数，有几只？')};

// ---- 读句子选图（不先播音）----
G.sent=ctx=>{
  const pool=withPic(D.SN);const t=pick(pool);const n=optN(ctx,4);const ds=simItems(t,pool,n-1,{pic:true});
  let heard=false;
  ctx.prompt('读一读，点对的图',()=>{heard?say(t[0]):say('读一读，点对的图')});
  ctx.box.append(bigShow(tzw(t[0])),choices(ctx,[{html:emo(t[1]),ok:1},...ds.map(d=>({html:emo(d[1])}))],{key:t[0],cls:'opt pic',onRight:()=>say(t[0])}));
  const ow=ctx.wrong;ctx.wrong=(b,k,re,o)=>{heard=true;ow(b,k,()=>say(t[0]),o)};
  say('读一读，点对的图')};

// ---- 拼词：按顺序点字 ----
G.build=ctx=>{
  const pool=ph(ctx)===1?D.WD.filter(x=>x[0].length>=2):D.PH.filter(x=>x[0].length<=5);
  const t=pick(pool);const w=[...t[0]];
  const nd=ph(ctx)===1?2:3;
  const ds=[];for(const c of w){for(const d of distractChars(c,1,.8)){if(ds.length<nd&&!w.includes(d)&&!ds.includes(d))ds.push(d)}}
  while(ds.length<nd){const d=C.ALLCH[rnd(C.ALLCH.length)];if(!w.includes(d)&&!ds.includes(d))ds.push(d)}
  ctx.prompt('听一听，拼出这个词',()=>say(t[0]));
  const slots=el('div','slots');w.forEach(()=>slots.append(el('span','slot')));
  const tiles=el('div','opts tiles');tiles.style.setProperty('--cols',Math.min(6,w.length+nd));
  let i=0;
  shuffle([...w.map((c,k)=>({c,k})),...ds.map(c=>({c,k:-1}))]).forEach(o=>{const b=el('button','opt',tz(o.c));b.onclick=async()=>{if(b.disabled)return;
    if(o.c===w[i]){b.disabled=true;b.classList.add('gone');slots.children[i].innerHTML=tz(o.c,'sm');slots.children[i].classList.add('fill');SFX.pop();bounce(slots.children[i]);i++;
      if(i===w.length){ctx.right(slots,t[0]);if(t[1])slots.insertAdjacentHTML('beforeend',emo(t[1]));await say(t[0]);ctx.done()}}
    else{ctx.wrong(b,t[0])}};tiles.append(b)});
  ctx.box.append(slots,tiles);say('听一听，拼出这个词',t[0])};

// ---- 句子挖空填词 ----
G.cloze=ctx=>{
  const t=pick(D.CZ);const [s,a,d0,e]=t;
  const extra=uniqEmo([a,''],D.WD,4,x=>x[0]).map(x=>x[0]).filter(x=>x!==a&&!d0.includes(x));
  const ds=[...d0,...extra].slice(0,optN(ctx,4)-1);
  const masked=s.replace(a,'，嗯，');
  const show=s.replace(a,'<span class="blank">　　</span>');
  ctx.prompt('听一听，哪个词放进去？',()=>say(masked));
  const box=bigShow(`<div class="sent">${emo(e)}<div class="stext">${show}</div></div>`);
  ctx.box.append(box,choices(ctx,[{html:tzw(a),ok:1},...ds.map(x=>({html:tzw(x)}))],{key:s,cls:'opt wordopt',onRight:async()=>{box.querySelector('.blank').textContent=a;box.querySelector('.blank').classList.add('filled');await say(s)}}));
  say('听一听，哪个词放进去？',masked)};

// ---- 同音字/形近字：句子里选对的字 ----
G.ctx=ctx=>{
  const t=pick(D.CTX);const [s,a,d0]=t;
  let ds=d0.filter(c=>c!==a&&(D.KNOWN.has(c)||D.DISTRACT_OK.has(c)));
  const need=Math.min(3,optN(ctx))-1;
  for(const c of distractChars(a,4,.9,{hear:false}))if(ds.length<need&&!ds.includes(c))ds.push(c);
  ds=ds.slice(0,need);
  const full=s.replace('＿',a);
  ctx.prompt('选一选，哪个字放进去？',()=>say(full));
  const box=bigShow(`<div class="stext big">${esc(s).replace('＿','<span class="blank one">　</span>')}</div>`);
  ctx.box.append(box,choices(ctx,[{html:tz(a),ok:1},...ds.map(x=>({html:tz(x)}))],{key:a,onRight:async()=>{const b=box.querySelector('.blank');b.textContent=a;b.classList.add('filled');await say(full)}}));
  say('选一选，哪个字放进去？',full)};

// ---- 找不同（形近字）----
G.find=ctx=>{
  let round=0;const R=2;
  const groups=shuffle(D.LOOK.map(g=>g.filter(c=>D.KNOWN.has(c))).filter(g=>g.length>=2));
  const go=()=>{
    ctx.box.innerHTML='';const g=groups[round%groups.length];const [a,b]=shuffle(g);
    const N=ctx.w.id<=2?9:ctx.w.id<=4?12:16;const odd=rnd(N);
    const grid=el('div','findgrid');grid.style.setProperty('--cols',N===9?3:4);
    for(let i=0;i<N;i++){const btn=el('button','opt',tz(i===odd?b:a));btn.onclick=async()=>{if(btn.disabled)return;
      if(i===odd){btn.classList.add('right');ctx.right(btn,b);await say(b);round++;if(round>=R)ctx.done();else{await sleep(400);go()}}
      else{ctx.wrong(btn,b,()=>say(a));}};grid.append(btn)}
    ctx.box.append(grid)};
  ctx.prompt('找出不一样的字！',()=>say('找出不一样的字！'));go();say('找出不一样的字！')};

// ---- 孵蛋找字：找出 3 颗一样的 ----
G.eggs=ctx=>{
  const t=pick(D.HARD,1,x=>x,{review:false});
  const ds=distractChars(t,5,ctx.w.look+.3);
  const items=shuffle([t,t,t,...ds.slice(0,5)]);let found=0;
  ctx.prompt('听一听，找出 3 颗有这个字的蛋',()=>say(t));
  const g=el('div','eggrow');
  items.forEach(c=>{const b=el('button','egg-btn',`<span class="eggshape"></span><span class="eggch">${esc(c)}</span>`);b.onclick=async()=>{if(b.disabled)return;
    if(c===t){b.disabled=true;b.classList.add('hatched');b.querySelector('.eggch').innerHTML='🐣';SFX.crack();found++;burstAt(b,20);if(found===3){ctx.right(g,t);await say(t);ctx.done()}else say(t)}
    else{ctx.wrong(b,t)}};g.append(b)});
  ctx.box.append(g);say('听一听，找出这个字',t)};

// ---- 跳石头过河 ----
G.stones=ctx=>{
  const steps=ctx.w.id<=1?4:5,per=ctx.w.id<=2?2:3;let k=0;
  const path=el('div','river');const hero=el('img','rhero');hero.src=dimg(ctx.hero);
  const rows=[];
  const targets=pick(D.HARD,steps,x=>x,{review:false});
  ctx.prompt('听一听，跟着这个字走',()=>say(targets[k]));
  const row=el('div','stonerow');
  const draw=()=>{row.innerHTML='';const t=targets[k];const ds=distractChars(t,per-1,ctx.w.look+.3);
    shuffle([t,...ds]).forEach(c=>{const b=el('button','stone',tz(c,'sm'));b.onclick=async()=>{if(b.disabled)return;
      if(c===t){b.disabled=true;b.classList.add('right');SFX.jump();const r=b.getBoundingClientRect(),p=path.getBoundingClientRect();hero.style.left=(r.left-p.left+r.width/2)+'px';hero.style.top=(r.top-p.top-10)+'px';C.markRight(t);burstAt(b,14);
        dots.children[k].classList.add('on');k++;await say(t);if(k>=steps){ctx.right(path,t);ctx.done()}else{await sleep(250);draw();hero.style.left='';hero.style.top='';say(targets[k])}}
      else{b.classList.add('sink');ctx.wrong(b,t);setTimeout(()=>b.classList.remove('sink'),600)}};row.append(b)})};
  const dots=el('div','stepdots');for(let i=0;i<steps;i++)dots.append(el('span'));
  path.append(hero,row);ctx.box.append(dots,path);draw();say('听一听，跟着这个字走',targets[0])};

// ---- 打恐龙地鼠 ----
G.whack=ctx=>{
  const t=pick(D.HARD,1,x=>x,{review:false});const ds=distractChars(t,3,ctx.w.look+.3);
  const goal=ctx.w.id<=1?4:5;let hits=0,alive=true,lastT=0;
  const ids=['tri','rap','ste','ank','pte','spi'];
  ctx.prompt('打恐龙地鼠！点举着这个字的恐龙',()=>say(t));
  const meter=el('div','meter');for(let i=0;i<goal;i++)meter.append(el('span'));
  const field=el('div','holes');const holes=[];
  for(let i=0;i<6;i++){const h=el('div','hole');const m=el('button','mole',`<img src="${dimg(ids[i])}" alt=""><span class="sign"></span>`);h.append(m,el('span','dirt'));field.append(h);holes.push(m);
    m.onclick=async()=>{if(!m.classList.contains('up')||m.dataset.hit)return;
      if(m.dataset.c===t){m.dataset.hit=1;m.classList.add('bonk');SFX.hit();C.markRight(t);burstAt(m,16);meter.children[hits].classList.add('on');hits++;say(t);setTimeout(()=>{m.classList.remove('up','bonk');delete m.dataset.hit},500);
        if(hits>=goal){alive=false;ctx.right(field,t);await sleep(700);ctx.done()}}
      else{ctx.wrong(m,t,null,{soft:1})}}}
  const tick=()=>{if(!alive||!document.body.contains(field))return;
    const free=holes.filter(m=>!m.classList.contains('up'));
    if(free.length){const m=free[rnd(free.length)];const now=Date.now();const want=(now-lastT>3500)||Math.random()<.45;const c=want?t:ds[rnd(ds.length)];if(c===t)lastT=now;
      m.dataset.c=c;m.querySelector('.sign').textContent=c;m.classList.add('up');
      setTimeout(()=>{if(!m.dataset.hit)m.classList.remove('up')},ctx.w.id<=2?2600:2100)}
    setTimeout(tick,ctx.w.id<=2?1100:900)};
  ctx.box.append(meter,field);say('打恐龙地鼠！点举着这个字的恐龙',t).then(()=>setTimeout(tick,300));
  ctx.cleanup=()=>{alive=false}};

// ---- 恐龙对对碰（记忆翻牌）----
function memoryGame(ctx,pairs,{preview=2600,prompt='记忆翻牌！把字和图配成一对。',onMatch}={}){
  // pairs: [{a:html,b:html,k:key,say:text}]
  const cards=shuffle(pairs.flatMap((p,i)=>[{i,h:p.a},{i,h:p.b}]));
  const n=cards.length;const g=el('div','memgrid');g.style.setProperty('--cols',n<=6?3:n<=8?4:n<=12?4:5);
  let open=[],lock=true,got=0;const backs=['tri','ste','rap','pte','ank','spi','bra','mos'];
  cards.forEach((c,j)=>{const b=el('button','card open',`<span class="face back"><img src="${dimg(backs[j%backs.length])}" alt=""></span><span class="face front">${c.h}</span>`);b.onclick=async()=>{
      if(lock||b.classList.contains('open'))return;b.classList.add('open');SFX.pop();open.push([b,c]);
      if(open.length===2){lock=true;const [[b1,c1],[b2,c2]]=open;open=[];
        if(c1.i===c2.i){b1.classList.add('matched');b2.classList.add('matched');SFX.ok();burstAt(b2,18);C.markRight(pairs[c1.i].k);got++;if(onMatch)onMatch(pairs[c1.i]);await say(pairs[c1.i].say);lock=false;if(got===pairs.length){ctx.right(g);await sleep(400);ctx.done()}}
        else{ctx.wrong(b2,pairs[c1.i].k,()=>{},{soft:1});await sleep(900);b1.classList.remove('open');b2.classList.remove('open');lock=false}}};g.append(b)});
  ctx.prompt(prompt,()=>say(prompt));ctx.box.append(g);
  say(prompt);setTimeout(()=>{g.querySelectorAll('.card').forEach(b=>b.classList.remove('open'));lock=false},preview+n*120)}
G.memory=ctx=>{
  const n=Math.max(3,Math.min(6,ctx.w.pairs));const mode='word';
  const src=withPic(D.WD).filter(x=>x[0].length<=3);
  const first=pick(src);const rest=uniqEmo(first,src,n-1);[first,...rest].forEach(x=>C.used().add(x[0]));
  memoryGame(ctx,[first,...rest].map(x=>({a:mode==='word'?tzw(x[0]):tz(x[0]),b:emo(x[1]),k:x[0],say:x[0]})),{preview:ctx.w.id<=1?3200:2600})};

// ---- 连一连 ----
function lineGame(ctx,pairs,prompt){
  ctx.prompt(prompt,()=>say(prompt));
  const wrap=el('div','lines');const L=el('div','lcol'),R=el('div','lcol');const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('lsvg');
  let sel=null,got=0;
  const ls=pairs.map((p,i)=>{const b=el('button','opt lopt',p.a);b.dataset.i=i;L.append(b);return b});
  const rs=shuffle(pairs.map((p,i)=>({p,i}))).map(({p,i})=>{const b=el('button','opt lopt',p.b);b.dataset.i=i;R.append(b);return b});
  const line=(a,b,cls)=>{const w=wrap.getBoundingClientRect(),r1=a.getBoundingClientRect(),r2=b.getBoundingClientRect();const l=document.createElementNS('http://www.w3.org/2000/svg','line');l.setAttribute('x1',r1.right-w.left);l.setAttribute('y1',r1.top+r1.height/2-w.top);l.setAttribute('x2',r2.left-w.left);l.setAttribute('y2',r2.top+r2.height/2-w.top);l.setAttribute('class',cls);svg.append(l);return l};
  ls.forEach(b=>b.onclick=()=>{if(b.classList.contains('done'))return;ls.forEach(x=>x.classList.remove('sel'));b.classList.add('sel');sel=b;SFX.pop();const p=pairs[b.dataset.i];if(p.say)say(p.say)});
  rs.forEach(b=>b.onclick=async()=>{if(b.classList.contains('done'))return;if(!sel){shake(b);return}
    if(sel.dataset.i===b.dataset.i){line(sel,b,'ok');sel.classList.add('done');b.classList.add('done');sel.classList.remove('sel');SFX.ok();burstAt(b,12);C.markRight(pairs[b.dataset.i].k);got++;sel=null;if(got===pairs.length){ctx.right(wrap);await sleep(600);ctx.done()}}
    else{const l=line(sel,b,'bad');setTimeout(()=>l.remove(),500);ctx.wrong(b,pairs[sel.dataset.i].k,()=>{})}});
  wrap.append(L,svg,R);ctx.box.append(wrap);say(prompt)}
G.line=ctx=>{
  const n=Math.max(3,Math.min(5,ctx.w.pairs));const useW=true;const src=ph(ctx)===1?withPic(D.WD):withPic(D.PH);
  const first=pick(src);const rest=uniqEmo(first,src,n-1);[first,...rest].forEach(x=>C.used().add(x[0]));
  lineGame(ctx,[first,...rest].map(x=>({a:useW?tzw(x[0]):tz(x[0],'sm'),b:emo(x[1]),k:x[0],say:x[0]})),'连一连')};

// ---- 消消乐 ----
// tiles: [{k, html, color}] 第一个是目标；goal 需要消掉的目标个数
function match3(ctx,{tiles,goal,size=6,prompt,sayT,onClear}){
  const K=tiles.length;let grid=[],sel=null,busy=false,count=0;
  const board=el('div','m3');board.style.setProperty('--n',size);
  const bar=el('div','m3bar',`<span class="m3tgt">${tiles[0].html}</span><span class="m3prog"><i></i></span><b class="m3num">0/${goal}</b>`);
  const rand=()=>rnd(K);
  const at=(r,c)=>grid[r*size+c];
  function findMatches(){const m=new Set();for(let r=0;r<size;r++)for(let c=0;c<size;c++){const v=at(r,c);if(v<0)continue;
      if(c<=size-3&&at(r,c+1)===v&&at(r,c+2)===v){let k=c;while(k<size&&at(r,k)===v){m.add(r*size+k);k++}}
      if(r<=size-3&&at(r+1,c)===v&&at(r+2,c)===v){let k=r;while(k<size&&at(k,c)===v){m.add(k*size+c);k++}}}return m}
  function hasMove(){for(let r=0;r<size;r++)for(let c=0;c<size;c++){for(const [dr,dc] of [[0,1],[1,0]]){const r2=r+dr,c2=c+dc;if(r2>=size||c2>=size)continue;swap(r*size+c,r2*size+c2);const ok=findMatches().size>0;swap(r*size+c,r2*size+c2);if(ok)return true}}return false}
  function swap(a,b){[grid[a],grid[b]]=[grid[b],grid[a]]}
  function fill(){do{grid=Array.from({length:size*size},rand);let m;while((m=findMatches()).size)m.forEach(i=>grid[i]=rand())}while(!hasMove())}
  const cells=[];
  function render(){grid.forEach((v,i)=>{const d=cells[i];if(d.dataset.v!==String(v)){d.dataset.v=v;d.innerHTML=v<0?'':tiles[v].html;d.style.setProperty('--tc',v<0?'transparent':tiles[v].color)}})}
  for(let i=0;i<size*size;i++){const d=el('button','m3c');d.dataset.i=i;cells.push(d);board.append(d)}
  fill();render();
  async function resolve(){let m,chain=0;while((m=findMatches()).size){chain++;let tg=0;m.forEach(i=>{if(grid[i]===0)tg++;cells[i].classList.add('pop')});SFX.pop();if(chain>1)SFX.coin();
      const r0=cells[[...m][0]].getBoundingClientRect();C.confetti(r0.left+r0.width/2,r0.top,12);
      if(tg){count=Math.min(goal,count+tg);bar.querySelector('i').style.width=(count/goal*100)+'%';bar.querySelector('.m3num').textContent=count+'/'+goal;bounce(bar.querySelector('.m3tgt'));if(sayT)say(sayT)}
      await sleep(260);m.forEach(i=>{grid[i]=-1;cells[i].classList.remove('pop')});
      for(let c=0;c<size;c++){const col=[];for(let r=size-1;r>=0;r--)if(at(r,c)>=0)col.push(at(r,c));for(let r=size-1,k=0;r>=0;r--,k++){grid[r*size+c]=k<col.length?col[k]:rand()}}
      render();cells.forEach(d=>d.classList.add('drop'));await sleep(220);cells.forEach(d=>d.classList.remove('drop'))}
    if(!hasMove()){fill();render()}
    if(onClear)onClear(count);
    if(count>=goal){busy=true;ctx.right(board,tiles[0].k);await sleep(500);ctx.done()}}
  async function trySwap(a,b){if(busy)return;busy=true;cells[a].classList.remove('sel');swap(a,b);render();
    if(findMatches().size){await resolve();if(count<goal)busy=false}
    else{SFX.no();shake(cells[a]);shake(cells[b]);await sleep(300);swap(a,b);render();busy=false}}
  const adj=(a,b)=>{const ra=Math.floor(a/size),ca=a%size,rb=Math.floor(b/size),cb=b%size;return Math.abs(ra-rb)+Math.abs(ca-cb)===1};
  let down=null;
  board.addEventListener('pointerdown',e=>{const d=e.target.closest('.m3c');if(!d||busy)return;down={i:+d.dataset.i,x:e.clientX,y:e.clientY}});
  board.addEventListener('pointerup',e=>{if(!down)return;const dx=e.clientX-down.x,dy=e.clientY-down.y;const i=down.i;down=null;
    if(Math.hypot(dx,dy)>22){const r=Math.floor(i/size),c=i%size;let j=-1;if(Math.abs(dx)>Math.abs(dy)){if(dx>0&&c<size-1)j=i+1;if(dx<0&&c>0)j=i-1}else{if(dy>0&&r<size-1)j=i+size;if(dy<0&&r>0)j=i-size}if(j>=0){if(sel!=null)cells[sel].classList.remove('sel');sel=null;trySwap(i,j)}return}
    if(sel==null){sel=i;cells[i].classList.add('sel');SFX.tick()}else if(sel===i){cells[i].classList.remove('sel');sel=null}else if(adj(sel,i)){const a=sel;sel=null;trySwap(a,i)}else{cells[sel].classList.remove('sel');sel=i;cells[i].classList.add('sel');SFX.tick()}});
  ctx.prompt(prompt,()=>sayT?say(sayT):say(prompt));
  ctx.box.append(bar,board);say(prompt,...(sayT?[sayT]:[]))}
const CANDY=['#ff7a7a','#ffc94d','#5ec8f2','#7bd389','#c79bff','#ff9ed8'];
G.match3=ctx=>{
  const t=pick(D.HARD,1,x=>x,{review:false});const K=ctx.w.id<=1?4:5;const ds=distractChars(t,K-1,ctx.w.look+.3,{hear:false});
  const uni=ctx.w.id>=3;
  const tiles=[t,...ds].map((c,i)=>({k:c,html:`<span class="m3ch">${esc(c)}</span>`,color:uni?'#fff4d6':CANDY[i]}));
  match3(ctx,{tiles,goal:ctx.w.m3,size:ctx.w.id<=1?5:6,prompt:'消消乐！三个一样的字排一排，消掉这个字',sayT:t})};

// ---- 拼图 2/4/6/9 块 ----
const ASP={all:.455,ank:.434,bra:.68,car:.429,gig:.423,ind:.46,map:.389,mos:.477,pte:.405,rap:.452,rex:.432,spi:.497,ste:.516,tar:.503,tri:.518};
const BGS=['grass','jungle','river','lake','beach','falls','canyon','night','desert','volcano','snow'];
function puzzle(ctx,{n,dino,bg,onDone}){
  const [rows,cols]={2:[1,2],4:[2,2],6:[2,3],9:[3,3]}[n];
  const d=D.DINOS.find(x=>x.id===dino);
  const prompt=`拼图！把${d.n}拼好`;
  ctx.prompt(prompt,()=>say(prompt));
  const wrap=el('div','pz');const board=el('div','pzboard');board.style.setProperty('--r',rows);board.style.setProperty('--c',cols);
  const tray=el('div','pztray');
  const ghost=el('div','pzghost');board.append(ghost);
  const slots=[];for(let i=0;i<n;i++){const s=el('div','pzslot');slots.push(s);board.append(s)}
  const img=`url(assets/img/dino_${dino}.webp)`,bgi=`url(assets/img/bg_${bg}.webp)`;
  ghost.style.backgroundImage=`${img},${bgi}`;
  let placed=0,selP=null;
  const pieces=[];
  function styleFor(p,i){const r=Math.floor(i/cols),c=i%cols;const W=board.clientWidth,H=board.clientHeight;const pw=W/cols,ph=H/rows;
    const dw=W*(ASP[dino]>.6?.42:.62),dh=dw*ASP[dino],dx=(W-dw)/2,dy=H*.94-dh;
    p.style.width=pw+'px';p.style.height=ph+'px';
    p.style.backgroundImage=`${img},${bgi}`;p.style.backgroundSize=`${dw}px auto, ${W}px ${H}px`;p.style.backgroundPosition=`${dx-c*pw}px ${dy-r*ph}px, ${-c*pw}px ${-r*ph}px`;p.style.backgroundRepeat='no-repeat'}
  ghost.dataset.k='g';
  function layout(){const W=board.clientWidth,H=board.clientHeight;if(!W)return;const dw=W*(ASP[dino]>.6?.42:.62);ghost.style.backgroundSize=`${dw}px auto, ${W}px ${H}px`;ghost.style.backgroundPosition=`${(W-dw)/2}px ${H*.94-dw*ASP[dino]}px, 0 0`;tray.style.width=(W+(cols-1)*8+2)+'px';pieces.forEach(p=>styleFor(p,+p.dataset.i))}
  function place(p,i){const s=slots[i];s.append(p);p.classList.add('in');p.style.left='';p.style.top='';p.style.position='';placed++;SFX.ok();burstAt(s,14);
    if(placed===n){board.classList.add('done');C.bigConfetti();SFX.fanfare();ctx.right(board);setTimeout(async()=>{await say(d.n);if(onDone)onDone();ctx.done()},500)}}
  for(let i=0;i<n;i++){const p=el('div','pzp');p.dataset.i=i;pieces.push(p)}
  shuffle(pieces).forEach(p=>tray.append(p));
  slots.forEach((s,i)=>s.onclick=()=>{if(!selP)return;const p=selP;selP=null;p.classList.remove('sel');if(+p.dataset.i===i)place(p,i);else{ctx.wrong(s,null,()=>{},{soft:1});shake(p)}});
  pieces.forEach(p=>{let st=null;
    p.addEventListener('pointerdown',e=>{if(p.classList.contains('in'))return;e.preventDefault();p.setPointerCapture(e.pointerId);const r=p.getBoundingClientRect();st={x:e.clientX,y:e.clientY,ox:e.clientX-r.left,oy:e.clientY-r.top,moved:false,w:r.width,h:r.height}});
    p.addEventListener('pointermove',e=>{if(!st)return;if(!st.moved&&Math.hypot(e.clientX-st.x,e.clientY-st.y)>8){st.moved=true;p.classList.add('drag');document.body.append(p);p.style.position='fixed';}
      if(st.moved){p.style.left=(e.clientX-st.ox)+'px';p.style.top=(e.clientY-st.oy)+'px'}});
    p.addEventListener('pointerup',e=>{if(!st)return;const s0=st;st=null;
      if(!s0.moved){if(selP)selP.classList.remove('sel');selP=p;p.classList.add('sel');SFX.tick();return}
      p.classList.remove('drag');const i=+p.dataset.i;const sr=slots[i].getBoundingClientRect();const cxp=e.clientX-s0.ox+s0.w/2,cyp=e.clientY-s0.oy+s0.h/2;
      if(Math.abs(cxp-(sr.left+sr.width/2))<sr.width*.55&&Math.abs(cyp-(sr.top+sr.height/2))<sr.height*.55)place(p,i);
      else{p.style.position='';p.style.left='';p.style.top='';tray.append(p);SFX.no()}});
    p.addEventListener('pointercancel',()=>{if(!st)return;st=null;p.classList.remove('drag');p.style.position='';tray.append(p)})});
  wrap.append(board,tray);ctx.box.append(wrap);
  requestAnimationFrame(()=>{layout();requestAnimationFrame(layout)});const ro=new ResizeObserver(layout);ro.observe(board);
  const oc=ctx.cleanup;ctx.cleanup=()=>{ro.disconnect();pieces.forEach(p=>{if(p.parentNode===document.body)p.remove()});oc&&oc()};
  say(prompt)}
G.puzzle=ctx=>{const n=ctx.w.pz[rnd(ctx.w.pz.length)];const d=D.DINOS[rnd(D.DINOS.length)];puzzle(ctx,{n,dino:ctx.puzzleDino||d.id,bg:ctx.bg||BGS[rnd(BGS.length)]})};

// ---- 舒尔特方格 ----
G.schulte=ctx=>{
  const zh=ctx.w.id>=3&&Math.random()<.6;const lab=zh?'一二三四五六七八九'.split(''):'123456789'.split('');
  let k=0;const t0=Date.now();const p='按顺序点：'+(zh?'一、二、三……':'1、2、3……');
  ctx.prompt(p,()=>say('按顺序点'));
  const timer=el('div','timer','⏱ 0 秒');const iv=setInterval(()=>{timer.textContent='⏱ '+Math.floor((Date.now()-t0)/1000)+' 秒'},500);
  const g=el('div','findgrid');g.style.setProperty('--cols',3);
  shuffle(lab.map((c,i)=>({c,i}))).forEach(o=>{const b=el('button','opt',zh?tz(o.c):`<span class="num">${o.c}</span>`);b.onclick=async()=>{if(b.disabled)return;
    if(o.i===k){b.disabled=true;b.classList.add('right');SFX.pop();say(zh?o.c:D.EN.N[o.i]);k++;
      if(k===9){clearInterval(iv);const sec=Math.round((Date.now()-t0)/1000);const S=C.S();const key=zh?'zh':'num';const best=S.best[key];if(!best||sec<best){S.best[key]=sec;C.save();timer.textContent=`⏱ ${sec} 秒  🏆 新纪录！`}else timer.textContent=`⏱ ${sec} 秒（最快 ${best} 秒）`;ctx.right(g);await sleep(1200);ctx.done()}}
    else{SFX.no();shake(b)}};g.append(b)});
  ctx.cleanup=()=>clearInterval(iv);
  ctx.box.append(timer,g);say('按顺序点')};

// ---- 句子排序 ----
G.order=ctx=>{
  const t=pick(D.ORD);const parts=t[0].split('|');const full=parts.join('');
  ctx.prompt('听一听，把句子排好',()=>say(full));
  const slots=el('div','slots ord');parts.forEach(()=>slots.append(el('span','slot wide')));
  const tiles=el('div','opts');tiles.style.setProperty('--cols',parts.length);let i=0;
  shuffle(parts.map((p,k)=>({p,k}))).forEach(o=>{const b=el('button','opt wordopt',tzw(o.p));b.onclick=async()=>{if(b.disabled)return;
    if(o.p===parts[i]){b.disabled=true;b.classList.add('gone');slots.children[i].innerHTML=tzw(o.p);slots.children[i].classList.add('fill');SFX.pop();i++;
      if(i===parts.length){ctx.right(slots,full);slots.insertAdjacentHTML('beforeend',emo(t[1]));await say(full);ctx.done()}}
    else ctx.wrong(b,full)};tiles.append(b)});
  ctx.box.append(slots,tiles);say('听一听，把句子排好',full)};

// ---- 开口说：大声读 / 跟读 ----
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
function voiceGame(ctx,{text,show,lang='zh-CN',preplay,prompt}){
  let tries=0;
  ctx.prompt(prompt,()=>preplay?preplay():say(prompt));
  const box=bigShow(show);const res=el('div','vres');
  const row=el('div','vbtns');
  const ok=el('button','pbtn good','✅ 读对了'),again=el('button','pbtn','🔊 听一听'),skip=el('button','pbtn ghost','跳过');
  const mic=el('button','mic','🎤');
  const finish=async(great)=>{row.querySelectorAll('button').forEach(b=>b.disabled=true);mic.disabled=true;
    if(great){res.textContent='🌟 Super!';ctx.right(box,text);await say('超级棒！')}else{await say('还要努力哦！');await (preplay?preplay():say(text))}ctx.done()};
  ok.onclick=()=>finish(true);again.onclick=()=>preplay?preplay():say(text);skip.onclick=()=>{ctx.skipped=true;ctx.done()};
  const norm=s=>s.toLowerCase().replace(/[^a-z0-9一-龥]/g,'');
  const sim=(a,b)=>{a=norm(a);b=norm(b);if(!a||!b)return 0;if(lang==='en-US')return a.includes(b)||b.includes(a)?1:0;let h=0;for(const c of new Set(b))if(a.includes(c))h++;return h/new Set(b).size};
  mic.onclick=()=>{if(!SR){mic.classList.add('off');return}
    try{C.stop();const r=new SR();r.lang=lang;r.maxAlternatives=5;r.interimResults=false;mic.classList.add('live');res.textContent='👂 在听……';
      r.onresult=async e=>{mic.classList.remove('live');const alts=[...e.results[0]].map(x=>x.transcript);const s=Math.max(...alts.map(a=>sim(a,text.replace(/^ph:/,''))));
        if(s>=.8)finish(true);else if(s>=.5){res.textContent='👍 Good!';ctx.right(box,text);await say('不错哦！');ctx.done()}else{tries++;res.textContent='😮 再试一次';await say('再试一次！');if(tries>=2)finish(false)}};
      r.onerror=()=>{mic.classList.remove('live');res.textContent='请家长点“读对了”';mic.classList.add('off')};r.onend=()=>mic.classList.remove('live');r.start()}catch(e){mic.classList.add('off');res.textContent='请家长点“读对了”'}};
  row.append(again,ok,skip);
  const note=el('div','pnote','家长：孩子读完后，读对了就点“读对了”');
  ctx.box.append(box,SR?mic:el('span'),res,row,note);
  if(preplay)say(prompt).then(preplay);else say(prompt)}
G.read=ctx=>{
  const t=ph(ctx)===3?pick(D.SN):ph(ctx)===2?pick(D.PH):pick(D.WD);
  voiceGame(ctx,{text:t[0],show:`<div class="sent">${t[1]?emo(t[1]):''}<div class="stext big">${tzw(t[0])}</div></div>`,prompt:'大声读一读！'})};
G.speak=ctx=>{
  const r=Math.random();
  if(r<.3){const n=pickNum();const w=D.EN.N[n-1];voiceGame(ctx,{text:w,lang:'en-US',show:`<span class="num big">${n}</span>`,prompt:'听一听，跟着说！',preplay:()=>say(w)})}
  else if(r<.4){const L=pickLetter();voiceGame(ctx,{text:L[0],lang:'en-US',show:`<span class="lat big">${L[0]} ${L[1]}</span>`,prompt:'听一听，跟着说！',preplay:()=>say(L[0])})}
  else{const t=ph(ctx)===1?pick(D.WD):pick(D.PH);voiceGame(ctx,{text:t[0],show:`<div class="sent">${t[1]?emo(t[1]):''}${tzw(t[0])}</div>`,prompt:'听一听，跟着说！',preplay:()=>say(t[0])})}};

// ---- 英语 ----
function dots(n,kind){const sym=kind==='dino'?'🦕':'<i class="dot"></i>';let h='<span class="frame">';for(let i=0;i<10;i++)h+=`<span class="fc">${i<n?sym:''}</span>`;return h+'</span>'}
G.enum=ctx=>{
  const n=pickNum();const w=D.EN.N[n-1];const k=ctx.w.id<=1?3:4;
  const ds=C.shuffle([1,2,3,4,5,6,7,8,9,10].filter(x=>x!==n&&Math.abs(x-n)<=4)).slice(0,k-1);
  const kind=['num','dots','dino'][rnd(3)];
  const h=x=>kind==='num'?`<span class="num">${x}</span>`:dots(x,kind);
  ctx.prompt('听一听，是几？',()=>say(w));
  ctx.box.append(bigShow('<span class="ear">👂</span>'),choices(ctx,[{html:h(n),ok:1},...ds.map(x=>({html:h(x)}))],{key:'n'+n,cls:'opt '+(kind==='num'?'':'cnt'),onRight:()=>say(w)}));
  say('听一听，是几？',w)};
G.eletter=ctx=>{
  const L=pickLetter();const k=ctx.w.id<=1?3:4;const ds=shuffle(D.EN.L.filter(x=>x[0]!==L[0])).slice(0,k-1);
  ctx.prompt('听一听，是哪个字母？',()=>say(L[0]));
  ctx.box.append(bigShow('<span class="ear">👂</span>'),choices(ctx,[{html:`<span class="lat">${L[0]}</span>`,ok:1},...ds.map(x=>({html:`<span class="lat">${x[0]}</span>`}))],{key:'L'+L[0],onRight:()=>say(L[0])}));
  say('听一听，是哪个字母？',L[0])};
G.ephon=ctx=>{
  const L=pickLetter();const k=ctx.w.id<=1?3:4;const ds=shuffle(D.EN.L.filter(x=>x[0]!==L[0])).slice(0,k-1);
  ctx.prompt('听一听，是哪个字母的声音？',()=>phon(L[1]));
  ctx.box.append(bigShow('<span class="ear">👂</span>'),choices(ctx,[{html:`<span class="lat">${L[1]}</span>`,ok:1},...ds.map(x=>({html:`<span class="lat">${x[1]}</span>`}))],{key:'L'+L[0],onRight:async()=>{ctx.box.querySelector('.show').innerHTML=emo(L[3])+`<span class="lat">${L[2]}</span>`;await say(L[2])}}));
  say('听一听，是哪个字母的声音？').then(()=>phon(L[1]))};
G.ecase=ctx=>{const n=Math.max(3,Math.min(5,ctx.w.pairs));const Ls=shuffle(D.EN.L).slice(0,n);Ls.forEach(L=>C.used().add('L'+L[0]));
  lineGame(ctx,Ls.map(L=>({a:`<span class="lat">${L[0]}</span>`,b:`<span class="lat">${L[1]}</span>`,k:'L'+L[0],say:L[0]})),'大写字母和小写字母连一连')};
G.ememory=ctx=>{const n=Math.max(3,Math.min(5,ctx.w.pairs));const Ls=shuffle(D.EN.L).slice(0,n);
  memoryGame(ctx,Ls.map(L=>({a:`<span class="lat">${L[0]}</span>`,b:`<span class="lat">${L[1]}</span>`,k:'L'+L[0],say:L[0]})),{prompt:'记忆翻牌！大写字母和小写字母配成一对。'})};
G.eword=ctx=>{
  const n=pickNum();const ds=shuffle([1,2,3,4,5,6,7,8,9,10].filter(x=>x!==n)).slice(0,2);const all=shuffle([n,...ds]);
  ctx.prompt('听一听，哪个是这个数字？',async()=>{for(const x of all){const b=ctx.box.querySelector(`[data-n="${x}"]`);b&&b.classList.add('glow');await say(D.EN.N[x-1]);b&&b.classList.remove('glow');await sleep(250)}});
  const g=el('div','opts');g.style.setProperty('--cols',3);let wr=0;
  all.forEach(x=>{const b=el('button','opt',`<span class="lat sm">${D.EN.N[x-1]}</span><span class="spk">🔊</span>`);b.dataset.n=x;b.onclick=async()=>{if(b.disabled)return;
    if(x===n){g.querySelectorAll('button').forEach(z=>z.disabled=true);b.classList.add('right');ctx.right(b,'n'+n);await say(D.EN.N[n-1]);ctx.done()}else{b.disabled=true;wr++;ctx.wrong(b,'n'+n,()=>say(D.EN.N[x-1]))}};g.append(b)});
  ctx.box.append(bigShow(`<span class="num big">${n}</span>`),g);
  say('听一听，哪个是这个数字？').then(()=>ctx.replay())};

G._helpers={simItems,withPic,choices,memoryGame,lineGame,match3,puzzle,tz,tzw,emo,dimg,PRAISE,CANDY,BGS,uniqEmo};
window.GAMES=G;
})();
