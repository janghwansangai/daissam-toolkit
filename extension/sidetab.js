// 자동 숨김 책갈피(v0.45.0). 사이드바 머리줄의 ‘자동 숨김’ 을 켜 두면, 그 창에 사이드바가 닫혀 있는 동안 페이지
// 오른쪽 끝에 반투명한 책갈피를 띄운다. 누르면 사이드바가 다시 열리고, 위아래로 끌면 자리를 옮긴다(자리는 이 컴퓨터의
// 모든 탭이 같이 쓴다). Chrome 은 사이드바를 ‘사용자가 누른 순간’ 에만 열어 준다 — 마우스를 올리면 책갈피가 또렷해질
// 뿐 열리지는 않는다(시험: Chrome 127 · 153 모두 올리기만 해서는 sidePanel.open 이 거절된다).
// 페이지의 글·주소는 읽지 않는다. 확장 저장소는 페이지 쪽에서 읽을 수 없게 막혀 있어(setAccessLevel) 설정 · 자리는
// 서비스 워커에게 묻고 받는다. 페이지를 열 때 한 번 묻고, 꺼져 있으면 그 뒤로는 서비스 워커가 알릴 때까지 묻지 않는다.
(() => {
  if(window!==window.top)return;
  try{globalThis.__daisSideTab?.dispose();}catch{}
  for(const stale of document.querySelectorAll('[data-dais-sidetab]'))stale.remove();   // 업데이트 전 판이 남긴 것
  const H=84,EDGE=8;
  let host=null,tab=null,view={on:false,show:false,spot:.5},drag=null,dragged=false,asked=0,disposed=false,later=[];
  const cleanups=[];
  const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);cleanups.push(()=>target.removeEventListener(type,fn,options));};
  const alive=()=>{try{return !disposed&&!!chrome.runtime?.id;}catch{return false;}};
  const clampSpot=value=>Number.isFinite(value)?Math.min(1,Math.max(0,value)):.5;
  const instance={dispose(){disposed=true;later.forEach(clearTimeout);host?.remove();host=null;for(const clean of cleanups){try{clean();}catch{}}}};
  globalThis.__daisSideTab=instance;
  const STYLE=`:host{all:initial}
button{all:unset;box-sizing:border-box;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;
  width:14px;height:${H}px;border-radius:12px 0 0 12px;background:rgba(23,59,54,.36);border:1px solid rgba(255,255,255,.5);border-right:0;
  box-shadow:-2px 3px 12px rgba(15,41,33,.16);color:#eaf7e2;cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none;overflow:hidden;
  font:700 11px/1 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;
  transition:width .16s ease,background .16s ease,box-shadow .16s ease}
.line{width:3px;height:28px;border-radius:2px;background:#dff39c;opacity:.9;transition:opacity .12s}
.mark,.name{position:absolute;opacity:0;transition:opacity .16s}
.mark{top:12px;font-size:15px;color:#dff39c}
.name{top:34px;writing-mode:vertical-rl;letter-spacing:1px}
button:hover,button.drag{width:30px;background:rgba(23,59,54,.94);box-shadow:-3px 4px 16px rgba(15,41,33,.32)}
button:hover .line,button.drag .line{opacity:0}
button:hover .mark,button:hover .name,button.drag .mark,button.drag .name{opacity:1}
button.drag{cursor:grabbing}
@media (prefers-reduced-motion:reduce){button,.line,.mark,.name{transition:none}}
@media print{button{display:none}}`;
  function build(){
    host=document.createElement('div');host.setAttribute('data-dais-sidetab','');
    const root=host.attachShadow({mode:'closed'});
    const style=document.createElement('style');style.textContent=STYLE;
    tab=document.createElement('button');tab.type='button';tab.tabIndex=-1;
    tab.title='다있쌤 사이드바 열기 — 누르면 열리고, 위아래로 끌면 자리를 옮깁니다';
    tab.setAttribute('aria-label','다있쌤 사이드바 열기');
    for(const [name,text] of [['line',''],['mark','✳'],['name','다있쌤']]){const span=document.createElement('span');span.className=name;span.textContent=text;tab.append(span);}
    root.append(style,tab);
    tab.addEventListener('pointerdown',down);tab.addEventListener('pointermove',move);
    tab.addEventListener('pointerup',up);tab.addEventListener('pointercancel',up);tab.addEventListener('click',open);
  }
  function place(){
    if(!host)return;
    const room=Math.max(0,innerHeight-H-EDGE*2);
    host.style.setProperty('top',Math.round(EDGE+room*view.spot)+'px','important');
  }
  function draw(){
    if(!(view.on&&view.show&&alive())){if(host)host.style.setProperty('display','none','important');return;}
    if(!host)build();
    host.style.cssText='all:initial;position:fixed!important;right:0!important;z-index:2147483646!important;display:block!important;margin:0!important;';
    place();
    if(!host.isConnected)document.documentElement.append(host);
  }
  function take(data){
    view={on:data?.on===true,show:data?.show===true,spot:drag?view.spot:clampSpot(data?.spot)};
    draw();
  }
  // 끌기: 5px 넘게 움직이면 옮기기, 그보다 적으면 누르기(열기)로 본다.
  function down(e){
    if(e.button!==0||!e.isTrusted)return;
    drag={y:e.clientY,top:host.getBoundingClientRect().top,id:e.pointerId};dragged=false;
    try{tab.setPointerCapture(e.pointerId);}catch{}
  }
  function move(e){
    if(!drag||e.pointerId!==drag.id)return;
    const dy=e.clientY-drag.y;
    if(!dragged&&Math.abs(dy)<5)return;
    dragged=true;tab.classList.add('drag');
    const room=Math.max(1,innerHeight-H-EDGE*2);
    const top=Math.min(Math.max(EDGE,drag.top+dy),EDGE+room);
    view.spot=(top-EDGE)/room;
    host.style.setProperty('top',Math.round(top)+'px','important');
  }
  function up(){
    if(!drag)return;
    drag=null;tab.classList.remove('drag');
    if(dragged&&alive())chrome.runtime.sendMessage({type:'side-spot',spot:Math.round(view.spot*1000)/1000}).catch(()=>{});
  }
  function open(e){
    if(!e.isTrusted)return;
    if(dragged){dragged=false;return;}
    if(!alive()){instance.dispose();return;}
    // 누른 그 순간에 서비스 워커가 바로 연다(sidePanel.open 은 누름이 있어야 허락된다).
    chrome.runtime.sendMessage({type:'side-open'}).then(reply=>{if(reply?.ok){view.show=false;draw();}}).catch(()=>{});
  }
  async function refresh(){
    if(!alive()){instance.dispose();return;}
    const n=++asked;
    try{const reply=await chrome.runtime.sendMessage({type:'side-tab'});if(n===asked&&reply?.ok)take(reply.data);}catch{}
  }
  const onMessage=(m,sender,reply)=>{
    if(!alive())return;
    if(m?.type==='side-tab-ping'){reply(view.on);return;}       // 사이드바가 숨기 전에 ‘책갈피가 뜰 수 있나’ 를 묻는다
    if(m?.type==='lock-state'){if(view.on)refresh();return;}   // 꺼져 있으면 잠금 알림마다 서비스 워커에 묻지 않는다
    if(m?.type!=='side-tab')return;
    ++asked;take(m);
    if(view.show||document.hidden){reply(true);return;}
    // 숨길 때는 화면에서 실제로 사라진 뒤에 답한다 — 곧바로 찍는 캡처에 책갈피가 담기지 않게.
    let done=false;const finish=()=>{if(!done){done=true;reply(true);}};
    requestAnimationFrame(()=>requestAnimationFrame(finish));setTimeout(finish,120);
    return true;
  };
  chrome.runtime.onMessage.addListener(onMessage);cleanups.push(()=>chrome.runtime.onMessage.removeListener(onMessage));
  // 사이드바가 열리고 닫히면 페이지 너비가 바뀐다. 닫힘 알림이 빠졌을 때를 대비해(Chrome 140 이하는 ✕ 로 닫으면 알림이
  // 오지 않았다) 그 뒤에 몇 번 더 묻는다. 서비스 워커는 ‘연 지 3초가 지난’ 사이드바만 바로잡으므로 마지막은 3초 뒤다.
  listen(window,'resize',()=>{
    if(!view.on)return;
    place();later.forEach(clearTimeout);
    later=[250,1450,3600].map(ms=>setTimeout(refresh,ms));
  });
  listen(document,'visibilitychange',()=>{if(!document.hidden&&view.on)refresh();});
  listen(window,'pageshow',e=>{if(e.persisted)refresh();});
  refresh();
})();
