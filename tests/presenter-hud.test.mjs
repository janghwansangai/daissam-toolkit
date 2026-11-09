// 맥 발표 화면 왼쪽 아래 안내: 원 크기는 집중 모드에서만 휠로 바뀌므로 발표 모드에는 적지 않는다(R-0003).
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const swift=readFileSync('presenter/macos/Presenter.swift','utf8');
test('발표 모드 안내에는 원 크기가 없고, 집중 모드 안내에만 있다',()=>{
  const line=swift.match(/let wheel=focus \? "([^"]+)" : "([^"]+)"/);
  assert.ok(line,'안내 글이 모드에 따라 갈린다');
  const [,focused,plain]=line;
  assert.match(focused,/⌃⌥휠 확대/);assert.match(focused,/⌃⌥⇧휠 원 크기/);
  assert.match(plain,/⌃⌥휠 확대/);assert.doesNotMatch(plain,/원 크기/);
  assert.match(swift,/event\.flags\.contains\(\.maskShift\) && app\.focus/,'안내의 근거: 원 크기 휠은 집중 모드에서만 듣는다');
  assert.doesNotMatch(swift,/let hud=[^\n]*원 크기/,'안내 줄에 원 크기를 그대로 박아 두지 않는다');
});
test('윈도우 확대는 커서가 있는 모니터의 렌즈만 따라간다 — 전체 화면 변환 · 주 모니터 갈래가 되살아나지 않는다',()=>{
  const cs=readFileSync('presenter/windows/Presenter.cs','utf8');
  const view=cs.slice(cs.indexOf('void UpdateView()'),cs.indexOf('void Stop()'));
  assert.ok(view.includes('lens.Look(zoom,'),'커서가 있는 모니터의 렌즈만 따라간다');
  assert.doesNotMatch(view,/MagSetFullscreenTransform|\.Primary/);
});

