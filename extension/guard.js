(() => {
  try{globalThis.__browserSheriffGuard?.dispose();}catch{}
  document.querySelectorAll('[data-browser-sheriff-guard]').forEach(node=>node.remove());
  let host, controls=[], locked=true, revision=-1, wheelZoom=false, zoomAt=0;
  // macOS 에는 Command + 휠로 화면 크기를 바꾸는 기능이 없다. Windows 는 Ctrl + 휠이 이미 한다.
  const onMac=/Mac/i.test((typeof navigator!=='undefined'&&(navigator.platform||navigator.userAgent))||'');
  const cleanups=[];
  const instance={dispose(){locked=false;host?.remove();host=null;for(const clean of cleanups){try{clean();}catch{}}}};
  globalThis.__browserSheriffGuard=instance;
  function runtimeAlive(){try{return !!chrome.runtime?.id;}catch{return false;}}
  function listen(target,type,fn,options){target.addEventListener(type,fn,options);cleanups.push(()=>target.removeEventListener(type,fn,options));}
  const topFrame=window===window.top;
  function render(s) {
    if(s.revision<revision)return;revision=s.revision;
    wheelZoom=s.wheelZoom!==false;
    locked=!!s.locked;
    if(!locked){host?.remove();host=null;return;}
    if(host?.isConnected)return;
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
    document.activeElement?.blur();
    if(topFrame)button.focus({preventScroll:true});
    if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});
  }
  for(const type of ['click','dblclick','mousedown','pointerdown','keydown','keyup','beforeinput','input','paste','wheel','touchstart','submit','dragstart']) {
    listen(window,type,e=>{
      if(!runtimeAlive()){instance.dispose();return;}
      if(locked&&type==='keydown'&&e.key==='Tab'&&topFrame){
        e.preventDefault();e.stopImmediatePropagation();
        const index=controls.indexOf(host?.shadowRoot?.activeElement);
        controls[(index+(e.shiftKey?-1:1)+controls.length)%controls.length]?.focus();return;
      }
      if(locked&&!e.composedPath().includes(host)){e.preventDefault();e.stopImmediatePropagation();}
    }, {capture:true,passive:false});
  }
  if(onMac) listen(window,'wheel',event=>{
    if(!wheelZoom||locked||!event.metaKey)return;
    if(!runtimeAlive())return;
    event.preventDefault();
    // 휠은 아주 자주 온다. 배율 요청만 솎아 내고 페이지 이동은 매번 막는다.
    const now=Date.now();
    if(now-zoomAt<70)return;
    zoomAt=now;
    chrome.runtime.sendMessage({type:'page-zoom',step:event.deltaY>0?-1:1}).catch(()=>{});
  },{capture:true,passive:false});
  async function refresh(){try{const r=await chrome.runtime.sendMessage({type:'state'});if(r?.ok)render(r.data);}catch{ /* During update keep the existing guard until reload. */ }}
  const pushed=m=>{if(m.type==='lock-state')render(m.state);};
  chrome.runtime.onMessage.addListener(pushed);cleanups.push(()=>chrome.runtime.onMessage.removeListener(pushed));
  listen(document,'DOMContentLoaded',()=>{if(host&&document.body){document.body.append(host);if(topFrame)controls[0]?.focus({preventScroll:true});}});
  listen(document,'visibilitychange',()=>{if(!document.hidden)refresh();});
  listen(window,'pageshow',refresh);
  refresh();
})();
