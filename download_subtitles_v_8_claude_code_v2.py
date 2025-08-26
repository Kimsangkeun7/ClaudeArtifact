#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
import os

# Windows에서 UTF-8 출력 강제 설정
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')
    # 환경변수로도 UTF-8 설정
    os.environ['PYTHONIOENCODING'] = 'utf-8'
"""
자막 다운로더 v8_v2 — 메모리 최적화 및 긴 영상 처리 지원
- 3시간반까지의 긴 영상 대본 처리 가능
- 메모리 스트리밍 처리로 안정성 향상
- 기존 기능 유지: Native-only & YouTube 탭 자동 정정
"""
import os
import re
import glob
import time
import random
import gc
import urllib.parse as ul
from typing import List, Dict, Tuple
from datetime import datetime

try:
    import yt_dlp
except ImportError:
    print("yt_dlp가 설치되지 않았습니다. pip install yt-dlp로 설치해주세요.")
    exit(1)

# 메모리 최적화 설정 (Windows 호환)
try:
    import resource
    # 메모리 제한 증가 (4GB) - Unix/Linux only
    resource.setrlimit(resource.RLIMIT_AS, (4 * 1024 * 1024 * 1024, -1))
except (ImportError, AttributeError):
    # Windows에서는 resource 모듈이 없거나 제한적이므로 패스
    pass

def get_channel_videos(channel_url: str, sort_mode: int = 1, max_results: int = None) -> List[Dict]:
    """
    채널에서 비디오 목록을 가져옵니다 (메모리 최적화)
    """
    print(f"[INFO] 채널 분석 중: {channel_url}")
    
    # 메모리 최적화된 yt-dlp 옵션
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': True,
        'playlistend': max_results,
        'socket_timeout': 300,  # 5분 타임아웃
        'retries': 5,
        'fragment_retries': 10,
        'http_chunk_size': 1024 * 1024,  # 1MB 청크
    }
    
    # URL 정규화
    if '@' in channel_url:
        base_url = channel_url.rstrip('/')
        if '/videos' not in base_url and '/shorts' not in base_url:
            if sort_mode == 1:
                channel_url = f"{base_url}/videos?sort=dd"
            elif sort_mode == 2:
                channel_url = f"{base_url}/videos?sort=p"
            else:
                channel_url = f"{base_url}/videos"
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(channel_url, download=False)
            
            if not info or 'entries' not in info:
                print("[ERROR] 채널 정보를 가져올 수 없습니다")
                return []
            
            videos = []
            for i, entry in enumerate(info['entries']):
                if entry and 'id' in entry:
                    video_url = f"https://www.youtube.com/watch?v={entry['id']}"
                    videos.append({
                        'url': video_url,
                        'title': entry.get('title', 'Unknown'),
                        'id': entry['id']
                    })
                
                # 메모리 정리
                if i % 50 == 0:
                    gc.collect()
            
            print(f"[INFO] 총 {len(videos)}개 비디오 발견")
            return videos
            
    except Exception as e:
        print(f"[ERROR] 채널 비디오 목록 가져오기 실패: {e}")
        return []

