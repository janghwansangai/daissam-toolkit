import {mkdirSync,copyFileSync,existsSync,readFileSync,writeFileSync,readdirSync,rmSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

mkdirSync('dist/release',{recursive:true});
for(const stale of readdirSync('dist/release'))if(/^browser-sheriff-.*\.zip$/.test(stale))rmSync('dist/release/'+stale);
const manifest=JSON.parse(readFileSync('extension/manifest.json'));
const version=manifest.version;
const artifacts=[];

// ── 1. 발표 도우미 앱을 먼저 묶는다. 확장 안에 넣으려면 먼저 있어야 한다. ──
const macZip=`dist/release/browser-sheriff-presenter-macos-${version}.zip`;
if(existsSync('dist/Browser Sheriff Presenter.app')){
  // 임시(ad-hoc) 서명본은 남에게 주면 안 된다. 받는 사람의 macOS 가 '확인되지 않은 개발자'
  // 로 막고, 빌드마다 서명이 달라져 권한도 붙지 않는다. 고정 인증서가 있는지 먼저 본다.
  const rules=execFileSync('codesign',['-d','--requirements','-','dist/Browser Sheriff Presenter.app'],
    {encoding:'utf8',stdio:['ignore','pipe','pipe']});
  if(!rules.includes('certificate leaf'))
    throw new Error('발표 도우미 앱이 임시(ad-hoc) 서명입니다. 배포본을 만들지 않았습니다.\n'+
      'bash presenter/macos/allow-signing-key.sh 를 한 번 실행한 뒤 build.sh 를 다시 돌리세요.');
  // --sequesterRsrc 를 빼면 안 된다. macOS 가 모든 파일에 com.apple.provenance 확장 속성을
  // 자동으로 붙이는데(지울 수 없다), 이 옵션이 없으면 그것이 번들 안에 ._Info.plist 로 풀려
  // 들어가 서명이 깨진다("file added"). 0.24.0 에서 실제로 확인했다.
  execFileSync('ditto',['-c','-k','--sequesterRsrc','--keepParent','dist/Browser Sheriff Presenter.app',macZip]);
}
const winZip=`dist/release/browser-sheriff-presenter-windows-${version}.zip`;
if(existsSync('dist/windows/Presenter.exe')){
  // 소스보다 오래된 실행 파일은 담지 않는다. 0.20.0 은 이 확인이 없어 고치기 전의
  // Presenter.exe 를 그대로 담아 나갔다. 다시 만들려면 presenter/windows/build.sh 를 돌린다.
  if(statSync('dist/windows/Presenter.exe').mtimeMs < statSync('presenter/windows/Presenter.cs').mtimeMs)
    throw new Error('dist/windows/Presenter.exe 가 Presenter.cs 보다 오래되었습니다. presenter/windows/build.sh 를 먼저 돌리세요.');
  for(const file of ['Install.cmd','Uninstall.cmd','Reset.cmd','Check.cmd'])copyFileSync('presenter/windows/'+file,'dist/windows/'+file);
  copyFileSync('presenter/README.md','dist/windows/README.md');
  execFileSync('python3',['-c',`import pathlib,zipfile
with zipfile.ZipFile('${winZip}','w',zipfile.ZIP_DEFLATED) as z:
 for name in ['Presenter.exe','Install.cmd','Uninstall.cmd','Reset.cmd','Check.cmd','README.md']:
  z.write(pathlib.Path('dist/windows')/name,name)
`]);
}

// ── 2. 확장. 앱 ZIP 두 개를 presenter/ 아래에 함께 담는다. ──────────────
// 그래야 남에게 건넬 때 파일 하나면 되고, 받는 사람이 사이드바에서 바로 내려받는다.
const extensionZip=`dist/release/browser-sheriff-extension-${version}.zip`;
const inside=[];
if(existsSync(macZip))inside.push([macZip,'presenter/macos.zip']);
if(existsSync(winZip))inside.push([winZip,'presenter/windows.zip']);
execFileSync('python3',['-c',`import pathlib,zipfile,json,sys
root=pathlib.Path('extension')
extra=json.loads(sys.argv[1])
with zipfile.ZipFile('${extensionZip}','w',zipfile.ZIP_DEFLATED) as z:
 # 남에게 건네는 파일이다. 만든 사람의 흔적(.DS_Store 는 Finder 창 설정과 폴더 이름을
 # 담는다)과 편집기 찌꺼기는 절대 넣지 않는다.
 junk={'.DS_Store','Thumbs.db','desktop.ini','.gitignore','.gitkeep'}
 for p in sorted(root.rglob('*')):
  if not p.is_file(): continue
  if p.name in junk or p.name.startswith('._') or p.suffix in {'.swp','.bak','.orig'}: continue
  z.write(p,p.relative_to(root))
 # 앱 ZIP 은 이미 압축돼 있다. 다시 줄이려 애쓰지 않는다.
 for src,name in extra: z.write(src,name,compress_type=zipfile.ZIP_STORED)
`,JSON.stringify(inside)]);
artifacts.push(extensionZip);
if(existsSync(macZip))artifacts.push(macZip);
if(existsSync(winZip))artifacts.push(winZip);

copyFileSync('README.md','dist/release/START-HERE.md');
writeFileSync('dist/release/SHA256SUMS.txt',artifacts.map(p=>createHash('sha256').update(readFileSync(p)).digest('hex')+'  '+p.split('/').pop()).join('\n')+'\n');
console.log('Packaged:',artifacts.join('\n'));

// ── 3. 남에게 그대로 건넬 폴더. ───────────────────────────────────────────
// 확장 ZIP 하나에 앱이 다 들어 있으므로 그것만 줘도 된다. 앱 ZIP 은 따로 받고 싶은
// 사람을 위해 같이 둔다. dist/release 에는 개발 중 생긴 파일이 섞이므로 통째로 주면 안 된다.
const handout='dist/handout';
rmSync(handout,{recursive:true,force:true});
mkdirSync(handout,{recursive:true});
// 안내문의 버전과 파일 이름은 틀에서 채운다. 손으로 고치면 반드시 낡는다.
const guide=readFileSync('docs/install-guide.html','utf8').replaceAll('{{VERSION}}',version);
writeFileSync(`${handout}/0. 먼저 읽어주세요.html`,guide);
// 설치가 끝난 뒤 읽는 사용설명서. 기능마다 '이럴 때 이렇게' 를 적어 둔다.
const manual=readFileSync('docs/user-guide.html','utf8').replaceAll('{{VERSION}}',version);
writeFileSync(`${handout}/1. 사용설명서.html`,manual);
copyFileSync(extensionZip,`${handout}/${extensionZip.split('/').pop()}`);
// 건네줄 폴더에는 확장 ZIP 하나만 들어간다. dist/release 의 목록을 그대로 복사하면
// 받는 사람이 확인할 때 없는 파일 두 개가 FAILED 로 뜬다. 여기 있는 것만 적는다.
writeFileSync(`${handout}/SHA256SUMS.txt`,
  createHash('sha256').update(readFileSync(extensionZip)).digest('hex')+'  '+extensionZip.split('/').pop()+'\n');
console.log('건네줄 폴더: '+handout+'  (확장 ZIP 하나에 앱이 모두 들어 있습니다 · 안내문 2개)');
