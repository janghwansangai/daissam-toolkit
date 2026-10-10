// 캡처 편집기. 그림 한 장(base) 위에 그린 것(objects)을 얹어 두고, 내보낼 때만 합친다.
// 그래서 마치기 전까지 무엇이든 고르고·옮기고·지우고·되돌릴 수 있다.
import {getShot, sendShot, readText, stamp} from './lib/shots.js';

const $ = id => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d');
let base = null;             // 지금 그림(자르기·크기 바꾸기를 하면 새 캔버스로 바뀐다)
let objects = [];            // 그린 것들
let tool = 'arrow', ink = '#e5484d', size = 4;
let view = 1;                // 화면에 보이는 배율
let selected = -1, drag = null, cropRect = null, editing = null;
let history = [], future = [];
let title = '';
const FACE = "-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Pretendard Variable','Segoe UI',sans-serif";
const options = {format: 'png', quality: 92};

function toast(text, long = false) {
  const box = $('toast'); box.textContent = text; box.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { box.hidden = true; }, long ? 6000 : 2600);
}
const clone = list => list.map(o => ({...o, points: o.points ? o.points.map(p => ({...p})) : undefined}));
function remember() { history.push({base, objects: clone(objects)}); if (history.length > 60) history.shift(); future = []; showHistory(); }
function showHistory() { $('undo').disabled = !history.length; $('redo').disabled = !future.length; }
function undo() { if (!history.length) return; closeWriter(true); future.push({base, objects: clone(objects)}); ({base, objects} = history.pop()); selected = -1; setBase(base, false); showHistory(); }
function redo() { if (!future.length) return; closeWriter(true); history.push({base, objects: clone(objects)}); ({base, objects} = future.pop()); selected = -1; setBase(base, false); showHistory(); }

