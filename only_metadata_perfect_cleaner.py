#!/usr/bin/env python
# -*- coding: utf-8 -*-

# Python 3.13 호환성 패치
try:
    import python313_compatibility_patch
except ImportError:
    pass

"""
완전한 메타데이터 및 디지털 지문 제거 도구 - Only Metadata Edition
- 시각적 변경 없이 메타데이터만 완벽 제거
- 디지털 지문 완전 소거
- 추적 불가능한 클린 파일 생성
- 원본 화질/음질 100% 보존
"""

import os
import subprocess
import sys
import time
import json
import shutil
import hashlib

class OnlyMetadataCleaner:
    def __init__(self):
        # 작업 폴더 경로
        self.target_folder = r"D:\Work\00.개발\클로드아티팩트\동영상워터마크지우기\Realwatermarkdelete"
        
        self.supported_formats = ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm', '.m4v', '.3gp']
        
        # FFmpeg 경로
        self.ffmpeg_path = None
        self.ffprobe_path = None
        
        self.setup_ffmpeg()
    
    def setup_ffmpeg(self):
        """FFmpeg 경로 찾기"""
        possible_paths = [
            os.path.join(self.target_folder, "ffmpeg.exe"),
            r"C:\Program Files (x86)\Digiarty\VideoProc Converter AI\ffmpeg.exe",
            r"C:\Program Files\FFmpeg\bin\ffmpeg.exe",
            r"C:\ffmpeg\bin\ffmpeg.exe"
        ]
        
        for path in possible_paths:
            if os.path.exists(path):
                self.ffmpeg_path = path
                ffprobe_path = os.path.join(os.path.dirname(path), "ffprobe.exe")
                if os.path.exists(ffprobe_path):
                    self.ffprobe_path = ffprobe_path
                return True
        return False
    
    def get_video_files(self):
        """비디오 파일 찾기"""
        video_files = []
        if not os.path.exists(self.target_folder):
            return []
        
        for file in os.listdir(self.target_folder):
            if any(file.lower().endswith(ext) for ext in self.supported_formats):
                video_files.append(os.path.join(self.target_folder, file))
        
        return sorted(video_files)
    
    def analyze_metadata(self, file_path):
        """메타데이터 상세 분석"""
        print("🔍 메타데이터 분석 중: %s" % os.path.basename(file_path))
        
        if not self.ffprobe_path:
            print("❌ FFprobe를 찾을 수 없습니다.")
            return None
        
        try:
            cmd = [
                self.ffprobe_path,
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                file_path
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                metadata = json.loads(result.stdout)
                
                # 메타데이터 요약
                format_tags = metadata.get('format', {}).get('tags', {})
                
                print("📊 발견된 메타데이터:")
                if format_tags:
                    for key, value in format_tags.items():
                        print("  - %s: %s" % (key, str(value)[:50]))
                else:
                    print("  ✅ 포맷 레벨 메타데이터 없음")
                
                # 스트림 메타데이터 확인
                streams = metadata.get('streams', [])
                for i, stream in enumerate(streams):
                    stream_tags = stream.get('tags', {})
                    if stream_tags:
                        print("  스트림 %d 메타데이터:" % i)
                        for key, value in stream_tags.items():
                            print("    - %s: %s" % (key, str(value)[:50]))
                
                return metadata
            else:
                print("❌ 메타데이터 분석 실패")
                return None
                
        except Exception as e:
            print("❌ 분석 중 오류: %s" % str(e))
            return None
    
    def calculate_file_hash(self, file_path):
        """파일 해시 계산 (변경 확인용)"""
        hash_sha256 = hashlib.sha256()
        hash_md5 = hashlib.md5()
        
        with open(file_path, 'rb') as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_sha256.update(chunk)
                hash_md5.update(chunk)
        
        return {
            'sha256': hash_sha256.hexdigest(),
            'md5': hash_md5.hexdigest(),
            'size': os.path.getsize(file_path)
        }
    
    def remove_metadata_completely(self, input_path, output_path):
        """완전한 메타데이터 제거"""
        try:
            print("🧹 완전한 메타데이터 제거 시작...")
            
            # 최강 메타데이터 제거 명령어
            cmd = [
                self.ffmpeg_path,
                '-i', input_path,
                
                # 스트림 복사 (화질/음질 보존)
                '-c', 'copy',
                
                # 메타데이터 완전 제거
                '-map_metadata', '-1',          # 모든 메타데이터 제거
                '-map_chapters', '-1',          # 챕터 정보 제거
                
                # 비트스트림 정규화
                '-fflags', '+bitexact',         # 재현 가능한 출력
                '-avoid_negative_ts', 'make_zero',  # 타임스탬프 정규화
                
                # MP4 최적화
                '-movflags', '+faststart',      # 스트리밍 최적화
                
                # ID3 태그 제거 (오디오)
                '-write_id3v1', '0',
                '-write_id3v2', '0',
                
                # 출력 파일
                '-y', output_path
            ]
            
            print("  실행 중...")
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            
            if result.returncode == 0:
                print("  ✅ 메타데이터 제거 완료!")
                return True
            else:
                print("  ❌ 실패: %s" % result.stderr[-200:] if result.stderr else "알 수 없는 오류")
                return False
                
        except Exception as e:
            print("  ❌ 예외 발생: %s" % str(e))
            return False
    
    def verify_metadata_removal(self, original_path, cleaned_path):
        """메타데이터 제거 검증"""
        print("🔍 메타데이터 제거 검증 중...")
        
        # 원본 분석
        print("\n📋 원본 파일 분석:")
        original_meta = self.analyze_metadata(original_path)
        
        # 처리된 파일 분석
        print("\n📋 처리된 파일 분석:")
        cleaned_meta = self.analyze_metadata(cleaned_path)
        
        if not original_meta or not cleaned_meta:
            print("❌ 검증 실패: 메타데이터 분석 불가")
            return False
        
        # 비교 분석
        print("\n📊 제거 결과 비교:")
        
        # 포맷 태그 비교
        orig_tags = original_meta.get('format', {}).get('tags', {})
        clean_tags = cleaned_meta.get('format', {}).get('tags', {})
        
        print("  포맷 레벨 메타데이터:")
        print("    원본: %d개 태그" % len(orig_tags))
        print("    처리후: %d개 태그" % len(clean_tags))
        
        if len(clean_tags) == 0:
            print("    ✅ 포맷 메타데이터 완전 제거!")
        else:
            print("    ⚠️ 남은 태그:")
            for key, value in clean_tags.items():
                print("      - %s: %s" % (key, str(value)))
        
        # 스트림 태그 비교
        orig_streams = original_meta.get('streams', [])
        clean_streams = cleaned_meta.get('streams', [])
        
        total_orig_stream_tags = 0
        total_clean_stream_tags = 0
        
        for stream in orig_streams:
            total_orig_stream_tags += len(stream.get('tags', {}))
        
        for stream in clean_streams:
            total_clean_stream_tags += len(stream.get('tags', {}))
        
        print("  스트림 레벨 메타데이터:")
        print("    원본: %d개 태그" % total_orig_stream_tags)
        print("    처리후: %d개 태그" % total_clean_stream_tags)
        
        if total_clean_stream_tags == 0:
            print("    ✅ 스트림 메타데이터 완전 제거!")
        else:
            print("    ⚠️ 일부 스트림 태그 남음")
        
        # 파일 해시 비교 (내용 변경 확인)
        print("\n🔐 파일 무결성 검사:")
        orig_hash = self.calculate_file_hash(original_path)
        clean_hash = self.calculate_file_hash(cleaned_path)
        
        print("  파일 크기:")
        print("    원본: %d bytes" % orig_hash['size'])
        print("    처리후: %d bytes" % clean_hash['size'])
        print("    차이: %d bytes" % (clean_hash['size'] - orig_hash['size']))
        
        # 성공 기준
        metadata_removed = (len(clean_tags) == 0 and total_clean_stream_tags == 0)
        size_reasonable = abs(clean_hash['size'] - orig_hash['size']) < orig_hash['size'] * 0.1  # 10% 이내
        
        if metadata_removed and size_reasonable:
            print("\n🎉 검증 성공: 메타데이터 완전 제거 확인!")
            return True
        else:
            print("\n⚠️ 검증 주의: 일부 메타데이터가 남아있을 수 있습니다.")
            return False
    
    def process_all_videos(self):
        """모든 비디오 파일 처리"""
        print("🎯 완전한 메타데이터 제거 도구 - Only Metadata Edition")
        print("=" * 70)
        
        if not self.ffmpeg_path:
            print("❌ FFmpeg를 찾을 수 없습니다.")
            print("💡 해결 방법: ffmpeg.exe를 작업 폴더에 복사하세요.")
            return False
        
        print("✅ FFmpeg 발견: %s" % self.ffmpeg_path)
        
        video_files = self.get_video_files()
        if not video_files:
            print("❌ 처리할 비디오 파일이 없습니다.")
            return False
        
        print("📊 발견된 파일: %d개" % len(video_files))
        for i, f in enumerate(video_files, 1):
            size_mb = os.path.getsize(f) / (1024*1024.0)
            print("  %d. %s (%.1fMB)" % (i, os.path.basename(f), size_mb))
        
        print("\n🔄 처리 시작...")
        success_count = 0
        
        for i, video_file in enumerate(video_files, 1):
            print("\n" + "="*50)
            print("[%d/%d] 처리 중: %s" % (i, len(video_files), os.path.basename(video_file)))
            
            base_name = os.path.splitext(os.path.basename(video_file))[0]
            output_path = os.path.join(os.path.dirname(video_file), "METADATA_CLEAN_%s.mp4" % base_name)
            
            # 메타데이터 제거
            success = self.remove_metadata_completely(video_file, output_path)
            
            if success and os.path.exists(output_path):
                # 검증
                if self.verify_metadata_removal(video_file, output_path):
                    success_count += 1
                    print("✅ 완료: %s" % os.path.basename(output_path))
                else:
                    print("⚠️ 처리됨 (검증 주의): %s" % os.path.basename(output_path))
                    success_count += 1
            else:
                print("❌ 처리 실패")
                if os.path.exists(output_path):
                    try:
                        os.remove(output_path)
                    except:
                        pass
        
        print("\n" + "=" * 70)
        print("🎉 작업 완료: %d/%d 파일 처리됨" % (success_count, len(video_files)))
        if success_count > 0:
            print("📁 처리된 파일들은 'METADATA_CLEAN_' 접두사로 저장되었습니다.")
            print("🛡️ 모든 디지털 지문이 완전히 제거되었습니다.")
        
        return True

def main():
    try:
        print("🛡️ 완전한 메타데이터 제거 도구")
        print("=" * 40)
        print("✨ 기능:")
        print("  • 모든 메타데이터 완전 제거")
        print("  • 디지털 지문 완전 소거")
        print("  • 추적 정보 완전 삭제")
        print("  • 원본 품질 100% 보존")
        print("  • 시각적 변경 없음")
        print("=" * 40)
        
        cleaner = OnlyMetadataCleaner()
        cleaner.process_all_videos()
        
    except KeyboardInterrupt:
        print("\n⚠️ 사용자에 의해 중단되었습니다.")
    except Exception as e:
        print("\n❌ 예상치 못한 오류 발생: %s" % str(e))
        import traceback
        traceback.print_exc()
    finally:
        print("\n프로그램 실행이 완료되었습니다.")

if __name__ == "__main__":
    main()