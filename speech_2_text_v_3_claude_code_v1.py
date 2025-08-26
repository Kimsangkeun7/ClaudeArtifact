#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# Python 3.13 호환성 패치
try:
    import python313_compatibility_patch
except ImportError:
    pass

"""
Speech2Text v3 — 로컬 영상 1개 → 텍스트 (ffmpeg 자동 탐지 강화)

변경점(v3)
- ffmpeg 탐지 로직을 **작동 스크립트 경로 기준**으로 변경 (작업폴더 상관없음)
- 후보 경로 다중 검사: 스크립트 옆, ./ffmpeg/bin, 환경변수 S2T_FFMPEG, PATH
- 실패 시 친절한 안내와 즉시 종료

필요:
  pip install faster-whisper soundfile numpy==2.2.6
"""
import os
import sys
import subprocess
import tkinter as tk
from tkinter import filedialog
from typing import List, Tuple

print("Speech2Text v3 — 로컬 1개 파일 ASR")

# ---------------- ffmpeg 경로 탐지 ----------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_FFMPEG = os.environ.get("S2T_FFMPEG")

ffmpeg_candidates = [
    # 1) 스크립트와 같은 폴더
    os.path.join(SCRIPT_DIR, "ffmpeg.exe"),
    # 2) 스크립트 하위의 ffmpeg/bin/ffmpeg.exe (일반 배포 구조)
    os.path.join(SCRIPT_DIR, "ffmpeg", "bin", "ffmpeg.exe"),
]

# 3) 환경변수 지정
if ENV_FFMPEG:
    ffmpeg_candidates.insert(0, ENV_FFMPEG)

# 4) 마지막으로 PATH 의 ffmpeg
ffmpeg_candidates.append("ffmpeg")

ffmpeg_path = None
for cand in ffmpeg_candidates:
    try:
        subprocess.run([cand, "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        ffmpeg_path = cand
        break
    except Exception:
        continue

if not ffmpeg_path:
    print("[!] ffmpeg 실행 파일을 찾을 수 없습니다.")
    print("    - 스크립트와 같은 폴더에 ffmpeg.exe 를 두거나,")
    print("    - S2T_FFMPEG 환경변수에 경로를 지정하거나,")
    print("    - PATH에 ffmpeg를 추가한 뒤 다시 실행하세요.")
    sys.exit(1)

# ---------------- 파일 선택 ----------------
root = tk.Tk(); root.withdraw()
start_dir = os.path.join(SCRIPT_DIR, "videos")
if not os.path.isdir(start_dir):
    start_dir = SCRIPT_DIR

video_path = filedialog.askopenfilename(
    title="로컬 영상 파일 선택",
    initialdir=start_dir,
    filetypes=[("Video Files", "*.mp4;*.mkv;*.avi;*.mov")],
)
if not video_path:
    print("[!] 영상 파일을 선택하지 않아 종료합니다.")
    sys.exit(0)

# ---------------- 오디오 추출 ----------------
base, _ = os.path.splitext(video_path)
audio_wav = base + ".__s2t__.wav"
try:
    subprocess.run([ffmpeg_path, "-y", "-i", video_path, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", audio_wav],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
except subprocess.CalledProcessError as e:
    print("[!] ffmpeg로 오디오 추출 실패:", e)
    sys.exit(1)

# ---------------- ASR ----------------
try:
    from faster_whisper import WhisperModel
except Exception:
    print("[!] faster-whisper가 설치되어 있지 않습니다.\n    pip install faster-whisper soundfile numpy==2.2.6")
    sys.exit(1)

LANG = os.environ.get("S2T_LANG", "zh")
MODEL = os.environ.get("S2T_WHISPER_MODEL", "small")
print(f"[i] Whisper 모델 로드: {MODEL}, lang={LANG}")
model = WhisperModel(MODEL, device="auto", compute_type="float32")

segments, info = model.transcribe(audio_wav, language=LANG, vad_filter=True)

# ---------------- 저장 ----------------
out_txt = base + ".txt"
out_vtt = base + ".vtt"
with open(out_vtt, "w", encoding="utf-8") as vtt, open(out_txt, "w", encoding="utf-8") as txt:
    vtt.write("WEBVTT\n\n")
    for seg in segments:
        s = seg.start; e = seg.end; t = (seg.text or '').strip()
        if not t:
            continue
        vtt.write(f"{int(s//3600):02}:{int((s%3600)//60):02}:{s%60:06.3f} --> {int(e//3600):02}:{int((e%3600)//60):02}:{e%60:06.3f}\n{t}\n\n")
        txt.write(t + "\n")

# 임시 wav 정리
try:
    os.remove(audio_wav)
except Exception:
    pass

print("[OK] 변환 완료")
print(" -", out_vtt)
print(" -", out_txt)