// ── 그리기 ──
const norm = (a, b) => ({x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y)});
function contrast(hex) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111111' : '#ffffff';
}
function textBox(o, context = ctx) {
  context.font = `700 ${o.size}px ${FACE}`;
  const lines = String(o.text).split('\n');
  const width = Math.max(...lines.map(line => context.measureText(line || ' ').width));
  const pad = o.bg ? o.size * .28 : 0;
  return {x: o.x - pad, y: o.y - pad, w: width + pad * 2, h: lines.length * o.size * 1.25 + pad * 2, lines, pad};
}
function draw(c, o) {
  c.save();
  c.strokeStyle = c.fillStyle = o.ink; c.lineWidth = o.size; c.lineCap = 'round'; c.lineJoin = 'round';
  if (o.type === 'rect') { const r = norm(o.from, o.to); c.strokeRect(r.x, r.y, r.w, r.h); }
  else if (o.type === 'ellipse') { const r = norm(o.from, o.to); c.beginPath(); c.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2 || .5, r.h / 2 || .5, 0, 0, Math.PI * 2); c.stroke(); }
  else if (o.type === 'line' || o.type === 'arrow') {
    c.beginPath(); c.moveTo(o.from.x, o.from.y); c.lineTo(o.to.x, o.to.y); c.stroke();
    if (o.type === 'arrow') {
      const angle = Math.atan2(o.to.y - o.from.y, o.to.x - o.from.x), head = Math.max(14, o.size * 4.2);
      c.beginPath(); c.moveTo(o.to.x, o.to.y);
      c.lineTo(o.to.x - head * Math.cos(angle - .45), o.to.y - head * Math.sin(angle - .45));
      c.lineTo(o.to.x - head * Math.cos(angle + .45), o.to.y - head * Math.sin(angle + .45));
      c.closePath(); c.fill();
    }
  }
  else if (o.type === 'pen' || o.type === 'mark') {
    if (o.type === 'mark') { c.globalAlpha = .38; c.lineWidth = o.size * 5; c.lineCap = 'butt'; }
    c.beginPath(); c.moveTo(o.points[0].x, o.points[0].y);
    for (let i = 1; i < o.points.length - 1; i++) {
      const mid = {x: (o.points[i].x + o.points[i + 1].x) / 2, y: (o.points[i].y + o.points[i + 1].y) / 2};
      c.quadraticCurveTo(o.points[i].x, o.points[i].y, mid.x, mid.y);
    }
    const last = o.points[o.points.length - 1]; c.lineTo(last.x, last.y); c.stroke();
  }
  else if (o.type === 'blur') {
    // 모자이크: 밑그림에서 그 자리를 작게 줄였다가 부드럽게 하지 않고 다시 키운다.
    const r = norm(o.from, o.to); if (r.w >= 2 && r.h >= 2) {
      const block = Math.max(6, Math.round(Math.min(r.w, r.h) / 10));
      const tiny = new OffscreenCanvas(Math.max(1, Math.round(r.w / block)), Math.max(1, Math.round(r.h / block)));
      tiny.getContext('2d').drawImage(base, r.x, r.y, r.w, r.h, 0, 0, tiny.width, tiny.height);
      c.imageSmoothingEnabled = false; c.drawImage(tiny, 0, 0, tiny.width, tiny.height, r.x, r.y, r.w, r.h);
    }
  }
  else if (o.type === 'text') {
    const box = textBox(o, c);
    if (o.bg) { c.fillStyle = o.ink; c.fillRect(box.x, box.y, box.w, box.h); c.fillStyle = contrast(o.ink); }
    c.textBaseline = 'top'; c.font = `700 ${o.size}px ${FACE}`;
    box.lines.forEach((line, i) => c.fillText(line, o.x, o.y + i * o.size * 1.25));
  }
  else if (o.type === 'step') {
    const radius = o.r;
    c.beginPath(); c.arc(o.x, o.y, radius, 0, Math.PI * 2); c.fill();
    c.fillStyle = contrast(o.ink); c.font = `800 ${Math.round(radius * 1.15)}px ${FACE}`;
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(o.n), o.x, o.y + radius * .06);
  }
  c.restore();
}
function bounds(o) {
  if (o.type === 'pen' || o.type === 'mark') {
    const xs = o.points.map(p => p.x), ys = o.points.map(p => p.y), pad = o.type === 'mark' ? o.size * 2.5 : o.size;
    return {x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2};
  }
  if (o.type === 'text') { const b = textBox(o); return {x: b.x, y: b.y, w: b.w, h: b.h}; }
  if (o.type === 'step') return {x: o.x - o.r, y: o.y - o.r, w: o.r * 2, h: o.r * 2};
  const r = norm(o.from, o.to), pad = Math.max(6, o.size);
  return {x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2};
}
const twoPoint = o => ['rect', 'ellipse', 'line', 'arrow', 'blur'].includes(o.type);
function paint() {
  if (!base) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(base, 0, 0);
  for (const o of objects) draw(ctx, o);
  const line = Math.max(1, 1.5 / view);
  if (selected >= 0 && objects[selected]) {
    const o = objects[selected], b = bounds(o);
    ctx.save(); ctx.strokeStyle = '#1c7ed6'; ctx.lineWidth = line; ctx.setLineDash([6 / view, 4 / view]);
    ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.setLineDash([]);
    if (twoPoint(o)) { ctx.fillStyle = '#fff'; const s = 9 / view; ctx.fillRect(o.to.x - s / 2, o.to.y - s / 2, s, s); ctx.strokeRect(o.to.x - s / 2, o.to.y - s / 2, s, s); }
    ctx.restore();
  }
  if (cropRect) {
    const r = norm(cropRect.from, cropRect.to);
    ctx.save(); ctx.fillStyle = 'rgba(10,25,20,.5)';
    ctx.beginPath(); ctx.rect(0, 0, canvas.width, canvas.height); ctx.rect(r.x, r.y, r.w, r.h); ctx.fill('evenodd');
    ctx.strokeStyle = '#dff39c'; ctx.lineWidth = line * 1.5; ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.restore();
  }
}
// 내보낼 그림: 고른 표시·자르기 덮개 없이 합친다. JPG·PDF 는 투명한 곳을 흰색으로 채운다.
function flatten(white = false) {
  const out = new OffscreenCanvas(base.width, base.height), c = out.getContext('2d');
  if (white) { c.fillStyle = '#fff'; c.fillRect(0, 0, out.width, out.height); }
  c.drawImage(base, 0, 0); for (const o of objects) draw(c, o);
  return out;
}
const asPNG = () => flatten().convertToBlob({type: 'image/png'});
const asJPG = () => flatten(true).convertToBlob({type: 'image/jpeg', quality: options.quality / 100});

