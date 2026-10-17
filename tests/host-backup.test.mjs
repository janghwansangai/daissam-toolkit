// 발표 도우미(네이티브 호스트)의 자동 백업 명령을 실제 바이너리로 본다 — 맥 · 윈도우 공통 계약(v0.41.0).
//   backup-save {name,text} · backup-list · backup-read {name,offset,length} · backup-delete {names} · backup-open
// 답은 모두 {kind:'backup', op, ok, ...}. 이름은 정해진 모양(daissam-backup_YYYY-MM-DD_HH-MM-SS_<종류>_<기기6>.json)만 받는다.
// 사용자의 문서 폴더를 어지럽히지 않게 DAISSAM_BACKUP_DIR 로 임시 폴더를 쓴다(호스트는 이 값이 있으면 그 폴더를 쓴다).
// 맥: presenter/macos/build.sh 뒤. 윈도우: presenter/windows/build.sh 뒤. HOST_BIN 으로 다른 바이너리를 시험할 수 있다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const BUILT = {darwin: '../dist/Browser Sheriff Presenter.app/Contents/MacOS/Presenter', win32: '../dist/windows/Presenter.exe'}[process.platform];
const BIN = process.env.HOST_BIN || (BUILT && fileURLToPath(new URL(BUILT, import.meta.url)));
const skip = !BUILT || !BIN || !fs.existsSync(BIN) ? '맥이나 윈도우에서 도우미를 빌드한 뒤에만 돈다' : false;
const ORIGIN = 'chrome-extension://ehgodopakibamgeopmelemjmjdjhbdgm/';
const frame = object => { const data = Buffer.from(JSON.stringify(object)); const head = Buffer.alloc(4); head.writeUInt32LE(data.length); return Buffer.concat([head, data]); };

// 통로 하나를 열어 두고 보낸 차례대로 답을 받는다(확장과 같은 방식).
function host(dir) {
  const child = spawn(BIN, [ORIGIN], {stdio: ['pipe', 'pipe', 'ignore'], env: {...process.env, DAISSAM_BACKUP_DIR: dir}});
  let buffer = Buffer.alloc(0); const waiting = [];
  child.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const size = buffer.readUInt32LE(0);
      if (buffer.length < 4 + size) break;
      const reply = JSON.parse(buffer.subarray(4, 4 + size).toString('utf8')); buffer = buffer.subarray(4 + size);
      if (reply.kind === 'backup' || reply.kind === 'unknown') waiting.shift()?.(reply);
    }
  });
  return {
    say: message => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('답이 없다: ' + message.type)), 15000);
      waiting.push(reply => { clearTimeout(timer); resolve(reply); });
      child.stdin.write(frame(message));
    }),
    close: () => new Promise(resolve => { child.on('exit', resolve); child.stdin.end(); setTimeout(() => child.kill(), 8000); })
  };
}
const NAME = 'daissam-backup_2026-10-17_14-30-05_change_ab12cd.json';
const body = (extra = '') => JSON.stringify({format: 'daissam-backup', v: 1, encrypted: false, payload: {kind: 'daissam-backup', notes: [], extra}});

test('자동 백업: 저장 · 목록 · 나눠 읽기 · 지우기 계약', {skip, timeout: 120000}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daissam-backup-'));
  const h = host(dir);
  try {
    // 저장: 정해진 이름 · 백업 형식만 받는다
    const big = body('가'.repeat(450000));   // 약 1.3MB — 나눠 읽기를 시험한다
    let r = await h.say({type: 'backup-save', name: NAME, text: big});
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.op, 'save');
    assert.equal(fs.readFileSync(path.join(dir, NAME), 'utf8'), big, '쓴 내용이 그대로다');
    assert.equal(r.bytes, Buffer.byteLength(big));
    for (const bad of ['../evil.json', 'daissam-backup_2026-10-17_14-30-05_change_ab12cd.json/../../x.json', 'notes.json',
      'daissam-backup_2026-10-17_14-30-05_weird_ab12cd.json', 'daissam-backup_2026-10-17_14-30-05_change_AB12CD.json', '']) {
      r = await h.say({type: 'backup-save', name: bad, text: body()});
      assert.equal(r.ok, false, '이상한 이름을 받았다: ' + bad);
    }
    r = await h.say({type: 'backup-save', name: NAME.replace('14-30-05', '14-30-06'), text: '{"hello":1}'});
    assert.equal(r.ok, false, '백업 형식이 아닌 내용을 받았다');
    r = await h.say({type: 'backup-save', name: NAME.replace('14-30-05', '14-30-07'), text: 'not json'});
    assert.equal(r.ok, false);
    assert.deepEqual(fs.readdirSync(dir).filter(f => !f.startsWith('.')), [NAME], '받지 않은 것은 파일도 없다');
    // 목록: 정해진 모양의 이름만 보인다
    const other = 'daissam-backup_2026-10-01_08-00-00_daily_ff00aa.json';
    fs.writeFileSync(path.join(dir, other), body());
    fs.writeFileSync(path.join(dir, '메모.txt'), 'keep');
    fs.writeFileSync(path.join(dir, 'daissam-backup_bad.json'), 'keep');
    r = await h.say({type: 'backup-list'});
    assert.equal(r.ok, true);
    assert.deepEqual(r.files.map(f => f.name).sort(), [other, NAME].sort());
    assert.ok(r.files.every(f => f.bytes > 0 && f.mtime > 0), '크기 · 바뀐 시각이 있다');
    // 나눠 읽기: 512KB 씩 읽어 이어 붙이면 원래 내용
    const parts = []; let offset = 0, size = Infinity;
    while (offset < size) {
      r = await h.say({type: 'backup-read', name: NAME, offset, length: 512 * 1024});
      assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
      size = r.size; const chunk = Buffer.from(r.chunk, 'base64');
      assert.ok(chunk.length > 0 && chunk.length <= 512 * 1024); parts.push(chunk); offset += chunk.length;
    }
    assert.equal(Buffer.concat(parts).toString('utf8'), big, '나눠 읽어 이은 내용이 같다');
    r = await h.say({type: 'backup-read', name: '../메모.txt', offset: 0, length: 10});
    assert.equal(r.ok, false, '폴더 밖 · 다른 파일은 읽지 않는다');
    // 지우기: 정해진 이름만, 다른 파일은 그대로
    r = await h.say({type: 'backup-delete', names: [other, '메모.txt', 'daissam-backup_bad.json', '../x', 42]});
    assert.equal(r.ok, true); assert.equal(r.deleted, 1);
    assert.deepEqual(fs.readdirSync(dir).filter(f => !f.startsWith('.')).sort(), ['daissam-backup_bad.json', NAME, '메모.txt'].sort());
    // 모르는 백업 명령에도 답한다
    r = await h.say({type: 'backup-zap'});
    assert.equal(r.ok, false);
  } finally { await h.close(); fs.rmSync(dir, {recursive: true, force: true}); }
});
test('자동 백업: 폴더가 아직 없으면 빈 목록, 저장하면 폴더를 만든다', {skip, timeout: 60000}, async () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'daissam-backup-')), '다있쌤 백업');
  const h = host(dir);
  try {
    let r = await h.say({type: 'backup-list'});
    assert.equal(r.ok, true); assert.deepEqual(r.files, []);
    r = await h.say({type: 'backup-save', name: NAME, text: body()});
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(fs.existsSync(path.join(dir, NAME)));
  } finally { await h.close(); fs.rmSync(path.dirname(dir), {recursive: true, force: true}); }
});
