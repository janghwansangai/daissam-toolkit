"""내레이션 정리. trim: 줄마다 앞뒤 무음을 덜어 낸다. mix: 시간표대로 한 줄기 소리로 합친다.
실행: <venv>/bin/python tools/video/mix.py trim <원본 폴더> <결과 폴더> / mix <시간표.json> <폴더> <결과.wav>"""
import json, pathlib, sys
import numpy as np
import soundfile as sf
def trim(src, dst):
    dst = pathlib.Path(dst); dst.mkdir(parents=True, exist_ok=True)
    for f in sorted(pathlib.Path(src).glob('*.wav')):
        a, sr = sf.read(f, dtype='float32')
        if a.ndim > 1: a = a.mean(axis=1)
        loud = np.flatnonzero(np.abs(a) > 10 ** (-42 / 20))
        pad = int(sr * .04)
        a = a[max(0, loud[0] - pad):min(len(a), loud[-1] + pad)] if len(loud) else a
        sf.write(dst / f.name, a, sr)
def mix(timeline, folder, out):
    tl = json.load(open(timeline)); sr = 24000
    track = np.zeros(int((tl['total'] + 1) * sr), dtype='float32')
    for b in tl['beats']:
        a, r = sf.read(pathlib.Path(folder) / f"{b['id']}.wav", dtype='float32')
        at = int(b['voiceAt'] * sr); track[at:at + len(a)] += a[:len(track) - at]
    sf.write(out, track[:int(tl['total'] * sr)], sr)
if sys.argv[1] == 'trim': trim(sys.argv[2], sys.argv[3])
else: mix(sys.argv[2], sys.argv[3], sys.argv[4])