// ── 그림 올리기 · 배율 ──
function setBase(next, fit = true) {
  base = next; canvas.width = base.width; canvas.height = base.height;
  $('empty').hidden = true; $('paper').hidden = false;
  if (fit) fitView(); else applyView();
  $('info').textContent = `${base.width} × ${base.height}px${title ? ' · ' + title : ''}`;
  paint();
}
function fitView() { const room = $('stage').clientWidth - 56; view = Math.min(1, room / base.width) || 1; applyView(); }
function applyView() { canvas.style.width = base.width * view + 'px'; canvas.style.height = base.height * view + 'px'; paint(); }
async function loadBlob(blob) {
  const picture = await createImageBitmap(blob);
  const made = document.createElement('canvas'); made.width = picture.width; made.height = picture.height;
  made.getContext('2d').drawImage(picture, 0, 0);
  history = []; future = []; objects = []; selected = -1; showHistory();
  setBase(made);
}
function point(e) {
  const box = canvas.getBoundingClientRect();
  return {x: (e.clientX - box.left) * base.width / box.width, y: (e.clientY - box.top) * base.height / box.height};
}

// ── 도구 고르기 ──
function pickTool(name) {
  closeWriter(true);
  tool = name; if (name !== 'crop') cancelCrop();
  if (name !== 'select') selected = -1;
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === name);
  $('text-opts').hidden = name !== 'text';
  canvas.style.cursor = name === 'select' ? 'default' : name === 'text' ? 'text' : 'crosshair';
  paint();
}
function pickInk(value) {
  ink = value;
  for (const b of document.querySelectorAll('[data-ink]')) b.classList.toggle('on', b.dataset.ink === value);
  document.querySelector('.own').classList.toggle('on', ![...document.querySelectorAll('[data-ink]')].some(b => b.dataset.ink === value));
  // 고른 것이 있으면 그 색을 바꾼다.
  if (selected >= 0 && objects[selected] && objects[selected].type !== 'blur') { remember(); objects[selected].ink = value; paint(); }
  if (editing) $('writer').style.color = value;
}
function pickSize(value) {
  size = value;
  for (const b of document.querySelectorAll('[data-size]')) b.classList.toggle('on', Number(b.dataset.size) === value);
  if (selected >= 0 && objects[selected] && !['text', 'blur'].includes(objects[selected].type)) { remember(); objects[selected].size = value; if (objects[selected].type === 'step') objects[selected].r = 13 + value * 1.6; paint(); }
}
for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => pickTool(b.dataset.tool));
for (const b of document.querySelectorAll('[data-ink]')) { b.style.background = b.dataset.ink; b.addEventListener('click', () => pickInk(b.dataset.ink)); }
for (const b of document.querySelectorAll('[data-size]')) b.addEventListener('click', () => pickSize(Number(b.dataset.size)));
$('own-ink').addEventListener('input', e => pickInk(e.target.value));

