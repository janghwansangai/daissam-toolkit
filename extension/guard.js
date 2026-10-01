(() => {
  // 앞서 들어온 잠금 화면(같은 확장의 앞 주입, 또는 업데이트 전 버전이 남긴 것)은 새 것이 올라갈 때까지 그대로 둔다.
  // 시작하자마자 지우면, 새 주입이 서비스 워커에 상태를 묻고 답을 받는 동안 원래 화면이 그대로 드러나 깜박였다
  // (사용자 보고). 새 것이 ‘잠금’을 확인해 자기 화면을 올린 뒤에야 옛것을 걷는다 — 아래 retire().
  const previous=globalThis.__browserSheriffGuard||null;
  const stale=[...document.querySelectorAll('[data-browser-sheriff-guard]')];
  let host, controls=[], locked=true, revision=-1, wheelZoom=false, zoomAt=0, retired=false;
  let armZoom=()=>{};   // 맥에서만 아래에서 채운다
  // macOS 에는 Command + 휠로 화면 크기를 바꾸는 기능이 없다. Windows 는 Ctrl + 휠이 이미 한다.
  const onMac=/Mac/i.test((typeof navigator!=='undefined'&&(navigator.platform||navigator.userAgent))||'');
  const cleanups=[];
  function retire(){
    if(retired)return;retired=true;
    try{previous?.dispose();}catch{}
    for(const node of stale)if(node!==host)node.remove();
  }
  const instance={dispose(){retire();locked=false;host?.remove();host=null;for(const clean of cleanups){try{clean();}catch{}}}};
  globalThis.__browserSheriffGuard=instance;
  function runtimeAlive(){try{return !!chrome.runtime?.id;}catch{return false;}}
  function listen(target,type,fn,options){target.addEventListener(type,fn,options);cleanups.push(()=>target.removeEventListener(type,fn,options));}
  const topFrame=window===window.top;
  function render(s) {
    if(s.revision<revision)return;revision=s.revision;
    wheelZoom=s.wheelZoom!==false;
    locked=!!s.locked;
    blockScrolling(locked);if(locked)armZoom(false);
    if(!locked){host?.remove();host=null;retire();return;}
    if(host?.isConnected){retire();return;}
    host=document.createElement('div');host.setAttribute('data-browser-sheriff-guard','');
    host.style.cssText='position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;';
    const root=host.attachShadow({mode:'open'});
    const style=document.createElement('style');
    style.textContent=':host{all:initial}section{position:fixed;inset:0;background:#17452f;display:grid;place-content:center;text-align:center;font:16px system-ui;color:#eaf7e2;padding:32px}h1{font-size:30px;margin:12px 0}p{color:#c2dcc6;line-height:1.7;white-space:pre-line}button{font:inherit;border:0;border-radius:14px;padding:16px 24px;background:#dff39c;color:#16342b;cursor:pointer;font-weight:700}small{margin-top:22px;color:#8fb198}';
    const section=document.createElement('section');section.setAttribute('role','dialog');section.setAttribute('aria-modal','true');section.setAttribute('aria-label','프로필 잠금');
    const label=document.createElement('div');label.textContent='다있쌤 · 잠금';
    const title=document.createElement('h1');title.textContent=s.name+'입니다';
    const p=document.createElement('p');p.textContent='다른 프로필로 로그인하세요.\n계속 사용하려면 PIN 확인이 필요합니다.';
    const button=document.createElement('button');button.textContent='PIN 확인하기';
    button.addEventListener('click',()=>chrome.runtime.sendMessage({type:'open-unlock'}));
    const small=document.createElement('small');small.textContent='기존 탭과 입력한 내용은 그대로 남아 있습니다.';
    section.append(label,title,p);
    if(topFrame){
      const guest=document.createElement('button');guest.textContent='게스트 창으로 넘어가기';
      guest.style.cssText='margin-top:12px;background:#265640;color:#eaf7e2';
      guest.onclick=()=>{guest.textContent='여는 중…';chrome.runtime.sendMessage({type:'guest-window'}).then(r=>{guest.textContent=r?.ok?'열었습니다':'열지 못했습니다';},()=>{guest.textContent='열지 못했습니다';});};
      const close=document.createElement('button');close.textContent='이 창 닫기';
      close.style.cssText='margin-top:12px;background:#265640;color:#eaf7e2';
      close.onclick=()=>chrome.runtime.sendMessage({type:'close-guard-window'});
      section.append(button,guest,close,small);controls=[button,guest,close];
    }
    root.append(style,section);
    (document.body||document.documentElement||document).append(host);
    retire();
    document.activeElement?.blur();
    if(topFrame)button.focus({preventScroll:true});
    if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});
  }
  // 잠겨 있으면 입력이 페이지에 닿지 않게 가로챈다.
  const BLOCK={capture:true,passive:false};
  const block=type=>e=>{
    if(!runtimeAlive()){instance.dispose();return;}
    if(locked&&type==='keydown'&&e.key==='Tab'&&topFrame){
      e.preventDefault();e.stopImmediatePropagation();
      const index=controls.indexOf(host?.shadowRoot?.activeElement);
      controls[(index+(e.shiftKey?-1:1)+controls.length)%controls.length]?.focus();return;
    }
    if(locked&&!e.composedPath().includes(host)){e.preventDefault();e.stopImmediatePropagation();}
  };
  for(const type of ['click','dblclick','mousedown','pointerdown','keydown','keyup','beforeinput','input','paste','submit','dragstart'])listen(window,type,block(type),BLOCK);
  // 휠·터치는 스크롤을 막을 수 있는 입력이다. ‘막을 수 있다’(passive:false)고 등록해 두기만 해도 Chrome 은 그 입력마다 이
  // 페이지의 메인 스레드가 답하기를 기다렸다가 스크롤한다 — 실측(바쁜 페이지): 반응 중앙값 +5~11ms, 느린 쪽 +20ms.
  // 그래서 잠겨 있는 동안에만 듣는다. 풀려 있으면 아예 듣지 않아 스크롤이 Chrome 기본 경로(별도 스레드)를 탄다.
  let scrollBlockers=[];
  function blockScrolling(on){
    if(on&&!scrollBlockers.length){
      for(const type of ['wheel','touchstart']){const fn=block(type);window.addEventListener(type,fn,BLOCK);scrollBlockers.push([type,fn]);}
    }else if(!on&&scrollBlockers.length){
      for(const [type,fn] of scrollBlockers)window.removeEventListener(type,fn,BLOCK);
      scrollBlockers=[];
    }
  }
  cleanups.push(()=>blockScrolling(false));
  blockScrolling(true);   // 상태를 알기 전에는 잠긴 것으로 본다(막는 쪽이 안전하다)
  // macOS 에는 Command + 휠로 화면 크기를 바꾸는 기능이 없다. Windows 는 Ctrl + 휠이 이미 한다.
  // 휠을 가로채려면 막을 수 있는 듣는 쪽이 필요한데 늘 두면 모든 스크롤이 느려진다(위). 그래서 Command 를 누르는 동안만 둔다.
  // 키 입력은 포커스가 있는 프레임만 받는다. 못 받은 프레임(포커스가 다른 프레임에 있을 때)은 Command+휠의 첫 눈금을
  // 막지는 못하지만(그 한 눈금은 페이지도 같이 움직인다) 그 눈금에서 알아채 배율을 바꾸고 다음 눈금부터 막는다.
  if(onMac){
    let zoomOn=false;
    const zoomStep=event=>{
      // 휠은 아주 자주 온다. 배율 요청만 솎아 내고 페이지 이동은 매번 막는다.
      const now=Date.now();
      if(now-zoomAt<70)return;
      zoomAt=now;
      chrome.runtime.sendMessage({type:'page-zoom',step:event.deltaY>0?-1:1}).catch(()=>{});
    };
    const zoomWheel=event=>{
      if(!event.metaKey){armZoom(false);return;}   // 키를 뗐는데 놓친 경우: 스스로 물러난다
      if(!wheelZoom||locked||!runtimeAlive())return;
      event.preventDefault();
      zoomStep(event);
    };
    armZoom=on=>{
      if(on&&!zoomOn){window.addEventListener('wheel',zoomWheel,BLOCK);zoomOn=true;}
      else if(!on&&zoomOn){window.removeEventListener('wheel',zoomWheel,BLOCK);zoomOn=false;}
    };
    cleanups.push(()=>armZoom(false));
    const command=e=>armZoom(!!e.metaKey&&wheelZoom&&!locked);
    listen(window,'keydown',command,{capture:true,passive:true});
    listen(window,'keyup',command,{capture:true,passive:true});
    listen(window,'blur',()=>armZoom(false));
    listen(window,'wheel',event=>{
      if(!event.metaKey||zoomOn||!wheelZoom||locked||!runtimeAlive())return;
      armZoom(true);zoomStep(event);
    },{capture:true,passive:true});
  }
  async function refresh(){try{const r=await chrome.runtime.sendMessage({type:'state'});if(r?.ok)render(r.data);}catch{ /* During update keep the existing guard until reload. */ }}
  const pushed=m=>{if(m.type==='lock-state')render(m.state);};
  chrome.runtime.onMessage.addListener(pushed);cleanups.push(()=>chrome.runtime.onMessage.removeListener(pushed));
  listen(document,'DOMContentLoaded',()=>{if(host&&document.body){document.body.append(host);if(topFrame)controls[0]?.focus({preventScroll:true});}});
  listen(document,'visibilitychange',()=>{if(!document.hidden)refresh();});
  listen(window,'pageshow',refresh);
  refresh();
})();
