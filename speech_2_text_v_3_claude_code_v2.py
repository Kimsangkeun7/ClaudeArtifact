#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# Python 3.13 호환성 패치
try:
    import python313_compatibility_patch
except ImportError:
    pass

"""
Speech2Text v3.2 — 로컬 영상 다중 선택 → 텍스트 (최대 100개 동시 처리)

변경점(v3.2)
- 다중 파일 선택 지원 (최대 100개)
- 배치 처리로 모든 선택된 파일을 순차적으로 처리
- 진행상황 표시 및 에러 처리 강화
- 개별 파일별 성공/실패 결과 리포트

필요:
  pip install faster-whisper soundfile numpy==2.2.6
"""
import os
import sys
import subprocess
import tkinter as tk
from tkinter import filedialog, messagebox
from typing import List, Tuple
import time

print("Speech2Text v3.2 — 로컬 다중 파일 ASR (최대 100개)")

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

# ---------------- 다중 파일 선택 ----------------
root = tk.Tk(); root.withdraw()
start_dir = os.path.join(SCRIPT_DIR, "videos")
if not os.path.isdir(start_dir):
    start_dir = SCRIPT_DIR

video_paths = filedialog.askopenfilenames(
    title="로컬 영상 파일 선택 (최대 100개)",
    initialdir=start_dir,
    filetypes=[("Video Files", "*.mp4;*.mkv;*.avi;*.mov;*.webm;*.flv;*.wmv")],
)

if not video_paths:
    print("[!] 영상 파일을 선택하지 않아 종료합니다.")
    sys.exit(0)

# 100개 제한 확인
if len(video_paths) > 100:
    print(f"[!] 선택된 파일이 {len(video_paths)}개입니다. 최대 100개까지만 처리 가능합니다.")
    response = messagebox.askyesno("파일 개수 초과", 
                                   f"선택된 파일이 {len(video_paths)}개입니다.\n"
                                   "처음 100개 파일만 처리하시겠습니까?")
    if response:
        video_paths = video_paths[:100]
    else:
        print("[!] 처리를 취소합니다.")
        sys.exit(0)

print(f"[i] 총 {len(video_paths)}개 파일을 처리합니다.")

# ---------------- Whisper 모델 로드 ----------------
try:
    from faster_whisper import WhisperModel
except Exception:
    print("[!] faster-whisper가 설치되어 있지 않습니다.\n    pip install faster-whisper soundfile numpy==2.2.6")
    sys.exit(1)

LANG = os.environ.get("S2T_LANG", "zh")
MODEL = os.environ.get("S2T_WHISPER_MODEL", "small")
print(f"[i] Whisper 모델 로드: {MODEL}, lang={LANG}")
model = WhisperModel(MODEL, device="auto", compute_type="float32")

# ---------------- 배치 처리 함수 ----------------
def process_single_video(video_path: str, index: int, total: int) -> Tuple[bool, str]:
    """단일 영상 파일을 처리하고 성공/실패 여부를 반환"""
    try:
        print(f"\n[{index+1}/{total}] 처리 중: {os.path.basename(video_path)}")
        
        # 오디오 추출
        base, _ = os.path.splitext(video_path)
        audio_wav = base + ".__s2t__.wav"
        
        print(f"  → 오디오 추출 중...")
        subprocess.run([ffmpeg_path, "-y", "-i", video_path, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", audio_wav],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        
        # ASR 처리
        print(f"  → 음성 인식 중...")
        segments, info = model.transcribe(audio_wav, language=LANG, vad_filter=True)
        
        # 결과 저장
        print(f"  → 결과 저장 중...")
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
            
        print(f"  ✓ 완료: {os.path.basename(out_txt)}")
        return True, f"성공: {os.path.basename(video_path)}"
        
    except subprocess.CalledProcessError as e:
        error_msg = f"ffmpeg 오류: {os.path.basename(video_path)} - {str(e)}"
        print(f"  ✗ {error_msg}")
        return False, error_msg
    except Exception as e:
        error_msg = f"처리 오류: {os.path.basename(video_path)} - {str(e)}"
        print(f"  ✗ {error_msg}")
        return False, error_msg

# ---------------- 배치 처리 실행 ----------------
start_time = time.time()
success_count = 0
failed_count = 0
results = []

print(f"\n{'='*60}")
print(f"배치 처리 시작 - 총 {len(video_paths)}개 파일")
print(f"{'='*60}")

for i, video_path in enumerate(video_paths):
    success, message = process_single_video(video_path, i, len(video_paths))
    results.append((success, message))
    
    if success:
        success_count += 1
    else:
        failed_count += 1
    
    # 진행률 표시
    progress = ((i + 1) / len(video_paths)) * 100
    print(f"\n진행률: {progress:.1f}% ({i+1}/{len(video_paths)}) | 성공: {success_count} | 실패: {failed_count}")

# ---------------- 최종 결과 리포트 ----------------
end_time = time.time()
total_time = end_time - start_time

print(f"\n{'='*60}")
print(f"배치 처리 완료!")
print(f"{'='*60}")
print(f"총 처리 시간: {total_time:.1f}초")
print(f"총 파일 수: {len(video_paths)}개")
print(f"성공: {success_count}개")
print(f"실패: {failed_count}개")
print(f"성공률: {(success_count/len(video_paths)*100):.1f}%")

if failed_count > 0:
    print(f"\n실패한 파일들:")
    for success, message in results:
        if not success:
            print(f"  - {message}")

print(f"\n모든 처리가 완료되었습니다!")