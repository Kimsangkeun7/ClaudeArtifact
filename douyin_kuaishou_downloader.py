#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
도우인(Douyin) & 카이쇼우(Kuaishou) 전용 다운로더
- URL을 입력받아 저장
- 일괄 다운로드 기능
- 간단하고 빠른 다운로드에 집중
"""

import os
import json
import time
from datetime import datetime
from typing import List, Dict, Optional

class DouyinKuaishouDownloader:
    def __init__(self, download_dir: str = "downloads"):
        self.download_dir = download_dir
        self.url_queue_file = "url_queue.json"
        self.url_queue = self.load_url_queue()
        os.makedirs(download_dir, exist_ok=True)
    
    def load_url_queue(self) -> List[Dict]:
        """저장된 URL 큐를 로드"""
        if os.path.exists(self.url_queue_file):
            try:
                with open(self.url_queue_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"URL 큐 로드 실패: {e}")
                return []
        return []
    
    def save_url_queue(self):
        """URL 큐를 파일에 저장"""
        try:
            with open(self.url_queue_file, 'w', encoding='utf-8') as f:
                json.dump(self.url_queue, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"URL 큐 저장 실패: {e}")
    
    def add_url(self, url: str, description: str = ""):
        """URL을 큐에 추가"""
        if not self.is_supported_url(url):
            print(f"지원하지 않는 URL입니다: {url}")
            return False
        
        # 중복 체크
        for item in self.url_queue:
            if item['url'] == url:
                print(f"이미 추가된 URL입니다: {url}")
                return False
        
        url_item = {
            'url': url,
            'description': description,
            'added_time': datetime.now().isoformat(),
            'downloaded': False,
            'download_path': None,
            'download_time': None
        }
        
        self.url_queue.append(url_item)
        self.save_url_queue()
        print(f"URL 추가됨: {url}")
        return True
    
    def is_supported_url(self, url: str) -> bool:
        """지원하는 URL인지 확인"""
        supported_domains = [
            'douyin.com', 'v.douyin.com',
            'kuaishou.com', 'www.kuaishou.com'
        ]
        return any(domain in url for domain in supported_domains)
    
    def get_cookiefile_for_url(self, url: str) -> Optional[str]:
        """URL에 맞는 쿠키 파일 반환"""
        cookie_map = {
            'douyin.com': 'cookies/douyin.txt',
            'v.douyin.com': 'cookies/douyin.txt',
            'kuaishou.com': 'cookies/kuaishou.txt',
            'www.kuaishou.com': 'cookies/kuaishou.txt',
        }
        
        for domain, cookie_file in cookie_map.items():
            if domain in url and os.path.isfile(cookie_file):
                return cookie_file
        return None
    
    def download_single_video(self, url: str, index: int = 0) -> Optional[str]:
        """단일 비디오 다운로드"""
        try:
            import yt_dlp
        except ImportError:
            print("yt-dlp가 설치되지 않았습니다. 'pip install yt-dlp'로 설치하세요.")
            return None
        
        # 다운로드 옵션 설정
        ydl_opts = {
            'outtmpl': os.path.join(self.download_dir, f'{index:03d}_%(title)s.%(ext)s'),
            'format': 'best[height<=?2160]/best',  # 4K까지 최고 해상도
            'quiet': False,
            'noprogress': False,
            # 네트워크 안정화
            'socket_timeout': 60,
            'retries': 10,
            'fragment_retries': 10,
            'retry_sleep_functions': {'http': 'exponential'},
            'throttledratelimit': 1024 * 1024,
            'concurrent_fragment_downloads': 3,
            # 헤더/UA
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/132.0.0.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,ko-KR;q=0.6,en;q=0.4',
                'Sec-Fetch-Mode': 'navigate',
            },
            'geo_bypass': True,
            'geo_bypass_country': 'CN',
            'impersonate': 'chrome',
        }
        
        # 쿠키 파일 설정
        cookie_file = self.get_cookiefile_for_url(url)
        if cookie_file:
            ydl_opts['cookiefile'] = cookie_file
        
        # 도우인/카이쇼우 전용 튜닝
        if 'kuaishou.com' in url or 'douyin.com' in url:
            ydl_opts.update({
                'force_ipv4': True,
                'http_chunk_size': 1048576,  # 1MB
            })
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                download_path = ydl.prepare_filename(info)
                if not download_path.endswith('.mp4'):
                    download_path = os.path.splitext(download_path)[0] + '.mp4'
                
                print(f"다운로드 완료: {download_path}")
                return download_path
                
        except Exception as e:
            print(f"다운로드 실패: {url}\n오류: {e}")
            return None
    
    def download_all(self):
        """큐에 있는 모든 URL 다운로드"""
        pending_urls = [item for item in self.url_queue if not item['downloaded']]
        
        if not pending_urls:
            print("다운로드할 URL이 없습니다.")
            return
        
        print(f"총 {len(pending_urls)}개의 URL을 다운로드합니다...")
        
        for i, url_item in enumerate(pending_urls):
            print(f"\n[{i+1}/{len(pending_urls)}] 다운로드 중: {url_item['url']}")
            
            download_path = self.download_single_video(url_item['url'], i+1)
            
            if download_path:
                url_item['downloaded'] = True
                url_item['download_path'] = download_path
                url_item['download_time'] = datetime.now().isoformat()
                print(f"✓ 성공: {download_path}")
            else:
                print(f"✗ 실패: {url_item['url']}")
            
            # 진행상황 저장
            self.save_url_queue()
            
            # 잠시 대기 (서버 부하 방지)
            time.sleep(1)
        
        print(f"\n다운로드 완료!")
        self.show_summary()
    
    def show_queue(self):
        """현재 큐 상태 표시"""
        if not self.url_queue:
            print("큐가 비어있습니다.")
            return
        
        print(f"\n=== URL 큐 ({len(self.url_queue)}개) ===")
        for i, item in enumerate(self.url_queue, 1):
            status = "✓ 완료" if item['downloaded'] else "⏳ 대기"
            desc = f" - {item['description']}" if item['description'] else ""
            print(f"{i:2d}. {status} {item['url']}{desc}")
    
    def show_summary(self):
        """다운로드 요약 표시"""
        total = len(self.url_queue)
        completed = sum(1 for item in self.url_queue if item['downloaded'])
        pending = total - completed
        
        print(f"\n=== 다운로드 요약 ===")
        print(f"전체: {total}개")
        print(f"완료: {completed}개")
        print(f"대기: {pending}개")
    
    def clear_queue(self):
        """큐 초기화"""
        self.url_queue = []
        self.save_url_queue()
        print("큐가 초기화되었습니다.")
    
    def remove_completed(self):
        """완료된 항목 제거"""
        before_count = len(self.url_queue)
        self.url_queue = [item for item in self.url_queue if not item['downloaded']]
        after_count = len(self.url_queue)
        removed_count = before_count - after_count
        
        self.save_url_queue()
        print(f"완료된 {removed_count}개 항목을 제거했습니다.")

def main():
    downloader = DouyinKuaishouDownloader()
    
    while True:
        print("\n=== 도우인/카이쇼우 다운로더 ===")
        print("1. URL 추가")
        print("2. 큐 보기")
        print("3. 모든 URL 다운로드")
        print("4. 요약 보기")
        print("5. 완료된 항목 제거")
        print("6. 큐 초기화")
        print("0. 종료")
        
        choice = input("\n선택하세요: ").strip()
        
        if choice == '1':
            url = input("URL을 입력하세요: ").strip()
            if url:
                description = input("설명 (선택사항): ").strip()
                downloader.add_url(url, description)
            else:
                print("URL을 입력해주세요.")
        
        elif choice == '2':
            downloader.show_queue()
        
        elif choice == '3':
            downloader.download_all()
        
        elif choice == '4':
            downloader.show_summary()
        
        elif choice == '5':
            downloader.remove_completed()
        
        elif choice == '6':
            confirm = input("정말로 큐를 초기화하시겠습니까? (y/N): ").strip().lower()
            if confirm == 'y':
                downloader.clear_queue()
        
        elif choice == '0':
            print("프로그램을 종료합니다.")
            break
        
        else:
            print("잘못된 선택입니다.")

if __name__ == "__main__":
    main()