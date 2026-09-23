// Shown instead of Chrome's own block page so a blocked navigation looks the same as the in-page guard.
const target=decodeURIComponent(location.hash.slice(1));
if(target){document.getElementById('target').textContent='잠금이 풀리면 '+target+' 으로 돌아갑니다.';}
async function paint(){
  try{
    const r=await chrome.runtime.sendMessage({type:'state'});
    if(!r?.ok)return;
    document.getElementById('title').textContent=r.data.configured?r.data.name+'입니다':'잠겨 있습니다';
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
