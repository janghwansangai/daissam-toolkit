"""허깅페이스 Qwen3-TTS(한국어 'Sohee' 목소리)로 내레이션을 만든다. Apple Silicon 에서 mlx-audio 로 돈다.

실행: <venv>/bin/python tools/video/narrate.py <대본.json> <출력 폴더>
  대본.json: [{"id": "01", "text": "읽을 글", "instruct": "말투(선택)"}, ...]
  출력: <id>.wav (24kHz) + check.json (Whisper 로 다시 받아 적은 글과 맞은 정도)

말투 기본값: 밝고 따뜻한 광고 내레이션. 선생님께 말하듯 또렷하게.
"""
import json
import pathlib
import sys
import difflib
import re

import numpy as np
import soundfile as sf

MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit"
VOICE = "sohee"
DEFAULT_STYLE = "밝고 따뜻한 광고 내레이션. 선생님께 말하듯 친근하고 또렷하게, 자연스러운 속도로."


def norm(s):
    return re.sub(r"[^가-힣0-9a-zA-Z]", "", s)


def main():
    script = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    out = pathlib.Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[3].split(",")) if len(sys.argv) > 3 else None

    from mlx_audio.tts.utils import load_model
    model = load_model(MODEL)
    for line in script:
        if only and line["id"] not in only:
            continue
        chunks = []
        sr = 24000
        for r in model.generate(text=line["text"], voice=VOICE, lang_code="korean",
                                instruct=line.get("instruct") or DEFAULT_STYLE, split_pattern="\n"):
            chunks.append(np.array(r.audio))
            sr = r.sample_rate
        audio = np.concatenate(chunks)
        sf.write(out / f"{line['id']}.wav", audio, sr)
        print(line["id"], f"{len(audio) / sr:.1f}s", flush=True)

    # 받아쓰기로 발음 확인 (Whisper large-v3-turbo, 이 Mac 에 받아 둔 것)
    import mlx_whisper
    report = []
    for line in script:
        if only and line["id"] not in only:
            continue
        r = mlx_whisper.transcribe(str(out / f"{line['id']}.wav"), path_or_hf_repo="mlx-community/whisper-large-v3-turbo", language="ko")
        heard = r["text"].strip()
        score = difflib.SequenceMatcher(None, norm(line.get("check", line["text"])), norm(heard)).ratio()
        report.append({"id": line["id"], "score": round(score, 3), "text": line["text"], "heard": heard})
        print(f"{line['id']} 맞음 {score:.0%} · {heard}", flush=True)
    (out / "check.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