// ── 마우스 ──
function hit(p) {
  for (let i = objects.length - 1; i >= 0; i--) { const b = bounds(objects[i]); if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return i; }
  return -1;
}
canvas.addEventListener('pointerdown', e => {
  if (!base || e.button !== 0) return;
  const p = point(e);
  canvas.setPointerCapture(e.pointerId);
  if (editing) { closeWriter(true); return; }
  if (tool === 'select') {
    const o = objects[selected];
    if (o && twoPoint(o) && Math.hypot(p.x - o.to.x, p.y - o.to.y) < 12 / view) { remember(); drag = {kind: 'handle'}; return; }
    selected = hit(p);
    if (selected >= 0) { remember(); drag = {kind: 'move', last: p}; }
    paint(); return;
  }
  if (tool === 'crop') { cropRect = {from: p, to: p}; $('crop-bar').hidden = true; drag = {kind: 'crop'}; return; }
  // 글상자는 누르기가 다 끝난 뒤에 연다. 바로 열면 이어지는 기본 동작이 초점을 캔버스로
  // 되가져가 글상자가 열리자마자 닫혔다(실제 Chrome 에서 확인).
  if (tool === 'text') { setTimeout(() => openWriter(p), 0); return; }
  if (tool === 'step') {
    remember();
    const n = objects.filter(o => o.type === 'step').length + 1;
    objects.push({type: 'step', x: p.x, y: p.y, n, r: 13 + size * 1.6, ink, size});
    paint(); return;
  }
  remember();
  const shape = {type: tool, ink, size, from: p, to: p};
  if (tool === 'pen' || tool === 'mark') { delete shape.from; delete shape.to; shape.points = [p, p]; }
  objects.push(shape); drag = {kind: 'draw'};
});
// 글자 도구에서는 누를 때의 초점 이동을 막는다. 열어 둔 글상자가 초점을 잃으면 닫힌다.
canvas.addEventListener('mousedown', e => { if (tool === 'text' || editing) e.preventDefault(); });
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const p = point(e);
  if (drag.kind === 'crop') { cropRect.to = {x: Math.max(0, Math.min(base.width, p.x)), y: Math.max(0, Math.min(base.height, p.y))}; paint(); return; }
  if (drag.kind === 'move') {
    const o = objects[selected], dx = p.x - drag.last.x, dy = p.y - drag.last.y; drag.last = p;
    if (o.points) o.points.forEach(q => { q.x += dx; q.y += dy; });
    else if (o.from) { o.from.x += dx; o.from.y += dy; o.to.x += dx; o.to.y += dy; }
    else { o.x += dx; o.y += dy; }
    paint(); return;
  }
  if (drag.kind === 'handle') { objects[selected].to = p; paint(); return; }
  const o = objects[objects.length - 1];
  if (o.points) o.points.push(p);
  else {
    o.to = p;
    // Shift 를 누르면 정사각형·정원·수평/수직 선.
    if (e.shiftKey) {
      const dx = p.x - o.from.x, dy = p.y - o.from.y;
      if (o.type === 'rect' || o.type === 'ellipse' || o.type === 'blur') { const m = Math.max(Math.abs(dx), Math.abs(dy)); o.to = {x: o.from.x + Math.sign(dx || 1) * m, y: o.from.y + Math.sign(dy || 1) * m}; }
      else o.to = Math.abs(dx) > Math.abs(dy) ? {x: p.x, y: o.from.y} : {x: o.from.x, y: p.y};
    }
  }
  paint();
});
canvas.addEventListener('pointerup', () => {
  if (!drag) return;
  const kind = drag.kind; drag = null;
  if (kind === 'crop') { const r = norm(cropRect.from, cropRect.to); if (r.w < 4 || r.h < 4) { cancelCrop(); return; } showCropBar(); return; }
  if (kind === 'draw') {
    const o = objects[objects.length - 1];
    // 그냥 누르기만 한 도형은 남기지 않는다(되돌리기 기록도 함께 걷는다).
    const tiny = o.points ? o.points.length < 3 && Math.hypot(o.points[0].x - o.points[1].x, o.points[0].y - o.points[1].y) < 2
                          : Math.hypot(o.to.x - o.from.x, o.to.y - o.from.y) < 3;
    if (tiny) { objects.pop(); history.pop(); showHistory(); }
  }
  paint();
});
canvas.addEventListener('dblclick', e => {
  if (tool !== 'select') return;
  const i = hit(point(e));
  if (i >= 0 && objects[i].type === 'text') { const o = objects[i]; remember(); objects.splice(i, 1); selected = -1; paint(); setTimeout(() => openWriter({x: o.x, y: o.y}, o), 0); }
});

