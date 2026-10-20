// 数学和逻辑（按 4–5 岁发展设计）：点数、按数取物、比多少、加减、规律、分类、排序、方位、图形、影子、数独、搭房子
(function(){
const D=window.DATA,G=window.GAMES,H=G._helpers;
const {el,shuffle,rnd,sleep,say,SFX,esc,bounce,shake,burstAt}=C;
const {choices,lineGame,tz,tzw,emo,dimg}=H;
const ZH=['零','一','二','三','四','五','六','七','八','九','十'];
// 每个世界的数学难度：mx 最大数，add 加减上限
const MP={1:{mx:5,add:3},2:{mx:7,add:5},3:{mx:10,add:5},4:{mx:10,add:7},5:{mx:10,add:10}};
const P=ctx=>MP[ctx.w.id]||MP[1];
const OBJ=['🍎','🍌','🍓','🐟','🥚','⭐','🌸','🚗','🐞','🦋','🍄','🐣','🎈','🍪','🦕'];
const numH=(n,zh)=>zh?tz(ZH[n]):`<span class="num">${n}</span>`;
const useZh=ctx=>ctx.w.id>=2&&Math.random()<.5;
function near(n,k,max){const out=new Set([n]);let t=0;while(out.size<k&&t++<50){const d=n+(rnd(2)?1:-1)*(1+rnd(2));if(d>=1&&d<=max)out.add(d)}let x=1;while(out.size<k){if(!out.has(x))out.add(x);x++}return[...out].filter(v=>v!==n)}
let lastN=0;const pickN=(lo,hi)=>{let n;do{n=lo+rnd(hi-lo+1)}while(n===lastN&&hi>lo);lastN=n;return n};
function objGrid(n,o,{cols=5,size='',tap=false,zh=false}={}){
  const g=el('div','ogrid '+size);g.style.setProperty('--cols',Math.min(cols,Math.max(1,n)));let k=0;
  for(let i=0;i<n;i++){const b=el(tap?'button':'span','obj',`<span class="emo">${o}</span><b class="badge"></b>`);
    if(tap)b.onclick=()=>{if(b.dataset.c)return;k++;b.dataset.c=k;b.querySelector('.badge').textContent=zh?ZH[k]:k;b.classList.add('counted');SFX.pop();say(ZH[k])};g.append(b)}
  return g}

// ---- 数一数：一个一个点，手口一致 ----
G.count=ctx=>{
  const n=pickN(1,P(ctx).mx);const o=OBJ[rnd(OBJ.length)];const zh=useZh(ctx);const k=ctx.w.id<=1?3:4;
  ctx.prompt('数一数，有几个？（点一个，数一个）',()=>say('数一数，有几个？'));
  const g=objGrid(n,o,{tap:true,zh});
  ctx.box.append(g,choices(ctx,[{html:numH(n,zh),ok:1},...near(n,k,10).slice(0,k-1).map(x=>({html:numH(x,zh)}))],{key:'数数'+n,onRight:()=>say(ZH[n]+'个')}));
  say('数一数，有几个？')};

// ---- 数量对应：数字和点点连一连 ----
G.qmatch=ctx=>{
  const k=ctx.w.id<=1?3:4;const ns=shuffle([...Array(P(ctx).mx).keys()].map(i=>i+1)).slice(0,k).sort((a,b)=>a-b);const zh=useZh(ctx);const o=OBJ[rnd(OBJ.length)];
  const grp=n=>`<span class="og">${o.repeat(n)}</span>`;
  lineGame(ctx,ns.map(n=>({a:numH(n,zh).replace('class="num"','class="num sm"').replace('class="tz ','class="tz sm '),b:grp(n),k:'对应'+n,say:ZH[n]})),'数字和数量连一连')};

// ---- 比多少 ----
G.more=ctx=>{
  const mx=P(ctx).mx;const eq=ctx.w.id>=3&&Math.random()<.18;let a=pickN(1,mx),b;
  if(eq)b=a;else{const gap=ctx.w.id<=1?2:1;do{b=1+rnd(mx)}while(Math.abs(a-b)<gap)}
  const ask=rnd(2)?'多':'少';const o=OBJ[rnd(OBJ.length)];
  const q=eq?'哪边多？':'哪边'+ask+'？';const pr=ask==='多'?'哪边多？':'哪边少？';
  ctx.prompt(pr+'（点那一边）',()=>say(pr));
  // 少的那边摆得更散，不能只看长短
  const side=(n,spread)=>`<div class="mside ${spread?'spread':''}">${o.repeat(n).match(/./gu).map(e=>`<span class="emo">${e}</span>`).join('')}</div>`;
  const win=a===b?-1:(ask==='多'?(a>b?0:1):(a<b?0:1));
  const opts=[{html:side(a,a<b),ok:win===0},{html:side(b,b<a),ok:win===1}];
  if(ctx.w.id>=3)opts.push({html:'<span class="eqb">🟰<br><small>一样多</small></span>',ok:win===-1});
  const g=choices(ctx,opts,{cls:'opt mopt',key:'比多少',onRight:()=>say(win===-1?'一样多！':(ask==='多'?'这边多！':'这边少！'))});
  // 保持左右顺序，不打乱
  [...g.children].sort((x,y)=>(x.querySelector('.eqb')?1:0)-(y.querySelector('.eqb')?1:0)).forEach(x=>g.append(x));g.style.setProperty('--cols',opts.length);
  ctx.box.append(el('div','show',tz(ask)),g);
  say(pr)};

// ---- 按数取物：给恐龙拿 N 个 ----
G.give=ctx=>{
  const n=pickN(1,Math.min(P(ctx).mx,8));const o=OBJ[rnd(OBJ.length)];const zh=useZh(ctx);
  const dino=D.DINOS[rnd(5)];
  const p=`给${dino.n}拿${ZH[n]}个`;
  ctx.prompt(p+'，拿好了点“好了”',()=>say(p));
  const top=el('div','givetop',`<img src="${dimg(dino.id)}" alt=""><div class="want">${numH(n,zh)}</div>`);
  const basket=el('div','basket2');const pile=el('div','pile');let cnt=0;
  const upd=()=>{basket.dataset.n=cnt};
  for(let i=0;i<10;i++){const b=el('button','obj',`<span class="emo">${o}</span>`);b.onclick=()=>{if(b.parentNode===pile){basket.append(b);cnt++;say(ZH[cnt]);SFX.pop()}else{pile.append(b);cnt--;SFX.tick()}upd()};pile.append(b)}
  const ok=el('button','pbtn good','✅ 好了');
  ok.onclick=async()=>{if(cnt===n){ok.disabled=true;ctx.right(basket,'取物'+n);await say(ZH[n]+'个，'+'谢谢你！');ctx.done()}else{ctx.wrong(basket,'取物'+n,()=>say(cnt<n?'不够哦，再拿一些':'太多啦，放回去一些'))}};
  ctx.box.append(top,el('div','blabel','篮子'),basket,pile,ok);say(p)};

// ---- 加减（用东西，不用算式）----
G.add=ctx=>{
  const lim=P(ctx).add;const sub=ctx.w.id>=4&&Math.random()<.35;const o=OBJ[rnd(OBJ.length)];
  let a,b,ans;if(sub){a=2+rnd(lim-1);b=1+rnd(a-1);ans=a-b}else{ans=2+rnd(lim-1);a=1+rnd(ans-1);b=ans-a}
  const zh=useZh(ctx);
  const q=sub?`有${ZH[a]}个，拿走了${ZH[b]}个，还剩几个？`:`${ZH[a]}个，再来${ZH[b]}个，一共几个？`;
  ctx.prompt(q,()=>say(q));
  const row=el('div','addrow');
  if(sub){row.innerHTML=`<div class="og big">${[...Array(a)].map((_,i)=>`<span class="emo ${i>=a-b?'gone2':''}">${o}</span>`).join('')}</div>`}
  else row.innerHTML=`<div class="og big">${o.repeat(a)}</div><span class="plus">＋</span><div class="og big">${o.repeat(b)}</div>`;
  if(ctx.w.id>=4)row.insertAdjacentHTML('beforeend',`<div class="formula">${a} ${sub?'－':'＋'} ${b} = ?</div>`);
  ctx.box.append(row,choices(ctx,[{html:numH(ans,zh),ok:1},...near(ans,3,10).slice(0,2).map(x=>({html:numH(x,zh)}))],{key:(sub?'减':'加')+a+(sub?'-':'+')+b,onRight:()=>say((sub?'还剩':'一共')+ZH[ans]+'个')}));
  say(q)};

// ---- 排排队：缺了哪个数 ----
G.numorder=ctx=>{
  const mx=P(ctx).mx;const len=ctx.w.id<=1?4:5;const start=1+rnd(Math.max(1,mx-len+1));let seq=[...Array(len)].map((_,i)=>start+i);
  if(ctx.w.id>=4&&Math.random()<.4)seq.reverse();
  const zh=useZh(ctx);const miss=ctx.w.id>=4?2:1;const holes=shuffle([...Array(len).keys()]).slice(0,miss).sort((a,b)=>a-b);let h=0;
  ctx.prompt('小火车少了一节，缺了几？',()=>say('小火车少了一节，缺了几？'));
  const train=el('div','train','<span class="loco">🚂</span>');const cars=seq.map((v,i)=>{const c=el('span','car'+(holes.includes(i)?' hole':''),holes.includes(i)?'?':numH(v,zh));train.append(c);return c});
  const opts=el('div','opts');opts.style.setProperty('--cols',4);
  const vals=new Set(holes.map(i=>seq[i]));while(vals.size<4){const v=1+rnd(10);vals.add(v)}
  shuffle([...vals]).forEach(v=>{const b=el('button','opt',numH(v,zh));b.onclick=async()=>{if(b.disabled)return;const want=seq[holes[h]];
    if(v===want){cars[holes[h]].innerHTML=numH(v,zh);cars[holes[h]].classList.remove('hole');cars[holes[h]].classList.add('fill');b.disabled=true;b.classList.add('right');SFX.ok();say(ZH[v]);h++;
      if(h>=holes.length){ctx.right(train,'排数');await sleep(400);await say(seq.map(x=>ZH[x]).join('，'));ctx.done()}}
    else ctx.wrong(b,'排数'+want,()=>say(seq.map((x,i)=>holes.includes(i)?'嗯':ZH[x]).join('，')))};opts.append(b)});
  ctx.box.append(train,opts);say('小火车少了一节，缺了几？')};

// ---- 找规律 ----
const PSETS=[['🔴','🔵','🟡','🟢'],['🍎','🍌','🍇','🍓'],['🐱','🐶','🐰','🐻'],['⭐','🌙','☀️','☁️'],['🦕','🦖','🥚','🐣'],['🚗','🚌','🚲','🚀']];
const UNITS={1:['AB'],2:['AB','AAB','ABB'],3:['ABB','AAB','ABC'],4:['ABC','AABB','ABB'],5:['ABC','AABB','ABCD','AAB']};
G.pattern=ctx=>{
  const set=shuffle(PSETS[rnd(PSETS.length)]);const u=UNITS[ctx.w.id][rnd(UNITS[ctx.w.id].length)];
  const unit=[...u].map(ch=>set[ch.charCodeAt(0)-65]);const total=Math.max(6,unit.length*2+(unit.length<=2?2:1));
  const seq=[...Array(total)].map((_,i)=>unit[i%unit.length]);const blanks=ctx.w.id>=4?2:1;let b=total-blanks;
  ctx.prompt('找规律：下一个是什么？',()=>say('找规律，下一个是什么？'));
  const row=el('div','prow');const cells=seq.map((s,i)=>{const c=el('span','pc'+(i>=total-blanks?' q':''),i>=total-blanks?'?':`<span class="emo">${s}</span>`);row.append(c);return c});
  const used=[...new Set(unit)];const opts=shuffle([...new Set([...used,...set.slice(0,used.length+1)])]).slice(0,Math.max(3,used.length));
  if(!opts.includes(seq[b]))opts[0]=seq[b];
  const g=el('div','opts');g.style.setProperty('--cols',opts.length);
  shuffle(opts).forEach(s=>{const btn=el('button','opt',`<span class="emo">${s}</span>`);btn.onclick=async()=>{if(b>=total)return;
    if(s===seq[b]){cells[b].innerHTML=`<span class="emo">${s}</span>`;cells[b].classList.remove('q');cells[b].classList.add('fill');SFX.ok();bounce(cells[b]);b++;if(b>=total){ctx.right(row,'规律'+u);await sleep(600);ctx.done()}}
    else ctx.wrong(btn,'规律'+u,()=>{})};g.append(btn)});
  ctx.box.append(row,g);say('找规律，下一个是什么？')};

// ---- 分一分（分类）----
const CATS=[
 {a:['🐱','🐶','🐰','🐟','🐦','🐻','🐮'],b:['🍎','🍌','🍚','🍉','🍓','🍪','🍞'],la:'<span class="emo">🐾</span>',lb:'<span class="emo">🍽️</span>',sa:'小动物',sb:'吃的'},
 {a:['🐦','🦋','🐝','✈️','🎈','🕊️'],b:['🐟','🐙','🐳','🦀','🐠','🦈'],la:tzw('天上'),lb:tzw('水里'),sa:'天上',sb:'水里'},
 {a:['🍎','🍓','🌹','🍅','❤️','🍒'],b:['🥦','🍀','🌲','🐸','🥒','🍏'],la:tz('红'),lb:tz('绿'),sa:'红',sb:'绿'},
 {a:['☀️','🌞','🌅','🌻'],b:['🌙','⭐','🦉','🌃'],la:tzw('白天'),lb:tzw('天黑'),sa:'白天',sb:'天黑了'},
 {a:['🚗','🚌','🚲','🚂','🚀','🚢'],b:['🐱','🐶','🐰','🐷','🐵','🦁'],la:'<span class="emo">🚦</span>',lb:'<span class="emo">🐾</span>',sa:'车',sb:'小动物'}];
G.sort=ctx=>{
  const big=ctx.w.id>=2&&Math.random()<.25;const n=ctx.w.id<=1?4:ctx.w.id<=2?6:8;
  let cat,items;
  if(big){const o=OBJ[rnd(OBJ.length)];cat={la:tz('大'),lb:tz('小'),sa:'大',sb:'小'};items=shuffle([...Array(n)].map((_,i)=>({e:o,g:i%2?'b':'a'})))}
  else{cat=CATS[rnd(CATS.length)];const A=shuffle(cat.a).slice(0,n/2),B=shuffle(cat.b).slice(0,n/2);items=shuffle([...A.map(e=>({e,g:'a'})),...B.map(e=>({e,g:'b'}))])}
  ctx.prompt('分一分：点一个，再点它的篮子',()=>say('分一分，点一个，再点它的篮子'));
  const top=el('div','sorttop');let sel=null,left=items.length;
  items.forEach(it=>{const b=el('button','obj sortit',`<span class="emo ${big?(it.g==='a'?'bigE':'smallE'):''}">${it.e}</span>`);b.onclick=()=>{if(b.dataset.done)return;top.querySelectorAll('.sel').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');sel={b,it};SFX.tick()};top.append(b)});
  const bins=el('div','bins');
  [['a',cat.la,cat.sa],['b',cat.lb,cat.sb]].forEach(([g,l,s])=>{const bin=el('button','bin',`<div class="blab">${l}</div><div class="bin-in"></div>`);bin.onclick=async()=>{
      if(!sel){say(s);bounce(bin);return}
      if(sel.it.g===g){const b=sel.b;sel=null;b.classList.remove('sel');b.dataset.done=1;bin.querySelector('.bin-in').append(b);SFX.ok();burstAt(bin,10);left--;say(s);if(left===0){ctx.right(bins,'分类');await sleep(600);ctx.done()}}
      else{ctx.wrong(bin,'分类'+s,()=>say('不对哦，想一想'));}};bins.append(bin)});
  ctx.box.append(top,bins);say('分一分，点一个，再点它的篮子')};

// ---- 大小排队 ----
G.size=ctx=>{
  const k=ctx.w.id<=2?3:ctx.w.id<=4?4:5;const d=D.DINOS[rnd(D.DINOS.length)];const up=ctx.w.id<=2||Math.random()<.5;
  const sizes=[...Array(k)].map((_,i)=>i);const p=up?'从小到大排排队':'从大到小排排队';
  ctx.prompt(p,()=>say(p));
  const field=el('div','sizefield');const line=el('div','sizeline');let next=0;const order=up?sizes:sizes.slice().reverse();
  shuffle(sizes).forEach(s=>{const b=el('button','sizeb',`<img src="${dimg(d.id)}" alt="" style="height:${2.4+s*1.3}em">`);b.onclick=async()=>{if(b.disabled)return;
    if(s===order[next]){b.disabled=true;line.append(b);SFX.pop();bounce(b);next++;if(next===k){ctx.right(line,'大小');await say(up?'从小到大！':'从大到小！');ctx.done()}}
    else ctx.wrong(b,'大小',()=>say(up?'先找最小的':'先找最大的'))};field.append(b)});
  ctx.box.append(el('div','show',up?`${tz('小')} → ${tz('大')}`:`${tz('大')} → ${tz('小')}`),field,line);say(p)};

// ---- 方位：上 下 里 前 后 ----
const MOV=[['小鸟','🐦'],['小猫','🐱'],['小狗','🐶'],['小兔','🐰'],['小虫','🐛']];
const REF=[['大树','🌳'],['家','🏠'],['小车','🚗']];
G.spatial=ctx=>{
  const pos=ctx.w.id<=1?['上','下']:ctx.w.id<=2?['上','下','里']:['上','下','里','前','后'];
  const t=pos[rnd(pos.length)];const m=MOV[rnd(MOV.length)];const r=t==='里'?['家','🏠']:REF[rnd(REF.length)];
  const q=`${m[0]}在${r[0]}的哪里？`;
  ctx.prompt(q,()=>say(q));
  const sc=el('div','scene p-'+({上:'up',下:'down',里:'in',前:'front',后:'back'})[t],`<span class="ref emo">${r[1]}</span><span class="mov emo">${m[1]}</span>`);
  const opts=shuffle(pos).slice(0,Math.min(pos.length,4));if(!opts.includes(t))opts[0]=t;
  const ans=t==='里'?`${m[0]}在${r[0]}里`:`${m[0]}在${r[0]}的${t}面`;
  ctx.box.append(sc,choices(ctx,opts.map(x=>({html:tz(x),ok:x===t})),{key:'方位'+t,onRight:()=>say(ans)}));
  say(q)};

// ---- 找形状 ----
const SH={circle:['圆形','<circle cx="50" cy="50" r="42"/>'],square:['正方形','<rect x="10" y="10" width="80" height="80" rx="4"/>'],triangle:['三角形','<polygon points="50,8 94,90 6,90"/>'],
 star:['星星','<polygon points="50,6 61,38 95,38 67,58 78,92 50,71 22,92 33,58 5,38 39,38"/>'],heart:['爱心','<path d="M50 88 C10 60 5 30 28 18 C40 12 50 22 50 30 C50 22 60 12 72 18 C95 30 90 60 50 88Z"/>'],rect:['长方形','<rect x="4" y="26" width="92" height="48" rx="4"/>']};
const SCOL=['#ff6b6b','#ffc93c','#4cc9f0','#7bd389','#b388ff','#ff9ed8'];
G.shape=ctx=>{
  const kinds=ctx.w.id<=2?['circle','square','triangle']:['circle','square','triangle','star','heart','rect'];
  const t=kinds[rnd(kinds.length)];const nT=2+rnd(ctx.w.id<=1?2:3);const N=ctx.w.id<=1?7:10;
  const list=shuffle([...Array(nT).fill(t),...[...Array(N-nT)].map(()=>{let k;do{k=kinds[rnd(kinds.length)]}while(k===t);return k})]);
  const p=`找出所有的${SH[t][0]}`;ctx.prompt(p,()=>say(p));
  const g=el('div','shapes');let left=nT;
  list.forEach(k=>{const b=el('button','shp',`<svg viewBox="0 0 100 100" style="transform:rotate(${k==='circle'?0:rnd(30)-15}deg) scale(${.75+Math.random()*.35})"><g fill="${SCOL[rnd(SCOL.length)]}">${SH[k][1]}</g></svg>`);
    b.onclick=async()=>{if(b.disabled)return;if(k===t){b.disabled=true;b.classList.add('got');SFX.ok();burstAt(b,10);left--;say(SH[t][0]);if(!left){ctx.right(g,'形状'+t);await sleep(400);ctx.done()}}else ctx.wrong(b,'形状'+t,()=>say('这是'+SH[k][0]))};g.append(b)});
  ctx.box.append(g);say(p)};

// ---- 影子配对 ----
const BODY={rex:'t',tar:'t',gig:'t',map:'t',all:'t',car:'t',ind:'t',rap:'r',tri:'q',ste:'s',ank:'a',bra:'l',pte:'f',mos:'m',spi:'p'};
G.shadow=ctx=>{
  const d=D.DINOS[rnd(D.DINOS.length)];const k=ctx.w.id<=2?3:4;
  const pool=ctx.w.id<=3?D.DINOS.filter(x=>BODY[x.id]!==BODY[d.id]):D.DINOS.filter(x=>x.id!==d.id);
  const ds=shuffle(pool).filter((x,i,a)=>ctx.w.id>3||a.findIndex(y=>BODY[y.id]===BODY[x.id])===i).slice(0,k-1);
  const rev=ctx.w.id>=3&&Math.random()<.4;
  const p=rev?'哪个是它的影子？':'这是谁的影子？';ctx.prompt(p,()=>say(p));
  const im=(id,sh)=>`<img class="${sh?'sil':'col'}" src="${dimg(id)}" alt="">`;
  ctx.box.append(el('div','show shadowshow',im(d.id,!rev)),choices(ctx,[{html:im(d.id,rev),ok:1},...ds.map(x=>({html:im(x.id,rev)}))],{cls:'opt dopt',key:'影子',onRight:async(o,b)=>{ctx.box.querySelector('.shadowshow img').className='col';await say(d.n)}}));
  say(p)};

// ---- 哪个不一样 ----
const GRP=[['🍎','🍌','🍇','🍓','🍉','🍐'],['🐱','🐶','🐰','🐻','🐮','🐷'],['🚗','🚌','🚲','🚂','✈️','🚀'],['🐟','🐙','🐳','🦀','🐠','🦈'],['👕','👗','🧦','🧢','👖','🧣'],['🌸','🌻','🌹','🌷','🌼','🌺']];
G.oddone=ctx=>{
  const k=ctx.w.id>=4?5:4;const num=ctx.w.id>=4&&Math.random()<.35;let opts;
  if(num){const n=2+rnd(4);const o=OBJ[rnd(OBJ.length)];const odd=n+(rnd(2)?1:-1);opts=[...Array(k-1)].map(()=>({html:`<span class="og">${o.repeat(n)}</span>`})).concat([{html:`<span class="og">${o.repeat(odd)}</span>`,ok:1}])}
  else{const [A,B]=shuffle(GRP);opts=shuffle(A).slice(0,k-1).map(e=>({html:emo(e)})).concat([{html:emo(B[rnd(B.length)]),ok:1}])}
  ctx.prompt('哪个不一样？',()=>say('哪个不一样？'));
  ctx.box.append(choices(ctx,opts,{key:'不一样',cols:k,onRight:()=>say('对！它不一样')}));say('哪个不一样？')};

// ---- 小数独 3×3 ----
const SUS=[['🍎','🍌','🍇'],['🔴','🔵','🟡'],['🐱','🐶','🐰'],['⭐','🌙','☀️']];
G.sudoku=ctx=>{
  const sym=shuffle(SUS[rnd(SUS.length)]);const rows=shuffle([0,1,2]),cols=shuffle([0,1,2]);
  const sol=rows.map(r=>cols.map(c=>sym[(r+c)%3]));
  const nb=ctx.w.id<=2?1:ctx.w.id<=3?2:ctx.w.id<=4?3:4;const blanks=shuffle([...Array(9).keys()]).slice(0,nb);
  ctx.prompt('小数独：每一行、每一列都不一样',()=>say('小数独！每一行、每一列，都要不一样'));
  const g=el('div','sgrid');let selCell=null,left=nb;
  const cells=[...Array(9)].map((_,i)=>{const r=Math.floor(i/3),c=i%3;const isB=blanks.includes(i);const d=el('button','sc'+(isB?' blank':''),isB?'?':`<span class="emo">${sol[r][c]}</span>`);
    d.onclick=()=>{if(!d.classList.contains('blank'))return;cells.forEach(x=>x.classList.remove('sel'));d.classList.add('sel');selCell={d,i};SFX.tick()};g.append(d);return d});
  const pal=el('div','opts');pal.style.setProperty('--cols',3);
  sym.forEach(s=>{const b=el('button','opt',`<span class="emo">${s}</span>`);b.onclick=async()=>{
    if(!selCell){selCell={d:cells[blanks.find(i=>cells[i].classList.contains('blank'))],i:blanks.find(i=>cells[i].classList.contains('blank'))}}
    const {d,i}=selCell;const r=Math.floor(i/3),c=i%3;
    if(sol[r][c]===s){d.innerHTML=`<span class="emo">${s}</span>`;d.classList.remove('blank','sel');d.classList.add('fill');SFX.ok();burstAt(d,10);selCell=null;left--;if(!left){ctx.right(g,'数独');await sleep(500);ctx.done()}else{const nx=blanks.find(j=>cells[j].classList.contains('blank'));cells[nx].classList.add('sel');selCell={d:cells[nx],i:nx}}}
    else ctx.wrong(d,'数独',()=>say('这一行、这一列已经有它了'))};pal.append(b)});
  ctx.box.append(g,pal);
  const f=blanks[0];cells[f].classList.add('sel');selCell={d:cells[f],i:f};
  say('小数独！每一行、每一列，都要不一样')};

// ---- 搭房子 ----
// 积木: t 类型, x y w h 格子坐标, dep 先要搭好的积木, c 颜色组(w 墙 r 顶 d 门 b 积木)
const HOUSES={
 hut:{n:'小木屋',W:4,H:4,p:[{t:'wall',x:.5,y:2,w:3,h:2,c:'w'},{t:'roof',x:.25,y:.8,w:3.5,h:1.2,c:'r',dep:[0]},{t:'door',x:1.6,y:2.8,w:.8,h:1.2,c:'d',dep:[0]}]},
 dome:{n:'圆顶屋',W:4,H:3.6,p:[{t:'wall',x:.5,y:2,w:3,h:1.6,c:'w'},{t:'dome',x:.5,y:.4,w:3,h:1.6,c:'r',dep:[0]},{t:'door',x:1.6,y:2.4,w:.8,h:1.2,c:'d',dep:[0]}]},
 tower:{n:'积木塔',W:3,H:5,p:[{t:'block',x:.5,y:4,w:2,h:1,c:'b0'},{t:'block',x:.5,y:3,w:2,h:1,c:'b1',dep:[0]},{t:'block',x:.5,y:2,w:2,h:1,c:'b2',dep:[1]},{t:'roof',x:.3,y:.9,w:2.4,h:1.1,c:'r',dep:[2]},{t:'flag',x:1.2,y:0,w:.6,h:.9,c:'r',dep:[3]}]},
 win:{n:'窗户屋',W:4,H:4,p:[{t:'wall',x:.5,y:2,w:3,h:2,c:'w'},{t:'door',x:.9,y:2.8,w:.8,h:1.2,c:'d',dep:[0]},{t:'win',x:2.2,y:2.4,w:.9,h:.8,c:'f',dep:[0]},{t:'roof',x:.25,y:.8,w:3.5,h:1.2,c:'r',dep:[0]}]},
 chim:{n:'烟囱屋',W:4,H:4.4,p:[{t:'wall',x:.5,y:2.4,w:3,h:2,c:'w'},{t:'chim',x:2.5,y:.6,w:.5,h:1.4,c:'r2',dep:[0]},{t:'roof',x:.25,y:1.2,w:3.5,h:1.2,c:'r',dep:[0]},{t:'door',x:.9,y:3.2,w:.8,h:1.2,c:'d',dep:[0]},{t:'win',x:2.2,y:2.8,w:.9,h:.8,c:'f',dep:[0]}]},
 two:{n:'两层楼',W:4,H:6,p:[{t:'wall',x:.5,y:4,w:3,h:2,c:'w'},{t:'wall',x:.5,y:2.2,w:3,h:1.8,c:'w2',dep:[0]},{t:'door',x:1.6,y:4.8,w:.8,h:1.2,c:'d',dep:[0]},{t:'win',x:.9,y:2.7,w:.8,h:.8,c:'f',dep:[1]},{t:'win',x:2.3,y:2.7,w:.8,h:.8,c:'f',dep:[1]},{t:'roof',x:.25,y:1,w:3.5,h:1.2,c:'r',dep:[1]}]},
 twin:{n:'双胞胎屋',W:7,H:4,p:[{t:'wall',x:.3,y:2,w:3,h:2,c:'w'},{t:'roof',x:.05,y:.8,w:3.5,h:1.2,c:'r',dep:[0]},{t:'door',x:1.4,y:2.8,w:.8,h:1.2,c:'d',dep:[0]},{t:'wall',x:3.7,y:2,w:3,h:2,c:'w2'},{t:'roof',x:3.45,y:.8,w:3.5,h:1.2,c:'r2',dep:[3]},{t:'win',x:4.75,y:2.5,w:.9,h:.8,c:'f',dep:[3]}]},
 castle:{n:'恐龙城堡',W:6,H:5,p:[{t:'wall',x:0,y:1.6,w:1.4,h:3.4,c:'w'},{t:'wall',x:4.6,y:1.6,w:1.4,h:3.4,c:'w'},{t:'wall',x:1.4,y:2.6,w:3.2,h:2.4,c:'w2'},{t:'door',x:2.5,y:3.6,w:1,h:1.4,c:'d',dep:[2]},{t:'roof',x:-.1,y:.5,w:1.6,h:1.1,c:'r',dep:[0]},{t:'roof',x:4.5,y:.5,w:1.6,h:1.1,c:'r',dep:[1]},{t:'flag',x:2.7,y:1.7,w:.6,h:.9,c:'r2',dep:[2]}]}};
const HLV={1:['hut','dome','tower'],2:['win','chim','tower'],3:['chim','two','twin'],4:['two','castle','twin'],5:['castle','two','twin']};
const WALLC=['#f7b267','#9ad1d4','#c3e88d','#f7d6e0','#ffd166','#b8c0ff','#fde2b6'],ROOFC=['#e63946','#577590','#2a9d8f','#8338ec','#f3722c'],DOORC=['#8d5524','#6a4c93','#2b7a78'],BLKC=['#ff6b6b','#ffc93c','#4cc9f0','#7bd389','#b388ff'];
function houseColors(){const w=shuffle(WALLC),r=shuffle(ROOFC),b=shuffle(BLKC);return{w:w[0],w2:w[1],r:r[0],r2:r[1],d:DOORC[rnd(3)],f:'#ffffff',b0:b[0],b1:b[1],b2:b[2]}}
function pieceHTML(p,col,cls=''){return `<div class="blk t-${p.t} ${cls}" style="--c:${col[p.c]}">${p.t==='flag'?'<span>🚩</span>':''}</div>`}
function houseMini(h){const T=HOUSES[h.t];if(!T)return'';return `<div class="hmini" data-ar="${T.W/T.H}" style="aspect-ratio:${T.W}/${T.H};width:min(100%,${(7*T.W/T.H).toFixed(2)}em)">${T.p.map(p=>`<div class="hslot" style="left:${p.x/T.W*100}%;top:${p.y/T.H*100}%;width:${p.w/T.W*100}%;height:${p.h/T.H*100}%">${pieceHTML(p,h.col)}</div>`).join('')}</div>`}
function buildHouse(ctx,{tid,onBuilt}={}){
  const lv=ctx.w.id;const id=tid||HLV[lv][rnd(3)];const T=HOUSES[id];const col=houseColors();
  const colorGhost=lv<=2;const nDis=lv<=1?1:lv<=2?1:lv<=3?2:3;
  const p0=`搭房子：${T.n}！先搭下面，再搭上面`;ctx.prompt(p0,()=>say('搭房子！先搭下面，再搭上面'));
  const wrap=el('div','hwrap');const board=el('div','hboard');board.style.aspectRatio=`${T.W}/${T.H}`;board.dataset.ar=T.W/T.H;
  const placed=T.p.map(()=>false);
  const slots=T.p.map((p,i)=>{const s=el('div','hslot ghost'+(colorGhost?'':' gray'),pieceHTML(p,col));s.style.cssText=`left:${p.x/T.W*100}%;top:${p.y/T.H*100}%;width:${p.w/T.W*100}%;height:${p.h/T.H*100}%;z-index:${p.t==='chim'?1:p.t==='roof'||p.t==='dome'?3:p.t==='wall'||p.t==='block'?2:4}`;s.dataset.i=i;board.append(s);return s});
  if(!colorGhost){const bp=el('div','blueprint',`<div class="bplab">📋 图纸</div>${houseMini({t:id,col})}`);wrap.append(bp)}
  wrap.append(board);
  // 积木盒：需要的 + 干扰
  const need=T.p.map((p,i)=>({t:p.t,c:p.c,i}));const dis=[];const types=['wall','roof','door','win','block','dome'];
  for(let k=0;k<nDis;k++){const base=T.p[rnd(T.p.length)];if(lv>=2&&base.t!=='flag'){const keys=Object.keys(col).filter(x=>col[x]!==col[base.c]&&x!=='f');dis.push({t:base.t,c:keys[rnd(keys.length)],x:1})}else dis.push({t:types[rnd(types.length)],c:'r2',x:1})}
  const tray=el('div','htray');let sel=null;
  const unit=Math.min(3.2,16/Math.max(T.W,T.H));
  shuffle([...need,...dis]).forEach(q=>{const P=T.p.find(p=>p.t===q.t)||{w:1,h:1,t:q.t};const b=el('button','hpiece',`<div style="width:${Math.min(5.5,P.w*unit*.8)}em;height:${Math.min(4.2,P.h*unit*.8)}em">${pieceHTML({t:q.t,c:q.c},col)}</div>`);b.q=q;
    b.onclick=()=>{if(b.disabled)return;tray.querySelectorAll('.sel').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');sel=b;SFX.tick();
      // 自动找能放的位置
      const i=T.p.findIndex((p,j)=>!placed[j]&&p.t===q.t&&col[p.c]===col[q.c]);
      if(i<0){ctx.wrong(b,'搭房子',()=>say('这块用不上哦'));b.classList.remove('sel');sel=null;b.classList.add('nouse');return}
      const deps=(T.p[i].dep||[]).filter(j=>!placed[j]);
      if(deps.length){shake(b);SFX.no();say('先搭下面的！');deps.forEach(j=>{slots[j].classList.add('hintg');setTimeout(()=>slots[j].classList.remove('hintg'),1200)});return}
      place(i,b)};tray.append(b)});
  async function place(i,b){placed[i]=true;b.disabled=true;b.classList.add('used');sel=null;slots[i].classList.remove('ghost','gray');slots[i].classList.add('built');SFX.pop();bounce(slots[i]);burstAt(slots[i],12);C.markRight('搭房子');
    if(placed.every(x=>x)){board.classList.add('done');SFX.fanfare();C.bigConfetti();
      const S=C.S();S.town=S.town||[];S.town.push({t:id,col});if(S.town.length>40)S.town.shift();C.save();
      await say(T.n+'搭好啦！');
      // 搭完数一数（第 2 个世界起）
      if(lv>=2){tray.remove();const n=T.p.length;const zh=lv>=3&&Math.random()<.5;ctx.prompt('这座房子用了几块积木？',()=>say('这座房子用了几块积木？'));
        const qs=choices(ctx,[{html:numH(n,zh),ok:1},...near(n,3,10).slice(0,2).map(x=>({html:numH(x,zh)}))],{key:'数数'+n,onRight:async()=>{await say(ZH[n]+'块');if(onBuilt)onBuilt()}});
        wrap.after(qs);say('这座房子用了几块积木？')}
      else{if(onBuilt)onBuilt();ctx.done()}}}
  ctx.box.append(wrap,tray);say('搭房子！先搭下面，再搭上面')}
G.house=ctx=>buildHouse(ctx);

G._math={HOUSES,houseMini,buildHouse,ZH};
})();
