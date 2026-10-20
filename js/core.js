// 核心：存档、语音、音效、特效、出题采样
(function(){
const D=window.DATA;
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
function el(tag,cls,html){const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e}
const rnd=n=>Math.floor(Math.random()*n);
const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=rnd(i+1);[a[i],a[j]]=[a[j],a[i]]}return a};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---------- 存档 ----------
const KEY='dino-adventure-2';
const today=()=>{const d=new Date();return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()};
function fresh(){return{v:1,started:false,hero:null,coins:0,food:0,stars:{},unlocked:1,eggs:[],inc:null,dinos:[],seen:{},miss:{},prev:[],nh:[],care:{},gift:'',best:{},plays:0,lastLevel:0,stats:{right:0,wrong:0}}}
let S=fresh();
function load(){try{const t=localStorage.getItem(KEY);if(t){S=Object.assign(fresh(),JSON.parse(t))}}catch(e){}}
function save(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}}
load();

// ---------- 语音 ----------
const AUD=window.AUD||{};
let cur=null,ttsTimer=0,speakId=0;
const isEn=t=>/^[A-Za-z ,.!?'-]+$/.test(t)||t.startsWith('ph:');
function stop(){speakId++;if(cur){try{cur.pause()}catch(e){}cur=null}try{speechSynthesis.cancel()}catch(e){}clearTimeout(ttsTimer)}
function findAud(t){if(AUD[t])return AUD[t];const a=t.replace(/[。！？]$/,'');if(AUD[a])return AUD[a];if(AUD[a+'。'])return AUD[a+'。'];return null}
let zhVoice=null,enVoice=null;
function pickVoices(){try{const vs=speechSynthesis.getVoices();zhVoice=vs.find(v=>/zh[-_]CN/i.test(v.lang)&&/female|xiao|ting|yu|mei|google/i.test(v.name))||vs.find(v=>/zh[-_]CN/i.test(v.lang))||vs.find(v=>/^zh/i.test(v.lang));enVoice=vs.find(v=>/en[-_]US/i.test(v.lang)&&/female|samantha|google|aria|ana/i.test(v.name))||vs.find(v=>/^en/i.test(v.lang))}catch(e){}}
try{pickVoices();speechSynthesis.onvoiceschanged=pickVoices}catch(e){}
function say1(t,id){return new Promise(res=>{
  if(id!==speakId)return res();
  const src=findAud(t);
  if(src){const a=new Audio(src);cur=a;let done=false;const fin=()=>{if(!done){done=true;res()}};a.onended=fin;a.onerror=fin;a.play().catch(fin);setTimeout(fin,12000);return}
  try{
    const u=new SpeechSynthesisUtterance(t.replace(/^ph:/,''));const en=isEn(t);u.lang=en?'en-US':'zh-CN';u.rate=en?.8:.82;u.pitch=1.2;
    const v=en?enVoice:zhVoice;if(v)u.voice=v;
    let done=false;const fin=()=>{if(!done){done=true;res()}};u.onend=fin;u.onerror=fin;
    speechSynthesis.speak(u);ttsTimer=setTimeout(fin,1500+t.length*420);
  }catch(e){res()}
})}
async function say(...ts){stop();const id=speakId;for(const t of ts.flat()){if(id!==speakId)return;await say1(t,id);if(id!==speakId)return;if(ts.length>1)await sleep(180)}}
function phon(l){return say('ph:'+l,'ph:'+l,EN_WORD[l])}
const EN_WORD={};D.EN.L.forEach(x=>EN_WORD[x[1]]=x[2]);

// ---------- 音效（WebAudio 合成）----------
let AC=null;
function ac(){if(!AC){try{AC=new (window.AudioContext||window.webkitAudioContext)()}catch(e){}}if(AC&&AC.state==='suspended')AC.resume();return AC}
function tone(f,d,type='sine',vol=.18,when=0,slide=0){const c=ac();if(!c)return;const t=c.currentTime+when;const o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(f,t);if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(40,f*slide),t+d);g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.001,t+d);o.connect(g);g.connect(c.destination);o.start(t);o.stop(t+d+.02)}
function noise(d,vol=.2,when=0,hp=800){const c=ac();if(!c)return;const t=c.currentTime+when;const b=c.createBuffer(1,c.sampleRate*d,c.sampleRate),a=b.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=(Math.random()*2-1)*(1-i/a.length);const s=c.createBufferSource();s.buffer=b;const f=c.createBiquadFilter();f.type='highpass';f.frequency.value=hp;const g=c.createGain();g.gain.value=vol;s.connect(f);f.connect(g);g.connect(c.destination);s.start(t)}
const SFX={
 ok(){tone(660,.12,'triangle',.2);tone(880,.14,'triangle',.2,.09);tone(1320,.2,'triangle',.16,.18)},
 no(){tone(220,.22,'sawtooth',.08,0,.7)},
 pop(){tone(500,.08,'square',.08,0,2.2)},
 coin(){tone(988,.08,'square',.08);tone(1319,.25,'square',.08,.07)},
 crack(){noise(.12,.35,0,1500);tone(180,.08,'square',.1)},
 boom(){noise(.5,.4,0,200);tone(90,.4,'sawtooth',.18,0,.5)},
 whoosh(){noise(.3,.12,0,2500)},
 hit(){noise(.15,.3,0,600);tone(140,.15,'square',.15,0,.5)},
 chomp(){tone(300,.06,'square',.12,0,.5);tone(260,.06,'square',.12,.1,.5)},
 fanfare(){[523,659,784,1047].forEach((f,i)=>tone(f,.25,'triangle',.18,i*.13));tone(1047,.6,'triangle',.18,.55)},
 tick(){tone(1200,.03,'square',.05)},
 jump(){tone(330,.15,'triangle',.15,0,2)}
};