// ── 글자: 진짜 글상자를 띄워 입력기(한글 조합)를 그대로 쓴다 ──
function openWriter(p, from = null) {
  const box = $('writer');
  editing = {x: p.x, y: p.y, size: from?.size || Number($('text-size').value), bg: from ? from.bg : $('text-bg').checked, ink: from?.ink || ink};
  box.value = from?.text || '';
  Object.assign(box.style, {left: p.x * view + 'px', top: p.y * view + 'px', fontSize: editing.size * view + 'px', color: editing.ink});
  box.hidden = false; grow(); box.focus();
}
function grow() { const box = $('writer'); box.style.width = '0px'; box.style.height = '0px'; box.style.width = Math.max(40, box.scrollWidth + 8) + 'px'; box.style.height = box.scrollHeight + 'px'; }
function closeWriter(keep) {
  if (!editing) return;
  const box = $('writer'), text = box.value.replace(/\s+$/, '');
  if (keep && text) { remember(); objects.push({type: 'text', x: editing.x, y: editing.y, text, size: editing.size, bg: editing.bg, ink: editing.ink}); }
  editing = null; box.hidden = true; box.value = ''; paint();
}
$('writer').addEventListener('input', grow);
$('writer').addEventListener('keydown', e => {
  if (e.isComposing) return;
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); closeWriter(true); }
});
$('writer').addEventListener('blur', () => setTimeout(() => closeWriter(true), 0));

// ── 자르기 ──
function showCropBar() {
  const r = norm(cropRect.from, cropRect.to), bar = $('crop-bar');
  bar.hidden = false; bar.style.left = r.x * view + 'px'; bar.style.top = Math.min(canvas.clientHeight - 36, (r.y + r.h) * view + 8) + 'px';
}
function cancelCrop() { cropRect = null; $('crop-bar').hidden = true; paint(); }
function applyCrop() {
  if (!cropRect) return;
  const r = norm(cropRect.from, cropRect.to), x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
  remember();
  const made = document.createElement('canvas'); made.width = w; made.height = h;
  made.getContext('2d').drawImage(base, x, y, w, h, 0, 0, w, h);
  for (const o of objects) {
    if (o.points) o.points.forEach(q => { q.x -= x; q.y -= y; });
    else if (o.from) { o.from.x -= x; o.from.y -= y; o.to.x -= x; o.to.y -= y; }
    else { o.x -= x; o.y -= y; }
  }
  cropRect = null; $('crop-bar').hidden = true; setBase(made); pickTool('select');
}
$('crop-ok').addEventListener('click', applyCrop);
$('crop-no').addEventListener('click', cancelCrop);

// ── 크기 바꾸기 ──
$('resize').addEventListener('click', () => {
  if (!base) return;
  $('resize-w').value = base.width; $('resize-h').value = base.height; $('resize-box').showModal();
});
$('resize-w').addEventListener('input', () => { if ($('resize-keep').checked) $('resize-h').value = Math.round(Number($('resize-w').value) * base.height / base.width) || ''; });
$('resize-h').addEventListener('input', () => { if ($('resize-keep').checked) $('resize-w').value = Math.round(Number($('resize-h').value) * base.width / base.height) || ''; });
$('resize-box').addEventListener('close', () => {
  if ($('resize-box').returnValue !== 'ok') return;
  const w = Math.max(16, Math.min(16000, Math.round(Number($('resize-w').value)))), h = Math.max(16, Math.min(16000, Math.round(Number($('resize-h').value))));
  if (!w || !h || (w === base.width && h === base.height)) return;
  remember();
  const sx = w / base.width, sy = h / base.height, k = (sx + sy) / 2;
  const made = document.createElement('canvas'); made.width = w; made.height = h;
  const c = made.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(base, 0, 0, w, h);
  for (const o of objects) {
    const move = q => { q.x *= sx; q.y *= sy; };
    if (o.points) o.points.forEach(move); else if (o.from) { move(o.from); move(o.to); } else move(o);
    o.size *= k; if (o.r) o.r *= k;
  }
  setBase(made);
});

