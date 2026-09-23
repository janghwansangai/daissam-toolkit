// 미리보기·녹화·사진만 한다. 만든 것은 저장을 눌러야 파일로 내려가고, 그 전에는 이 창의
// 메모리에만 있다. 어디로도 보내지 않는다.
(() => {
  const $=id=>document.getElementById(id);
  let stream=null,recorder=null,chunks=[],takes=0;
  const stamp=()=>new Date().toISOString().replace(/[:T]/g,'-').slice(0,19);
  function save(blob,name){
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;link.download=name;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  function ready(on){
    $('record').disabled=!on;$('shot').disabled=!on;$('stop').disabled=!on;$('start').disabled=on;
  }
  function say(text,live){ $('state').textContent=text; $('state').classList.toggle('live',!!live); }

  // 카메라·마이크 목록. 이름은 권한을 준 뒤에야 보이므로 켠 다음에도 다시 채운다.
  async function listDevices(){
    let devices=[];
    try{devices=await navigator.mediaDevices.enumerateDevices();}catch{return;}
    fill($('cam-pick'),devices.filter(d=>d.kind==='videoinput'),'카메라');
    fill($('mic-pick'),devices.filter(d=>d.kind==='audioinput'),'마이크');
  }
  function fill(box,devices,kind){
    const chosen=box.value;
    const keep=[...box.querySelectorAll('option')].filter(o=>!o.dataset.device);
    box.replaceChildren(...keep);
    devices.forEach((device,index)=>{
      const option=document.createElement('option');
      option.value=device.deviceId;option.dataset.device='1';
      option.textContent=device.label||`${kind} ${index+1}`;
      box.append(option);
    });
    if([...box.options].some(o=>o.value===chosen))box.value=chosen;
  }

  // 만든 것은 목록에 쌓아 두고, 저장을 눌러야 파일로 내려간다.
  function addTake(kind,blob,name){
    const url=URL.createObjectURL(blob);
    const card=document.createElement('div');card.className='take';
    const head=document.createElement('div');head.className='take-head';
    const title=document.createElement('span');
    title.textContent=`${kind} ${++takes} · ${Math.round(blob.size/1024).toLocaleString()} KB`;
    const keep=document.createElement('button');keep.className='keep';keep.type='button';keep.textContent='저장';
    const drop=document.createElement('button');drop.type='button';drop.textContent='지우기';
    head.append(title,keep,drop);
    const view=document.createElement(kind==='사진'?'img':'video');
    view.src=url; if(kind!=='사진'){view.controls=true;view.playsInline=true;}
    card.append(head,view);
    $('takes').prepend(card);
    keep.onclick=()=>{save(blob,name);keep.textContent='저장함';keep.disabled=true;};
    drop.onclick=()=>{URL.revokeObjectURL(url);card.remove();};
  }

  $('start').addEventListener('click',async()=>{
    const camera=$('cam-pick').value, mic=$('mic-pick').value;
    const want={
      video:camera?{deviceId:{exact:camera},width:1280,height:720}:{width:1280,height:720},
      audio:mic==='none'?false:(mic?{deviceId:{exact:mic}}:true)
    };
    try{stream=await navigator.mediaDevices.getUserMedia(want);}
    catch{
      // 고른 장치를 못 열면 기본 장치로 한 번 더 해 본다.
      try{stream=await navigator.mediaDevices.getUserMedia({video:true,audio:mic!=='none'});}
      catch{say('카메라를 열지 못했습니다. 브라우저 권한과 다른 앱이 쓰고 있는지 확인해 주세요.');return;}
    }
    $('view').srcObject=stream;ready(true);say('켜짐');
    await listDevices();
  });
  $('stop').addEventListener('click',()=>{
    if(recorder&&recorder.state!=='inactive')recorder.stop();
    if(stream)stream.getTracks().forEach(track=>track.stop());
    stream=null;$('view').srcObject=null;ready(false);say('꺼짐');
  });
  $('record').addEventListener('click',()=>{
    if(recorder&&recorder.state==='recording'){recorder.stop();return;}
    chunks=[];
    recorder=new MediaRecorder(stream,{mimeType:MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm'});
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    recorder.onstop=()=>{
      const blob=new Blob(chunks,{type:'video/webm'});chunks=[];
      $('record').textContent='녹화 시작';
      if(blob.size){addTake('영상',blob,`웹캠-${stamp()}.webm`);say('켜짐 · 아래에서 들어 보고 저장하세요');}
      else say('켜짐');
    };
    recorder.start();$('record').textContent='녹화 멈춤';say('녹화 중',true);
  });
  $('shot').addEventListener('click',()=>{
    const view=$('view');
    if(!view.videoWidth){say('아직 영상이 준비되지 않았습니다.');return;}
    const canvas=document.createElement('canvas');
    canvas.width=view.videoWidth;canvas.height=view.videoHeight;
    canvas.getContext('2d').drawImage(view,0,0);
    canvas.toBlob(blob=>{
      if(!blob){say('사진을 만들지 못했습니다.');return;}
      addTake('사진',blob,`웹캠-${stamp()}.png`);say('켜짐 · 아래에서 보고 저장하세요');
    },'image/png');
  });
  // 장치를 끼우거나 빼면 목록을 다시 채운다.
  try{navigator.mediaDevices.addEventListener('devicechange',()=>{listDevices().catch(()=>{});});}catch{}
  listDevices().catch(()=>{});
  window.addEventListener('pagehide',()=>{if(stream)stream.getTracks().forEach(track=>track.stop());});
})();
