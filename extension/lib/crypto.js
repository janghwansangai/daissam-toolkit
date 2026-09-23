const enc = new TextEncoder();
const dec = new TextDecoder();
export const ITERATIONS = 600000;
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export function assertPin(pin) {
  if (!/^\d{4,12}$/.test(pin)) throw new Error('PIN은 숫자 4~12자리로 입력하세요.');
}
async function key(pin, salt, usage) {
  assertPin(pin);
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name:'PBKDF2', salt, iterations:ITERATIONS, hash:'SHA-256' }, base,
    { name:'AES-GCM', length:256 }, false, usage);
}
export async function seal(pin, data) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:enc.encode('sheriff:v1')},
    await key(pin,salt,['encrypt']), enc.encode(JSON.stringify(data)));
  return {v:1,s:b64(salt),i:b64(iv),c:b64(new Uint8Array(encrypted))};
}
export async function unseal(pin, blob) {
  if (blob?.v !== 1 || typeof blob.c !== 'string' || blob.c.length > 14000) throw new Error('지원하지 않거나 손상된 데이터입니다.');
  const decrypted = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(blob.i),additionalData:enc.encode('sheriff:v1')},
    await key(pin,bytes(blob.s),['decrypt']),bytes(blob.c));
  return JSON.parse(dec.decode(decrypted));
}