// ── 내보내기 ──
function fileName(ext) { return `다있쌤-스크린샷-${stamp()}.${ext}`; }
function download(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
// 그림 한 장을 담은 PDF. JPEG 를 그대로 넣는다(DCTDecode). 쪽 크기는 96dpi 기준 포인트.
async function asPDF() {
  const picture = flatten(true);
  const jpeg = new Uint8Array(await (await picture.convertToBlob({type: 'image/jpeg', quality: .92})).arrayBuffer());
  let pw = picture.width * .75, ph = picture.height * .75;
  const k = Math.min(1, 14400 / Math.max(pw, ph)); pw = (pw * k).toFixed(2); ph = (ph * k).toFixed(2);
  const enc = new TextEncoder(), parts = [], at = [];
  let length = 0;
  const push = chunk => { const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk; parts.push(bytes); length += bytes.length; };
  const obj = (n, body) => { at[n] = length; push(`${n} 0 obj\n${body}\nendobj\n`); };
  push('%PDF-1.4\n%âãÏÓ\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  at[4] = length;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${picture.width} /Height ${picture.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg); push('\nendstream\nendobj\n');
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = length;
  push('xref\n0 6\n0000000000 65535 f \n' + [1, 2, 3, 4, 5].map(n => String(at[n]).padStart(10, '0') + ' 00000 n \n').join('') +
       `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, {type: 'application/pdf'});
}
async function saveToFolder() {
  closeWriter(true); if (!base) return;
  const blob = options.format === 'jpg' ? await asJPG() : await asPNG();
  try { const reply = await sendShot(blob, {save: true, copy: false}); toast('저장했습니다 — ' + reply.path.split('/').slice(-2).join('/'), true); }
  catch (error) { download(blob, fileName(options.format === 'jpg' ? 'jpg' : 'png')); toast(error.message + ' 대신 내려받기 폴더에 저장했습니다.', true); }
}
async function copyOut() {
  closeWriter(true); if (!base) return;
  const blob = await asPNG();
  try { await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]); toast('클립보드에 복사했습니다 — 붙여넣을 곳에서 ⌘V / Ctrl+V'); }
  catch {
    try { await sendShot(blob, {save: false, copy: true}); toast('클립보드에 복사했습니다.'); }
    catch (error) { toast('복사하지 못했습니다. ' + error.message, true); }
  }
}
$('save').addEventListener('click', saveToFolder);
$('copy').addEventListener('click', copyOut);
$('download').addEventListener('click', () => { const menu = $('download-menu'); menu.hidden = !menu.hidden; $('download').setAttribute('aria-expanded', String(!menu.hidden)); });
document.addEventListener('click', e => { if (!e.target.closest('.menu')) { $('download-menu').hidden = true; $('download').setAttribute('aria-expanded', 'false'); } });
for (const b of document.querySelectorAll('[data-as]')) b.addEventListener('click', async () => {
  closeWriter(true); $('download-menu').hidden = true; if (!base) return;
  const as = b.dataset.as;
  download(as === 'pdf' ? await asPDF() : as === 'jpg' ? await asJPG() : await asPNG(), fileName(as));
  toast('내려받기 폴더에 저장했습니다.');
});
$('print').addEventListener('click', async () => {
  closeWriter(true); if (!base) return;
  const img = $('print-view'), url = URL.createObjectURL(await asPNG());
  img.onload = () => { window.print(); setTimeout(() => URL.revokeObjectURL(url), 2000); };
  img.src = url;
});

// ── 글자 뽑기 ──
async function extract() {
  closeWriter(true); if (!base) return;
  $('side').hidden = false; $('ocr-text').value = '글자를 읽는 중…';
  try {
    const text = await readText(await asPNG());
    $('ocr-text').value = text || '(읽을 수 있는 글자를 찾지 못했습니다)';
    if (text) { try { await navigator.clipboard.writeText(text); toast('글자를 뽑아 클립보드에 복사했습니다.'); } catch {} }
  } catch (error) { $('ocr-text').value = error.message; }
}
$('ocr').addEventListener('click', extract);
$('side-close').addEventListener('click', () => { $('side').hidden = true; });
$('ocr-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('ocr-text').value); toast('글자를 복사했습니다.'); } catch { $('ocr-text').select(); document.execCommand('copy'); toast('글자를 복사했습니다.'); } });

// ── 보기 · 되돌리기 · 단축키 ──
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('fit').addEventListener('click', () => base && fitView());
$('real').addEventListener('click', () => { if (base) { view = 1; applyView(); } });
addEventListener('resize', () => { if (base && view < 1) fitView(); });
const KEYS = {v: 'select', c: 'crop', r: 'rect', o: 'ellipse', a: 'arrow', l: 'line', p: 'pen', h: 'mark', t: 'text', b: 'blur', n: 'step'};
document.addEventListener('keydown', e => {
  if (editing || e.target.closest?.('input,select,textarea,dialog')) return;
  const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
  if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && key === 'y') { e.preventDefault(); redo(); return; }
  if (mod && key === 's') { e.preventDefault(); saveToFolder(); return; }
  if (mod && key === 'c' && base) { e.preventDefault(); copyOut(); return; }
  if (mod) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected >= 0) { e.preventDefault(); remember(); objects.splice(selected, 1); selected = -1; paint(); return; }
  if (e.key === 'Enter' && cropRect) { applyCrop(); return; }
  if (e.key === 'Escape') { if (cropRect) cancelCrop(); else { selected = -1; paint(); } return; }
  if (KEYS[key] && base) pickTool(KEYS[key]);
});

// ── 새 그림 가져오기(내 사진·클립보드) ──
async function fromFile(file) { if (file && file.type.startsWith('image/')) { title = file.name; await loadBlob(file); } else toast('그림 파일이 아닙니다.'); }
$('file').addEventListener('change', e => fromFile(e.target.files[0]));
const zone = $('drop-zone');
addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
addEventListener('dragleave', () => zone.classList.remove('over'));
addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); fromFile(e.dataTransfer.files[0]); });
addEventListener('paste', e => {
  if (editing) return;
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (item) { e.preventDefault(); title = '붙여 넣은 그림'; loadBlob(item.getAsFile()); }
});
$('paste').addEventListener('click', async () => {
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (type) { title = '붙여 넣은 그림'; await loadBlob(await item.getType(type)); return; }
    }
    toast('클립보드에 그림이 없습니다. 그림을 복사한 뒤 다시 눌러 주세요.');
  } catch { toast('클립보드를 읽지 못했습니다. ⌘V / Ctrl+V 로 붙여 넣어 보세요.'); }
});

// ── 시작 ──
async function start() {
  const saved = (await chrome.storage.local.get('captureOptions')).captureOptions || {};
  Object.assign(options, {format: saved.format || 'png', quality: saved.quality || 92});
  pickInk(ink); pickSize(size); pickTool('arrow'); showHistory();
  const [id, ...rest] = location.hash.slice(1).split('&');
  const extra = new URLSearchParams(rest.join('&'));
  if (extra.get('why')) { $('banner').textContent = extra.get('why') + ' — 여기서 저장·복사를 다시 해 볼 수 있습니다.'; $('banner').hidden = false; }
  if (!id || id === 'new') { $('empty').hidden = false; document.title = '다있쌤 · 그림 꾸미기'; return; }
  const shot = await getShot(id);
  if (!shot) { $('empty').hidden = false; toast('그 캡처를 찾지 못했습니다. 오래된 캡처는 자동으로 지워집니다.', true); return; }
  title = shot.title || '';
  document.title = '다있쌤 캡처' + (title ? ' · ' + title : '');
  await loadBlob(shot.blob);
  if (extra.get('ocr') === '1') extract();
  if (extra.get('crop') === '1') { pickTool('crop'); $('banner').textContent = '남길 곳을 끌어 고른 뒤 ✓ 자르기를 누르세요. (이 화면은 페이지 위에서 바로 고를 수 없어 편집기에서 자릅니다)'; $('banner').hidden = false; }
}
start().catch(error => toast('열지 못했습니다: ' + error.message, true));
