// 마이크와 시스템 소리를 녹음해 파일로 내려받기만 한다. 어디로도 보내지 않고 확장 안에도 남기지 않는다.
(() => {
  const $=id=>document.getElementById(id);
  const stamp=()=>new Date().toISOString().replace(/[:T]/g,'-').slice(0,19);
  // 소리마다 흐름이 같아서 한 틀로 묶는다. stream 은 실제 장치, gain 은 합칠 때의 크기.
  const sources={
    mic:{stream:null,node:null,gain:null,meter:null,bar:'mic-bar',box:'box-mic',use:'use-mic',vol:'mic-vol',label:'마이크',parts:[],recorder:null},
    sys:{stream:null,node:null,gain:null,meter:null,bar:'sys-bar',box:'box-sys',use:'use-sys',vol:'sys-vol',label:'시스템소리',parts:[],recorder:null}
  };
  let audio=null,mixed=null,mixRecorder=null,mixParts=[],running=false,paused=false;
  let began=0,held=0,heldFrom=0,ticker=null,levels=null;

  function warn(text){$('warn').textContent=text||'';}
  function say(text){$('state').textContent=text;}
  // 끝내면 바로 내려받지 않는다. 들어 보고 저장을 누를 때 내려받는다.
  let takes=[];
  function save(blob,name){
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;link.download=name;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),20000);
    return name;
  }
  function showTakes(){
    const host=$('takes');host.replaceChildren();
    for(const take of takes){
      const card=document.createElement('div');card.className='take';
      const head=document.createElement('div');head.className='take-head';
      const label=document.createElement('span');label.textContent=take.name;
      const keep=document.createElement('button');keep.className='keep';keep.textContent='저장';
      keep.addEventListener('click',()=>{
        save(take.blob,take.name);
        take.kept=true;keep.textContent='저장됨';keep.classList.remove('keep');keep.classList.add('kept');
      });
      const drop=document.createElement('button');drop.textContent='지우기';
      drop.addEventListener('click',()=>{URL.revokeObjectURL(take.url);takes=takes.filter(one=>one!==take);showTakes();});
      head.append(label,keep,drop);
      const player=document.createElement('audio');player.controls=true;player.preload='metadata';player.src=take.url;
      card.append(head,player);host.append(card);
    }
  }
  function pickType(){
    for(const type of ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'])
      if(MediaRecorder.isTypeSupported(type))return type;
    return '';
  }
  function clock(){
    const ms=(paused?heldFrom:Date.now())-began-held;
    const total=Math.max(0,Math.floor(ms/1000));
    const h=Math.floor(total/3600),m=Math.floor(total%3600/60),s=total%60;
    $('clock').textContent=(h?String(h).padStart(2,'0')+':':'')+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  }
  // 켜 두기만 해도 소리 크기를 보여 준다. 녹음 전에 마이크가 살아 있는지 눈으로 확인할 수 있다.
  function watchLevels(){
    if(levels)return;
    const step=()=>{
      for(const key of Object.keys(sources)){
        const source=sources[key];
        const bar=$(source.bar);
        if(!source.meter){bar.style.width='0%';continue;}
        const data=new Uint8Array(source.meter.fftSize);
        source.meter.getByteTimeDomainData(data);
        let sum=0;
        for(const value of data){const v=(value-128)/128;sum+=v*v;}
        const level=Math.sqrt(sum/data.length);
        bar.style.width=Math.min(100,Math.round(level*260))+'%';
      }
      levels=requestAnimationFrame(step);
    };
    levels=requestAnimationFrame(step);
  }
  function context(){
    if(!audio)audio=new AudioContext();
    if(audio.state==='suspended')audio.resume();
    return audio;
  }
  function attach(key,stream){
    const source=sources[key];
    source.stream=stream;
    const ctx=context();
    source.node=ctx.createMediaStreamSource(stream);
    source.gain=ctx.createGain();
    source.gain.gain.value=Number($(source.vol).value)/100;
    source.meter=ctx.createAnalyser();
    source.meter.fftSize=1024;
    source.node.connect(source.gain);
    source.gain.connect(source.meter);
    $(source.box).classList.remove('off');
    watchLevels();
  }
  function release(key){
    const source=sources[key];
    if(source.stream)source.stream.getTracks().forEach(track=>track.stop());
    try{source.node&&source.node.disconnect();source.gain&&source.gain.disconnect();}catch{}
    source.stream=null;source.node=null;source.gain=null;source.meter=null;
    $(source.box).classList.add('off');
    $(source.bar).style.width='0%';
  }
  async function openMic(){
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    attach('mic',stream);
    const track=stream.getAudioTracks()[0];
    $('mic-name').textContent=track?track.label.slice(0,42):'';
    track&&track.addEventListener('ended',()=>{$('use-mic').checked=false;release('mic');warn('마이크 연결이 끊겼습니다.');});
  }
  async function openSystem(){
    // Chrome 은 소리만 달라고 하면 거절한다. 화면 트랙을 함께 받아 두고 쓰지 않는다.
    // 화면 트랙을 끄면 공유 자체가 끝나 소리도 함께 끊긴다.
    const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
    if(!stream.getAudioTracks().length){
      stream.getTracks().forEach(track=>track.stop());
      throw new Error('소리 없이 화면만 공유되었습니다. 공유 창에서 ‘소리 공유’를 켜고 다시 시도해 주세요.');
    }
    attach('sys',stream);
    stream.getVideoTracks().forEach(track=>track.addEventListener('ended',()=>{
      $('use-sys').checked=false;release('sys');
      if(running)warn('화면 공유가 끝나 시스템 소리가 멈췄습니다. 녹음은 계속됩니다.');
    }));
  }
  function ready(){
    const on=running;
    $('go').disabled=on;$('hold').disabled=!on;$('stop').disabled=!on;
    $('use-mic').disabled=on;$('use-sys').disabled=on;
    document.querySelectorAll('input[name=mix]').forEach(box=>{box.disabled=on;});
    $('dot').classList.toggle('on',on&&!paused);
  }
  for(const key of Object.keys(sources)){
    const source=sources[key];
    $(source.use).addEventListener('change',async()=>{
      warn('');
      if(!$(source.use).checked){release(key);return;}
      try{ key==='mic' ? await openMic() : await openSystem(); }
      catch(error){
        $(source.use).checked=false;
        warn(error&&error.message&&!/Permission denied|NotAllowed/i.test(error.message)
          ? error.message
          : (key==='mic'?'마이크를 열지 못했습니다. 브라우저 권한을 확인해 주세요.':'화면·소리 공유가 취소되었습니다.'));
      }
    });
    $(source.vol).addEventListener('input',()=>{
      const value=Number($(source.vol).value);
      $(source.vol+'-out').textContent=value+'%';
      if(source.gain)source.gain.gain.value=value/100;
    });
  }
  function startOne(stream,bucket,type){
    const recorder=new MediaRecorder(stream,type?{mimeType:type}:undefined);
    recorder.ondataavailable=event=>{if(event.data.size)bucket.push(event.data);};
    recorder.start(1000);
    return recorder;
  }
  $('go').addEventListener('click',async()=>{
    warn('');
    const live=Object.keys(sources).filter(key=>sources[key].stream);
    if(!live.length){warn('녹음할 소리를 먼저 켜 주세요. 마이크나 시스템 소리 중 하나는 있어야 합니다.');return;}
    const type=pickType();
    const together=document.querySelector('input[name=mix]:checked').value==='together';
    mixParts=[];for(const key of live)sources[key].parts=[];
    try{
      if(together){
        const ctx=context();
        mixed=ctx.createMediaStreamDestination();
        for(const key of live)sources[key].gain.connect(mixed);
        mixRecorder=startOne(mixed.stream,mixParts,type);
      } else {
        for(const key of live){
          const ctx=context();
          const out=ctx.createMediaStreamDestination();
          sources[key].gain.connect(out);
          sources[key].outlet=out;
          sources[key].recorder=startOne(out.stream,sources[key].parts,type);
        }
      }
    }catch(error){warn('녹음을 시작하지 못했습니다. '+(error&&error.message||''));return;}
    running=true;paused=false;began=Date.now();held=0;ready();
    say('녹음 중');clock();ticker=setInterval(clock,250);
  });
  $('hold').addEventListener('click',()=>{
    const all=[mixRecorder,...Object.values(sources).map(s=>s.recorder)].filter(Boolean);
    if(!paused){
      all.forEach(r=>{if(r.state==='recording')r.pause();});
      paused=true;heldFrom=Date.now();$('hold').textContent='이어서 녹음';say('잠시 멈춤');
    } else {
      held+=Date.now()-heldFrom;
      all.forEach(r=>{if(r.state==='paused')r.resume();});
      paused=false;$('hold').textContent='잠시 멈춤';say('녹음 중');
    }
    ready();clock();
  });
  function finish(recorder,bucket,name,type){
    return new Promise(done=>{
      if(!recorder||recorder.state==='inactive'){done(null);return;}
      recorder.onstop=()=>{
        if(!bucket.length){done(null);return;}
        const blob=new Blob(bucket,{type:type||'audio/webm'});
        done({name,blob,url:URL.createObjectURL(blob),kept:false});
      };
      recorder.stop();
    });
  }
  $('stop').addEventListener('click',async()=>{
    if(!running)return;
    running=false;paused=false;clearInterval(ticker);ticker=null;
    $('hold').textContent='잠시 멈춤';ready();say('마무리하는 중…');
    const type=pickType();
    const when=stamp();
    const saved=[];
    const one=await finish(mixRecorder,mixParts,`녹음-${when}.webm`,type);
    if(one)saved.push(one);
    for(const key of Object.keys(sources)){
      const source=sources[key];
      const file=await finish(source.recorder,source.parts,`녹음-${source.label}-${when}.webm`,type);
      if(file)saved.push(file);
      if(source.recorder&&source.outlet){try{source.gain&&source.gain.disconnect(source.outlet);}catch{}}
      source.recorder=null;source.outlet=null;source.parts=[];
    }
    if(mixed){for(const key of Object.keys(sources)){try{sources[key].gain&&sources[key].gain.disconnect(mixed);}catch{}}}
    mixRecorder=null;mixParts=[];mixed=null;
    takes=saved.concat(takes);showTakes();
    say(saved.length?'들어 보고 저장을 누르세요':'녹음된 소리가 없습니다.');
  });
  // 녹음 중에 창이 닫히면 파일이 통째로 날아간다. 실수로 닫는 것을 한 번 막는다.
  window.addEventListener('beforeunload',event=>{
    if(!running && !takes.some(take=>!take.kept))return;
    event.preventDefault();event.returnValue='';
  });
  window.addEventListener('pagehide',()=>{
    for(const key of Object.keys(sources))release(key);
    for(const take of takes)URL.revokeObjectURL(take.url);
    if(audio)audio.close();
  });
  ready();
})();
