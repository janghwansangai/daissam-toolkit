import {createChrome} from './chrome-mock.mjs';
const red='iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAM0lEQVR4nO3MMQEAAAgDoC251a3gLmQg7WYFAAAAAAAAAAAAAAAAAAAAAAAAAAAAgP8W3VoAAWQ1OVEAAAAASUVORK5CYII=';
const mock=createChrome({local:{printJob:{
  title:'금요일 발표 준비',
  text:'금요일 발표 준비\n\n• 새 프로젝트의 첫 화면 정리\n• 중요한 링크 모아 두기\n• 마무리 전에 프로필 잠그기',
  shots:['data:image/png;base64,'+red],
  time:Date.now()
}}});
window.chrome=mock.chrome;
window.__printed=0;
window.print=()=>{window.__printed++;};
await import('../extension/print.js');
