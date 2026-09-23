import {createChrome} from './chrome-mock.mjs';
const mock=createChrome({local:{
  // 사이드바를 닫았다 연 상황을 흉내 내려고 저장된 값을 심어 둔다.
  watch:{from:Date.now()-12000,held:5000,laps:[9000,4000]},
  teams:[{name:'파랑',score:7},{name:'빨강',score:3}],
  toneBell:'bell',volumeBell:45,toneAlarm:'soft',volumeAlarm:25
}});window.chrome=mock.chrome;
window.__mock=mock; // 로컬 미리보기에서 네이티브 도우미 메시지를 흉내 내기 위한 참조
await import('../extension/background.js');
await chrome.runtime.sendMessage({type:'setup',name:'테스트 프로필',pin:'123456'});
await chrome.runtime.sendMessage({type:'note-save',id:'legacy',title:'금요일 발표 준비',text:'금요일 발표 준비\n\n• 새 프로젝트의 첫 화면 정리\n• 중요한 링크 모아 두기\n• 마무리 전에 프로필 잠그기'});
await chrome.runtime.sendMessage({type:'note-save',id:'shopping',title:'장보기 목록',text:'우유\n사과\n커피 원두'});
await chrome.runtime.sendMessage({type:'note-flush'});
await import('../extension/panel.js');
const badge=document.createElement('p');badge.textContent='UI 테스트용 · 실제 Chrome 동기화 아님';badge.style='text-align:center;color:#ad493b;font:11px system-ui';document.body.prepend(badge);
