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
  let host=null,box=null,tab=null,list=null,tip=null,lockBtn=null,topNow=0,leaveTimer=0,tipTimer=0,view={on:false,show:false,spot:.5},drag=null,dragged=false,asked=0,disposed=false,later=[];
  const cleanups=[];
  const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);cleanups.push(()=>target.removeEventListener(type,fn,options));};
  const alive=()=>{try{return !disposed&&!!chrome.runtime?.id;}catch{return false;}};
  const clampSpot=value=>Number.isFinite(value)?Math.min(1,Math.max(0,value)):.5;
  const instance={dispose(){disposed=true;later.forEach(clearTimeout);clearTimeout(leaveTimer);clearTimeout(tipTimer);host?.remove();host=null;for(const clean of cleanups){try{clean();}catch{}}}};
  globalThis.__daisSideTab=instance;
  // 세로 도크: 사이드바 도크와 같은 단추, 같은 차례. null 은 묶음 사이 구분선.
  const SVG={area:[['path','M4.5 1.8v9.7h9.7'],['path','M1.8 4.5h9.7v9.7']],full:[['rect',3.2,1.8,7.6,12.4,1.4],['path','M13.6 5.5v6m-1.5-1.5 1.5 1.5 1.5-1.5']],pop:[['rect',1.8,3.4,8.4,7.2,1.3],['path','M8.6 5.4h5.6v7.2H6.2']],lock:[['rect',3.2,7,9.6,6.6,1.6],['path','M5.4 7V4.9a2.6 2.6 0 0 1 5.2 0V7']]};
  const ITEMS=[['start','▶','발표 시작'],['stop','■','발표 종료'],['focus','◉','집중 모드 켜기 · 끄기'],['snip','⛶','화면 조각 잘라 붙이기'],['through','◌','핀 클릭 통과 켜기 · 끄기'],['pins','⨯','핀 모두 닫기'],null,['area',null,'선택 영역 캡처 · 저장 + 복사'],['full',null,'스크롤 캡처 · 저장 + 복사'],null,['pop',null,'도크만 따로 띄우기'],['settings','⚙','프로필 설정'],['lock',null,'프로필 잠그기']];
  const WIDE=44,SEP=9;
  const STYLE=`:host{all:initial}
.box{position:relative;font:700 11px/1 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;color:#eaf7e2}
.head{all:unset;box-sizing:border-box;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;margin-left:auto;
  width:14px;height:${H}px;border-radius:12px 0 0 12px;background:rgba(23,59,54,.36);border:1px solid rgba(255,255,255,.5);border-right:0;
  box-shadow:-2px 3px 12px rgba(15,41,33,.16);color:#eaf7e2;cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none;overflow:hidden;
  transition:width .16s ease,background .16s ease,box-shadow .16s ease}
.line{width:3px;height:28px;border-radius:2px;background:#dff39c;opacity:.9;transition:opacity .12s}
.mark,.name{position:absolute;opacity:0;transition:opacity .16s}
.mark{top:12px;font-size:15px;color:#dff39c}
.name{top:34px;writing-mode:vertical-rl;letter-spacing:1px}
.open .head,.head.drag{width:${WIDE}px;background:rgba(23,59,54,.96);box-shadow:-3px 4px 16px rgba(15,41,33,.32)}
.open .line,.head.drag .line{opacity:0}
.open .mark,.open .name,.head.drag .mark,.head.drag .name{opacity:1}
.head.drag{cursor:grabbing}
.open.below .head{border-radius:12px 0 0 0}.open.above .head{border-radius:0 0 0 12px}
.list{display:none;position:absolute;right:0;width:${WIDE}px;box-sizing:border-box;flex-direction:column;align-items:center;padding:4px 0;background:rgba(23,59,54,.96);border:1px solid rgba(255,255,255,.5);border-right:0;box-shadow:-3px 4px 16px rgba(15,41,33,.32);overflow:hidden auto;scrollbar-width:none}
.open .list{display:flex}.below .list{top:100%;border-top:0;border-radius:0 0 0 12px}.above .list{bottom:100%;border-bottom:0;border-radius:12px 0 0 0}
.list button{all:unset;flex:none;box-sizing:border-box;width:36px;height:var(--b,38px);display:grid;place-content:center;border-radius:8px;font-size:15px;line-height:1;color:#eaf7e2;cursor:pointer}
.list button:hover{background:#dff39c;color:#16342b}
.list svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;display:block}
.sep{flex:none;width:24px;height:1px;margin:4px 0;background:rgba(255,255,255,.25)}
.tip{display:none;position:absolute;right:calc(100% + 8px);width:max-content;max-width:300px;padding:7px 11px;border-radius:9px;background:#173b36;color:#fff;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;box-shadow:0 5px 14px rgba(0,0,0,.3);pointer-events:none}
@media (prefers-reduced-motion:reduce){.head,.line,.mark,.name{transition:none}}
@media print{.box{display:none}}`;
  function icon(name){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 16 16');svg.setAttribute('aria-hidden','true');
    for(const [kind,...v] of SVG[name]){
      const part=document.createElementNS('http://www.w3.org/2000/svg',kind);
      if(kind==='path')part.setAttribute('d',v[0]);
      else for(const [i,k] of ['x','y','width','height','rx'].entries())part.setAttribute(k,String(v[i]));
      svg.append(part);
    }
    return svg;
  }
  function build(){
    host=document.createElement('div');host.setAttribute('data-dais-sidetab','');
    const root=host.attachShadow({mode:'closed'});
    const style=document.createElement('style');style.textContent=STYLE;
    box=document.createElement('div');box.className='box';
    tab=document.createElement('button');tab.className='head';tab.type='button';tab.tabIndex=-1;
    tab.title='다있쌤 사이드바 열기 — 누르면 열리고, 위아래로 끌면 자리를 옮깁니다';
    tab.setAttribute('aria-label','다있쌤 사이드바 열기');
    for(const [name,text] of [['line',''],['mark','✳'],['name','다있쌤']]){const span=document.createElement('span');span.className=name;span.textContent=text;tab.append(span);}
    list=document.createElement('div');list.className='list';list.setAttribute('role','toolbar');list.setAttribute('aria-label','빠른 조작');
    for(const item of ITEMS){
      if(!item){const line=document.createElement('div');line.className='sep';list.append(line);continue;}
      const [action,glyph,label]=item,b=document.createElement('button');
      b.type='button';b.tabIndex=-1;b.setAttribute('aria-label',label);b.setAttribute('data-action',action);
      if(glyph)b.textContent=glyph;else b.append(icon(action));
      b.addEventListener('click',e=>act(e,action));
      b.addEventListener('pointerenter',()=>say(label,b));
      b.addEventListener('pointerleave',()=>say(''));
      if(action==='lock')lockBtn=b;
      list.append(b);
    }
    tip=document.createElement('div');tip.className='tip';
    box.append(tab,list,tip);root.append(style,box);
    host.addEventListener('pointerenter',()=>{clearTimeout(leaveTimer);setOpen(true);});
    host.addEventListener('pointerleave',()=>{clearTimeout(leaveTimer);leaveTimer=setTimeout(()=>{if(!drag)setOpen(false);},260);});
    tab.addEventListener('pointerdown',down);tab.addEventListener('pointermove',move);
    tab.addEventListener('pointerup',up);tab.addEventListener('pointercancel',up);tab.addEventListener('click',open);
  }
  // 마우스가 올라갔던 그 자리에는 책갈피 머리가 그대로 있고 단추는 위나 아래로 펼친다 — 누르면 지금처럼 사이드바가 열린다.
  function layout(){
    if(!list)return;
    const shown=ITEMS.filter(x=>x&&(x[0]!=='lock'||!view.guest)).length,lines=ITEMS.filter(x=>!x).length*SEP+10;
    const below=innerHeight-topNow-H-EDGE,above=topNow-EDGE,need=shown*38+lines;
    const side=below>=need||below>=above?'below':'above',room=Math.max(0,side==='below'?below:above);
    const size=Math.max(24,Math.min(38,Math.floor((room-lines)/shown)));
    list.style.setProperty('--b',size+'px');list.style.maxHeight=room+'px';
    if(lockBtn)lockBtn.style.display=view.guest?'none':'';
    box.classList.toggle('below',side==='below');box.classList.toggle('above',side==='above');
    host.setAttribute('data-side',side);host.setAttribute('data-btn',String(size));
  }
  function setOpen(on){if(!box)return;if(on)layout();box.classList.toggle('open',on);if(!on)say('');}
  function say(text,near,ms=0){
    if(!tip)return;
    clearTimeout(tipTimer);tip.textContent=text;tip.style.display=text?'block':'none';
    if(text){const top=near?near.offsetTop+(list.getBoundingClientRect().top-box.getBoundingClientRect().top)+4:8;tip.style.top=top+'px';}
    if(ms)tipTimer=setTimeout(()=>say(''),ms);
  }
  function act(e,action){
    if(!e.isTrusted)return;
    if(!alive()){instance.dispose();return;}
    say('');
    if(action==='settings'){chrome.runtime.sendMessage({type:'side-open',page:'settings'}).then(reply=>{if(reply?.ok){view.show=false;draw();}}).catch(()=>{});return;}
    chrome.runtime.sendMessage({type:'side-dock',action}).then(reply=>{if(reply&&!reply.ok)say(reply.error||'하지 못했습니다.',null,6000);}).catch(()=>{});
  }
  function place(){
    if(!host)return;
    const room=Math.max(0,innerHeight-H-EDGE*2);
    topNow=Math.round(EDGE+room*view.spot);
    host.style.setProperty('top',topNow+'px','important');layout();
  }
  function draw(){
    if(!(view.on&&view.show&&alive())){if(host){setOpen(false);host.style.setProperty('display','none','important');}return;}
    if(!host)build();
    host.style.cssText='all:initial;position:fixed!important;right:0!important;z-index:2147483646!important;display:block!important;margin:0!important;';
    place();
    if(!host.isConnected)document.documentElement.append(host);
  }
  function take(data){
    view={on:data?.on===true,show:data?.show===true,guest:data?.guest===true,spot:drag?view.spot:clampSpot(data?.spot)};
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
    topNow=Math.round(top);host.style.setProperty('top',topNow+'px','important');layout();
  }
  function up(){
    if(!drag)return;
    drag=null;tab.classList.remove('drag');layout();
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