def extract_subtitles_optimized(video_url: str, output_dir: str, retries: int = 3) -> bool:
    """
    비디오에서 자막을 추출합니다 (메모리 최적화)
    """
    for attempt in range(retries):
        try:
            print(f"[INFO] 자막 추출 중 (시도 {attempt + 1}/{retries}): {video_url}")
            
            # 메모리 최적화된 yt-dlp 옵션
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'writesubtitles': True,
                'writeautomaticsub': True,
                'subtitleslangs': ['live_chat'],  # 라이브 채팅 제외
                'skip_download': True,
                'outtmpl': os.path.join(output_dir, '%(upload_date)s_%(view_count)s_%(title)s.%(id)s.%(ext)s'),
                'socket_timeout': 300,
                'retries': 5,
                'fragment_retries': 10,
                'http_chunk_size': 1024 * 1024,
            }
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(video_url, download=False)
                
                if not info:
                    continue
                
                # 기본 정보 추출
                title = info.get('title', 'Unknown')
                upload_date = info.get('upload_date', '')
                view_count = info.get('view_count', 0)
                duration = info.get('duration', 0)
                
                # 긴 영상 체크 (3시간 30분 = 12600초)
                if duration > 12600:
                    print(f"[WARNING] 매우 긴 영상 ({duration//60}분) - 메모리 최적화 모드")
                
                # 자막 처리
                success = process_subtitles_streaming(info, output_dir, title, upload_date, view_count, video_url)
                
                # 메모리 정리
                del info
                gc.collect()
                
                if success:
                    return True
                    
        except Exception as e:
            print(f"[WARNING] 시도 {attempt + 1} 실패: {e}")
            if attempt < retries - 1:
                time.sleep(2 ** attempt)  # 지수 백오프
            else:
                print(f"[ERROR] 모든 시도 실패: {video_url}")
                
    return False

def process_subtitles_streaming(info: dict, output_dir: str, title: str, upload_date: str, view_count: int, video_url: str) -> bool:
    """
    자막을 스트리밍 방식으로 처리합니다
    """
    try:
        # 자동 생성 자막 우선
        auto_captions = info.get('automatic_captions', {})
        manual_subtitles = info.get('subtitles', {})
        
        # 번역 자막 제외 언어 목록
        excluded_langs = {'ko', 'en', 'zh', 'zh-Hans', 'zh-Hant', 'ko-KR', 'en-US', 'en-GB'}
        
        subtitle_found = False
        
        # 자동 생성 자막에서 현지어 찾기
        for lang, subtitles in auto_captions.items():
            if lang in excluded_langs:
                continue
                
            for subtitle in subtitles:
                if subtitle.get('ext') in ['vtt', 'srv3', 'srv2', 'srv1']:
                    success = download_and_save_subtitle_streaming(
                        subtitle.get('url'), output_dir, title, upload_date, view_count, lang, video_url
                    )
                    if success:
                        subtitle_found = True
                        break
            
            if subtitle_found:
                break
        
        # 수동 자막에서 현지어 찾기 (자동 생성이 없을 경우)
        if not subtitle_found:
            for lang, subtitles in manual_subtitles.items():
                if lang in excluded_langs:
                    continue
                    
                for subtitle in subtitles:
                    if subtitle.get('ext') in ['vtt', 'srv3', 'srv2', 'srv1']:
                        success = download_and_save_subtitle_streaming(
                            subtitle.get('url'), output_dir, title, upload_date, view_count, lang, video_url
                        )
                        if success:
                            subtitle_found = True
                            break
                
                if subtitle_found:
                    break
        
        return subtitle_found
        
    except Exception as e:
        print(f"[ERROR] 자막 처리 중 오류: {e}")
        return False

