// 발표 도우미(Chrome 이 띄우는 네이티브 호스트)가 닫힌 통로에 써도 죽지 않는지 실제 바이너리로 본다.
// 2026-09-24 맥 실제 충돌 4건(v0.36.3~0.37.0): 녹화가 끝나 확장이 포트를 닫는 순간 늦게 도착한 소식에 답하다가
// FileHandle.write(_:) 가 Objective-C 예외(Broken pipe)를 던져 SIGABRT 로 죽었다. 고친 뒤에는 조용히 끝나야 한다.
// 윈도우도 같은 자리를 v0.39.4 에서 막았다(Send 의 try/catch). 두 운영체제에서 같은 시험을 돈다.
// 맥: presenter/macos/build.sh 로 앱을 빌드한 뒤. 윈도우: presenter/windows/build.sh 로 dist/windows/Presenter.exe 를 만든 뒤.
// HOST_BIN 으로 다른 바이너리를 시험할 수 있다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const BUILT = {
  darwin: '../dist/Browser Sheriff Presenter.app/Contents/MacOS/Presenter',
  win32: '../dist/windows/Presenter.exe',
}[process.platform];
const BIN = process.env.HOST_BIN || (BUILT && fileURLToPath(new URL(BUILT, import.meta.url)));
const skip = !BUILT || !BIN || !existsSync(BIN) ? '맥이나 윈도우에서 도우미를 빌드한 뒤에만 돈다' : false;
const posix = process.platform !== 'win32';
// 계약: 두 확장 ID(개발자 모드 판 · 크롬 웹 스토어 판)만 도우미를 부를 수 있다. 값을 바꾸지 말 것.
const DEV_ID = 'chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm/';
// 게시된 스토어 판(2026-10 확인 — 처음에 받아 둔 cgefng… 은 다른 항목이었다). 예전 항목 ID 도 계속 받는다.
const STORE_ID = 'chrome-extension://penklhfehmfoebmeolplklmjjcjhhnpi/';
const OLD_STORE_ID = 'chrome-extension://cgefngalkalghipmhijniclmlpimpmhf/';
const STRANGER = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
const frame = object => { const data = Buffer.from(JSON.stringify(object)); const head = Buffer.alloc(4); head.writeUInt32LE(data.length); return Buffer.concat([head, data]); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// 읽는 쪽(Chrome)이 통로를 닫은 뒤 명령을 보내고, 호스트가 어떻게 끝나는지 본다.
// ignoreSigpipe: 맥의 Chrome 은 SIGPIPE 를 무시하게 해 둔 채 호스트를 띄운다(실제 충돌이 SIGPIPE 가 아니라 예외였던 까닭).
// 윈도우에는 SIGPIPE 가 없다 — 닫힌 통로에 쓰면 IOException 이 난다.
async function closedPipe(messages, {ignoreSigpipe}) {
  const child = ignoreSigpipe
    ? spawn('/bin/sh', ['-c', 'trap "" PIPE; exec "$0" "$@"', BIN, DEV_ID], {stdio: ['pipe', 'pipe', 'ignore']})
    : spawn(BIN, [DEV_ID], {stdio: ['pipe', 'pipe', 'ignore']});
  const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({code, signal})));
  await sleep(700);                       // 호스트가 떠서 stdin 을 읽기 시작할 때까지
  child.stdout.destroy();                 // Chrome 이 포트를 닫으면 우리가 쓰는 통로의 읽는 쪽이 사라진다
  for (const message of messages) { child.stdin.write(frame(message)); await sleep(250); }
  child.stdin.end();                      // 호스트는 stdin 이 닫히면 스스로 끝낸다
  const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
  const result = await exited;
  clearTimeout(timer);
  return result;
}

// 통로를 열어 둔 채 메시지 하나를 보내고 답(없으면 null)과 끝난 모습을 돌려준다.
async function ask(origin, message) {
  const child = spawn(BIN, [origin], {stdio: ['pipe', 'pipe', 'ignore']});
  const chunks = [];
  child.stdout.on('data', chunk => chunks.push(chunk));
  child.stdin.on('error', () => {});      // 낯선 ID 면 호스트가 바로 끝나 쓰기가 실패할 수 있다
  const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({code, signal})));
  await sleep(700);
  child.stdin.write(frame(message)); await sleep(500);
  child.stdin.end();
  const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
  const ended = await exited;
  clearTimeout(timer);
  const bytes = Buffer.concat(chunks);
  const reply = bytes.length >= 4 ? JSON.parse(bytes.subarray(4, 4 + bytes.readUInt32LE(0)).toString('utf8')) : null;
  return {reply, bytes: bytes.length, ended};
}

for (const ignoreSigpipe of posix ? [true, false] : [false]) {
  test(`닫힌 통로에 써도 죽지 않는다 (${!posix ? '윈도우' : ignoreSigpipe ? 'SIGPIPE 무시: Chrome 과 같은 조건' : 'SIGPIPE 기본값'})`, {skip, timeout: 30000}, async () => {
    const [recorder, unknown] = await Promise.all([
      closedPipe([{type: 'recorder', action: 'hide'}], {ignoreSigpipe}),
      closedPipe([{type: 'nope'}], {ignoreSigpipe})]);
    assert.deepEqual(recorder, {code: 0, signal: null}, '녹화 표시기 소식에 답하다 죽었다');
    assert.deepEqual(unknown, {code: 0, signal: null}, '모르는 명령에 답하다 죽었다');
  });
}
test('통로가 열려 있으면 평소처럼 답한다(대조) · 두 확장 ID 모두', {skip, timeout: 30000}, async () => {
  for (const origin of process.platform === 'darwin' ? [DEV_ID, STORE_ID, OLD_STORE_ID] : [DEV_ID, STORE_ID]) {
    const {reply, ended} = await ask(origin, {type: 'nope'});
    assert.ok(reply, `${origin} 에 답이 없다(이 ID 를 믿지 않는다)`);
    assert.equal(reply.kind, 'unknown');
    assert.equal(reply.ok, false);
    assert.deepEqual(ended, {code: 0, signal: null});
  }
});
test('모르는 확장 ID 에는 한 글자도 답하지 않는다', {skip, timeout: 30000}, async () => {
  const {bytes, ended} = await ask(STRANGER, {type: 'nope'});
  assert.equal(bytes, 0, '모르는 확장에 답했다');
  assert.equal(ended.signal, null, '모르는 확장 ID 에 죽었다');
});
