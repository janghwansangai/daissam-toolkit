// 서비스 워커에는 오디오가 없다. 소리를 낼 때마다 이 문서를 주소에 값을 실어 새로 띄우고,
// 다 울리면 스스로 닫는다. 메시지로 주고받으면 문서가 준비되기 전에 사라질 수 있다.
const SHAPES={
  chime:{steps:[[880,0,.18],[660,.16,.3]],type:'sine'},
  bell:{steps:[[1046,0,.5],[784,.12,.6],[1046,.5,.7]],type:'triangle'},
  beep:{steps:[[1200,0,.09],[1200,.14,.09],[1200,.28,.09]],type:'square'},
  soft:{steps:[[523,0,.5],[659,.18,.5],[784,.36,.7]],type:'sine'},
  school:{steps:[[784,0,.45],[659,.4,.45],[523,.8,.9]],type:'triangle'}
};
const asked=new URLSearchParams(location.search);
const shape=SHAPES[asked.get('tone')]||SHAPES.chime;
const level=Math.max(0,Math.min(1,Number(asked.get('volume'))/100||0.6));
const repeat=Math.max(1,Math.min(5,Number(asked.get('repeat'))||1));
const context=new AudioContext();
let finish=0;
for(let round=0;round<repeat;round++){
  const offset=round*1.1;
  for(const [hz,at,length] of shape.steps){
    const osc=context.createOscillator(),gain=context.createGain();
    osc.type=shape.type;osc.frequency.value=hz;
    const start=context.currentTime+offset+at;
    gain.gain.setValueAtTime(0,start);
    gain.gain.linearRampToValueAtTime(level,start+0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001,start+length);
    osc.connect(gain).connect(context.destination);
    osc.start(start);osc.stop(start+length+0.05);
    finish=Math.max(finish,offset+at+length);
  }
}
setTimeout(()=>{context.close().catch(()=>{});window.close();},(finish+0.6)*1000);
