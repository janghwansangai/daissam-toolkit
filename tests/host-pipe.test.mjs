// 맥 도우미(Chrome 이 띄우는 네이티브 호스트)가 닫힌 통로에 써도 죽지 않는지 실제 바이너리로 본다.
// 2026-09-24 실제 충돌 4건(v0.36.3~0.37.0): 녹화가 끝나 확장이 포트를 닫는 순간 늦게 도착한 소식에 답하다가
// FileHandle.write(_:) 가 Objective-C 예외(Broken pipe)를 던져 SIGABRT 로 죽었다. 고친 뒤에는 조용히 끝나야 한다.
// 앱을 빌드해 둔 맥에서만 돈다(presenter/macos/build.sh). HOST_BIN 으로 다른 바이너리를 시험할 수 있다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const BIN = process.env.HOST_BIN || fileURLToPath(new URL('../dist/Browser Sheriff Presenter.app/Contents/MacOS/Presenter', import.meta.url));
const skip = process.platform !== 'darwin' || !existsSync(BIN) ? '맥에서 앱을 빌드한 뒤에만 돈다' : false;
const ID = 'chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm/';
const frame = object => { const data = Buffer.from(JSON.stringify(object)); const head = Buffer.alloc(4); head.writeUInt32LE(data.length); return Buffer.concat([head, data]); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// 읽는 쪽(Chrome)이 통로를 닫은 뒤 명령을 보내고, 호스트가 어떻게 끝나는지 본다.
// ignoreSigpipe: Chrome 은 SIGPIPE 를 무시하게 해 둔 채 호스트를 띄운다(실제 충돌이 SIGPIPE 가 아니라 예외였던 까닭).
async function closedPipe(messages, {ignoreSigpipe}) {
  const child = ignoreSigpipe
    ? spawn('/bin/sh', ['-c', 'trap "" PIPE; exec "$0" "$@"', BIN, ID], {stdio: ['pipe', 'pipe', 'ignore']})
    : spawn(BIN, [ID], {stdio: ['pipe', 'pipe', 'ignore']});
  const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({code, signal})));
  await sleep(700);                       // 호스트가 떠서 stdin 을 읽기 시작할 때까지
  child.stdout.destroy();                 // Chrome 이 포트를 닫으면 우리가 쓰는 통로의 읽는 쪽이 사라진다
  for (const message of messages) { child.stdin.write(frame(message)); await sleep(250); }
  child.stdin.end();                      // 호스트는 stdin 이 닫히면 4초 뒤 스스로 끝낸다
  const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
  const result = await exited;
  clearTimeout(timer);
  return result;
}

for (const ignoreSigpipe of [true, false]) {
  test(`닫힌 통로에 써도 죽지 않는다 (SIGPIPE ${ignoreSigpipe ? '무시: Chrome 과 같은 조건' : '기본값'})`, {skip, timeout: 30000}, async () => {
    const [recorder, unknown] = await Promise.all([
      closedPipe([{type: 'recorder', action: 'hide'}], {ignoreSigpipe}),
      closedPipe([{type: 'nope'}], {ignoreSigpipe})]);
    assert.deepEqual(recorder, {code: 0, signal: null}, '녹화 표시기 소식에 답하다 죽었다(SIGABRT/SIGPIPE)');
    assert.deepEqual(unknown, {code: 0, signal: null}, '모르는 명령에 답하다 죽었다');
  });
}
test('통로가 열려 있으면 평소처럼 답한다(대조)', {skip, timeout: 30000}, async () => {
  const child = spawn(BIN, [ID], {stdio: ['pipe', 'pipe', 'ignore']});
  const chunks = [];
  child.stdout.on('data', chunk => chunks.push(chunk));
  const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({code, signal})));
  await sleep(700);
  child.stdin.write(frame({type: 'nope'})); await sleep(500);
  const bytes = Buffer.concat(chunks);
  const reply = JSON.parse(bytes.subarray(4, 4 + bytes.readUInt32LE(0)).toString('utf8'));
  assert.equal(reply.kind, 'unknown');
  assert.equal(reply.ok, false);
  child.stdin.end();
  assert.deepEqual(await exited, {code: 0, signal: null});
});