// ---------- 特效 ----------
let cvs,cx,parts=[],raf=0;
function fxInit(){cvs=$('#fx');cx=cvs.getContext('2d');const r=()=>{cvs.width=innerWidth*devicePixelRatio;cvs.height=innerHeight*devicePixelRatio};r();addEventListener('resize',r)}
const COLORS=['#ff5d5d','#ffc93c','#4cc9f0','#7bd389','#b388ff','#ff8fd8'];
function confetti(x,y,n=40,spread=1){const dpr=devicePixelRatio;for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,v=(4+Math.random()*9)*spread;parts.push({x:x*dpr,y:y*dpr,vx:Math.cos(a)*v*dpr,vy:(Math.sin(a)*v-7)*dpr,r:(4+Math.random()*6)*dpr,c:COLORS[rnd(COLORS.length)],life:60+rnd(40),rot:Math.random()*6,vr:Math.random()*.4-.2,star:Math.random()<.3})}if(!raf)raf=requestAnimationFrame(step)}
function burstAt(e,n){const r=(e&&e.getBoundingClientRect)?e.getBoundingClientRect():{left:innerWidth/2,top:innerHeight/2,width:0,height:0};confetti(r.left+r.width/2,r.top+r.height/2,n)}
function bigConfetti(){for(let i=0;i<6;i++)setTimeout(()=>confetti(innerWidth*(.1+.8*Math.random()),innerHeight*.3,50,1.3),i*180)}
function step(){cx.clearRect(0,0,cvs.width,cvs.height);parts=parts.filter(p=>p.life-->0);for(const p of parts){p.vy+=.35*devicePixelRatio;p.x+=p.vx;p.y+=p.vy;p.vx*=.985;p.rot+=p.vr;cx.save();cx.translate(p.x,p.y);cx.rotate(p.rot);cx.fillStyle=p.c;cx.globalAlpha=Math.min(1,p.life/30);if(p.star){cx.beginPath();for(let k=0;k<10;k++){const rr=k%2?p.r*.45:p.r;cx.lineTo(Math.cos(k*Math.PI/5)*rr,Math.sin(k*Math.PI/5)*rr)}cx.fill()}else cx.fillRect(-p.r/2,-p.r/3,p.r,p.r*.66);cx.restore()}raf=parts.length?requestAnimationFrame(step):0}
function flyTo(fromEl,toSel,html,cls='fly'){const to=$(toSel);if(!to)return;const a=fromEl&&fromEl.getBoundingClientRect?fromEl.getBoundingClientRect():{left:innerWidth/2,top:innerHeight/2,width:0,height:0};const b=to.getBoundingClientRect();const f=el('div',cls,html);document.body.appendChild(f);const x0=a.left+a.width/2,y0=a.top+a.height/2,x1=b.left+b.width/2,y1=b.top+b.height/2;f.style.left=x0+'px';f.style.top=y0+'px';f.animate([{transform:'translate(-50%,-50%) scale(1)',offset:0},{transform:`translate(calc(-50% + ${(x1-x0)*.5}px),calc(-50% + ${(y1-y0)*.5-120}px)) scale(1.5)`,offset:.45},{transform:`translate(calc(-50% + ${x1-x0}px),calc(-50% + ${y1-y0}px)) scale(.6)`,offset:1}],{duration:900,easing:'cubic-bezier(.4,0,.3,1)'}).onfinish=()=>{f.remove();to.animate([{transform:'scale(1)'},{transform:'scale(1.3)'},{transform:'scale(1)'}],{duration:300})}}
function shake(e){e&&e.animate&&e.animate([{transform:'translateX(0)'},{transform:'translateX(-10px)'},{transform:'translateX(10px)'},{transform:'translateX(-6px)'},{transform:'translateX(0)'}],{duration:350})}
function bounce(e){e&&e.animate&&e.animate([{transform:'scale(1)'},{transform:'scale(1.18)'},{transform:'scale(1)'}],{duration:360,easing:'ease-out'})}
function bubble(text,ms=1600){const b=el('div','bubble',esc(text));document.body.appendChild(b);setTimeout(()=>b.classList.add('out'),ms);setTimeout(()=>b.remove(),ms+500)}

