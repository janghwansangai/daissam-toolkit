// The side panel cannot open a print dialog, so printing happens in a normal tab.
(async () => {
  const $=id=>document.getElementById(id);
  let job=null;
  try{ job=(await chrome.storage.local.get('printJob')).printJob; }catch{}
  if(!job){ $('text').textContent='인쇄할 메모를 찾지 못했습니다. 사이드 패널에서 다시 눌러 주세요.'; $('text').className='empty'; return; }
  document.title=job.title||'메모';
  $('title').textContent=job.title||'메모';
  $('meta').textContent=new Date(job.time||Date.now()).toLocaleString()+' · 다있쌤';
  if(job.text) $('text').textContent=job.text;
  else { $('text').textContent='(내용이 없는 메모입니다)'; $('text').className='empty'; }
  for(const source of job.shots||[]){
    const image=document.createElement('img');image.src=source;image.alt='가져온 캡처';
    $('shots').append(image);
  }
  try{ await chrome.storage.local.remove('printJob'); }catch{}
  $('again').addEventListener('click',()=>window.print());
  $('close').addEventListener('click',()=>window.close());
  // Let the thumbnails decode first so they are not missing from the sheet.
  await new Promise(done=>{ if(document.readyState==='complete')done(); else window.addEventListener('load',done,{once:true}); });
  setTimeout(()=>window.print(),120);
})();
