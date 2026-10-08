// Shown instead of Chrome's own block page so a blocked navigation looks the same as the in-page guard.
// 해시에는 Chrome 이 정리해 준 ‘원래 주소’ 가 그대로 들어 있다. 돌아갈 때는 그것을 한 글자도 바꾸지 않고 쓴다.
// 예전에는 이것을 decodeURIComponent 로 한 번 더 풀어 썼다 — 그러면 ?x=a%26b 가 ?x=a&b 로, ?next=https%3A%2F%2F… 가
// ?next=https://… 로 바뀌어 잠금이 풀린 뒤 다른 주소로 돌아갔고(검색 결과·로그인 뒤 돌아가기 주소가 흔히 그렇다),
// 주소에 홀로 있는 ‘%’(…/50% 같은)는 풀다가 예외가 나서 이 스크립트가 첫 줄에서 멈춰 단추가 하나도 안 걸렸다.
// 풀어 보이는 것은 안내 글에만 쓰고, 풀지 못하면 그대로 보여 준다.
const target=location.hash.slice(1);
let shown=target;
try{shown=decodeURIComponent(target);}catch{}
if(target){document.getElementById('target').textContent='잠금이 풀리면 '+shown+' 으로 돌아갑니다.';}
async function paint(){
  try{
    const r=await chrome.runtime.sendMessage({type:'state'});
    if(!r?.ok)return;
    document.getElementById('title').textContent=r.data.configured?r.data.name+'입니다':'잠겨 있습니다';
    document.getElementById('why').textContent=r.data.lockText||'';
    if(!r.data.locked)leave();
  }catch{}
}
function leave(){
  if(/^https?:\/\//i.test(target))location.replace(target);
  else location.replace('about:blank');
}
document.getElementById('unlock').addEventListener('click',()=>chrome.runtime.sendMessage({type:'open-unlock'}).catch(()=>{}));
document.getElementById('guest').addEventListener('click',async()=>{
  const button=document.getElementById('guest');
  button.disabled=true;
  try{
    const reply=await chrome.runtime.sendMessage({type:'guest-window'});
    button.textContent=reply?.ok&&reply.data?.mode==='guest'?'게스트 창을 열었습니다':'시크릿 창을 열었습니다';
  }catch{ button.textContent='창을 열지 못했습니다'; }
  finally{ setTimeout(()=>{button.disabled=false;button.textContent='게스트 창으로 넘어가기';},4000); }
});
document.getElementById('close').addEventListener('click',async()=>{
  try{const tab=await chrome.tabs.getCurrent();if(tab)await chrome.tabs.remove(tab.id);}catch{}
});
chrome.runtime.onMessage.addListener(m=>{if(m?.type==='state-changed'&&!m.state?.locked)leave();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)paint();});
paint();