// ---------- 出题采样（不重复 + 错题多出）----------
let used=new Set();
function newLevelSession(){S.prev=[...used].slice(-80);used=new Set();save()}
function score(k){return(used.has(k)?10000:0)+(S.prev.includes(k)?800:0)+(S.seen[k]||0)*10-Math.min(5,S.miss[k]||0)*12+Math.random()*9}
function pick(pool,n=1,key=x=>Array.isArray(x)?x[0]:String(x),opt={}){
  let p=pool.filter(x=>!(opt.not||[]).includes(key(x)));
  // 第一级只作复习：大约 10%
  if(opt.review!==false){const nonL1=p.filter(x=>lvOf(key(x))>1);if(nonL1.length>=n&&Math.random()>.1)p=nonL1}
  const r=p.map(x=>[score(key(x)),x]).sort((a,b)=>a[0]-b[0]).slice(0,n).map(x=>x[1]);
  if(!opt.peek)r.forEach(x=>{const k=key(x);used.add(k);S.seen[k]=(S.seen[k]||0)+1});
  return n===1?r[0]:r}
function lvOf(t){let m=0;for(const c of String(t)){const l=D.lv(c);if(l>m)m=l}return m||1}
function pickNum(){const last=S.nh.slice(-1)[0];const cand=[1,2,3,4,5,6,7,8,9,10].filter(n=>n!==last);const sc=n=>(S.nh.slice(-6).filter(x=>x===n).length*10)+(used.has('n'+n)?5:0)+Math.random()*4-(S.miss['n'+n]||0)*2;const n=cand.sort((a,b)=>sc(a)-sc(b))[0];S.nh.push(n);S.nh=S.nh.slice(-20);used.add('n'+n);return n}
function pickLetter(){return pick(D.EN.L,1,x=>'L'+x[0])}
function markMiss(k){if(!k)return;S.miss[k]=(S.miss[k]||0)+1;S.stats.wrong++;save()}
function markRight(k){if(k&&S.miss[k])S.miss[k]=Math.max(0,S.miss[k]-.5);S.stats.right++}

// 同音字组：听音题里不能当干扰项
const HOMO=['在再','门们','是十','一衣','花画','妈马吗','爸八把','有又','美没','七起','书树','狼浪','他它','几己','早枣','见件','叶夜','和河','园原','王网','妹每','十石','里理','子字'];
const homo=(a,b)=>HOMO.some(g=>g.includes(a)&&g.includes(b));
const ALLCH=[...D.KNOWN].filter(c=>!'么吗吧啊着得了的和什'.includes(c));
// 生成 n 个干扰字：优先形近字
function distractChars(t,n,lookRate,{hear=true,pool=null}={}){
  const out=[];const ok=c=>c!==t&&!out.includes(c)&&!(hear&&homo(c,t))&&(D.KNOWN.has(c)||D.DISTRACT_OK.has(c));
  const looks=shuffle(D.LOOK.filter(g=>g.includes(t)).flat()).filter(ok);
  for(const c of looks){if(out.length>=n)break;if(Math.random()<lookRate||out.length===0&&Math.random()<lookRate*1.4)out.push(c)}
  const P=shuffle(pool||ALLCH);for(const c of P){if(out.length>=n)break;if(ok(c))out.push(c)}
  return out}
function hasLook(t){return D.LOOK.some(g=>g.includes(t))}

window.C={$,$$,el,rnd,shuffle,sleep,esc,S:()=>S,setS:x=>{S=x},fresh,save,load,today,say,stop,phon,EN_WORD,SFX,ac,fxInit,confetti,burstAt,bigConfetti,flyTo,shake,bounce,bubble,newLevelSession,pick,pickNum,pickLetter,markMiss,markRight,distractChars,hasLook,homo,lvOf,ALLCH,used:()=>used};
})();
