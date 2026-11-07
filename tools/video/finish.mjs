// 그림만 있는 영상 + 내레이션 → 완성본(.mp4) · 자막(.srt) · 챕터 목록(.txt). 사용: OUT=… VOICE=… PY=… node tools/video/finish.mjs <그림 영상> <결과 폴더> <이름>
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const [video, folder, name] = process.argv.slice(2), OUT = process.env.OUT, VOICE = process.env.VOICE;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const tl = JSON.parse(fs.readFileSync(OUT + '/timeline.json', 'utf8'));
fs.mkdirSync(folder, {recursive: true});
const stamp = t => { const ms = Math.round(t * 1000), p = (n, w = 2) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
fs.writeFileSync(`${folder}/${name}.srt`, tl.beats.map((b, i) => `${i + 1}\n${stamp(b.voiceAt)} --> ${stamp(b.end - .15)}\n${b.sub}\n`).join('\n'));
const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
fs.writeFileSync(`${folder}/${name}_챕터.txt`, tl.chapters.map(c => `${mmss(c.start)} ${c.title}`).join('\n') + '\n');
const meta = OUT + '/chapters.txt', esc = s => s.replace(/([=;#\\])/g, '\\$1');
fs.writeFileSync(meta, ';FFMETADATA1\ntitle=다있쌤 소개와 사용법\n' + tl.chapters.map((c, i) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(c.start * 1000)}\nEND=${Math.round((tl.chapters[i + 1]?.start ?? tl.total) * 1000)}\ntitle=${esc(c.title)}\n`).join(''));
execFileSync(process.env.PY, [HERE + '/mix.py', 'mix', OUT + '/timeline.json', VOICE, OUT + '/mix.wav'], {stdio: 'inherit'});
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', video, '-i', OUT + '/mix.wav', '-i', meta, '-map', '0:v', '-map', '1:a', '-map_metadata', '2', '-map_chapters', '2', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000', '-ac', '2', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', `${folder}/${name}.mp4`], {stdio: 'inherit'});
console.log('완성', `${folder}/${name}.mp4`);