def download_and_save_subtitle_streaming(url: str, output_dir: str, title: str, upload_date: str, view_count: int, lang: str, video_url: str) -> bool:
    """
    자막을 다운로드하고 스트리밍 방식으로 저장합니다
    """
    if not url:
        return False
        
    try:
        import urllib.request
        
        # 파일명 생성
        safe_title = re.sub(r'[<>:"/\\|?*]', '_', title)[:100]
        filename = f"{upload_date}_{view_count}_{safe_title}.{lang}.txt"
        filepath = os.path.join(output_dir, filename)
        
        print(f"[INFO] 자막 다운로드 중: {filename}")
        
        # 자막 다운로드
        with urllib.request.urlopen(url, timeout=120) as response:
            content = response.read().decode('utf-8')
        
        # 자막 정리
        cleaned_content = clean_subtitle_text_streaming(content)
        
        if not cleaned_content or len(cleaned_content.strip()) < 100:
            print(f"[WARNING] 자막 내용이 너무 짧습니다: {filename}")
            return False
        
        # 스트리밍 방식으로 파일 저장
        with open(filepath, 'w', encoding='utf-8', buffering=8192) as f:
            # 메타데이터 쓰기
            f.write(f"제목: {title}\n")
            f.write(f"업로드 날짜: {upload_date}\n")
            f.write(f"조회수: {view_count:,}\n")
            f.write(f"언어: {lang}\n")
            f.write(f"URL: {video_url}\n")
            f.write("=" * 50 + "\n\n")
            
            # 자막 내용을 청크 단위로 쓰기
            chunk_size = 8192
            for i in range(0, len(cleaned_content), chunk_size):
                chunk = cleaned_content[i:i+chunk_size]
                f.write(chunk)
                
                # 주기적으로 플러시
                if i % (chunk_size * 10) == 0:
                    f.flush()
                    os.fsync(f.fileno())
        
        print(f"[SUCCESS] 자막 저장 완료: {filename}")
        return True
        
    except Exception as e:
        print(f"[ERROR] 자막 다운로드/저장 실패: {e}")
        return False

def clean_subtitle_text_streaming(text: str) -> str:
    """
    자막 텍스트를 정리합니다 (메모리 효율적)
    """
    if not text:
        return ""
    
    try:
        # VTT 헤더 제거
        text = re.sub(r'WEBVTT.*?\n\n', '', text, flags=re.DOTALL)
        
        # 라인별 처리 (메모리 효율적)
        lines = text.split('\n')
        cleaned_lines = []
        
        for i, line in enumerate(lines):
            line = line.strip()
            
            # 타임스탬프 라인 스킵
            if re.match(r'\d+:\d+:\d+', line) or re.match(r'\d+$', line):
                continue
            
            # HTML 태그 제거
            line = re.sub(r'<[^>]+>', '', line)
            
            # 특수 문자 정리
            line = re.sub(r'&[a-zA-Z]+;', '', line)
            
            # 빈 라인 스킵
            if line and len(line) > 1:
                cleaned_lines.append(line)
            
            # 주기적 메모리 정리
            if i % 1000 == 0:
                gc.collect()
        
        result = '\n'.join(cleaned_lines)
        
        # 메모리 정리
        del lines, cleaned_lines
        gc.collect()
        
        return result
        
    except Exception as e:
        print(f"[ERROR] 자막 정리 중 오류: {e}")
        return text

def main():
    """메인 함수"""
    print("=" * 60)
    print("자막 다운로더 v8_v2 - 메모리 최적화 버전")
    print("3시간반까지의 긴 영상 처리 지원")
    print("=" * 60)
    
    # 테스트 채널
    channel_url = "https://www.youtube.com/@life4yeon"
    
    # 출력 디렉토리 설정
    output_dir = "life4yeon_subtitles"
    os.makedirs(output_dir, exist_ok=True)
    
    try:
        # 비디오 목록 가져오기 (테스트용 3개)
        videos = get_channel_videos(channel_url, sort_mode=1, max_results=3)
        
        if not videos:
            print("[ERROR] 처리할 비디오가 없습니다")
            return
        
        success_count = 0
        total_videos = len(videos)
        
        # 순차 처리 (메모리 안정성)
        for i, video in enumerate(videos):
            print(f"\n[진행률] {i+1}/{total_videos} - {video['title']}")
            
            success = extract_subtitles_optimized(video['url'], output_dir)
            
            if success:
                success_count += 1
            
            # 메모리 정리 및 처리 간격
            gc.collect()
            time.sleep(1)
        
        print(f"\n[SUCCESS] 처리 완료: {success_count}/{total_videos} 성공")
        print(f"[FOLDER] 결과 폴더: {output_dir}")
        
    except KeyboardInterrupt:
        print("\n[INTERRUPTED] 사용자에 의해 중단되었습니다")
    except Exception as e:
        print(f"\n[ERROR] 오류 발생: {e}")

if __name__ == "__main__":
    main()