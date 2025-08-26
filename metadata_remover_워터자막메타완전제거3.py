#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# Python 3.13 호환성 패치
try:
    import python313_compatibility_patch
except ImportError:
    pass

"""
완전한 워터마크 및 자막 제거 도구 - Version 4.5
- 동영상 파일의 모든 메타데이터 제거
- 시각적 워터마크, 로고, 자막 텍스트 제거
- ⭐ FFmpeg 인코더 오류 해결: 표준 픽셀 포맷(yuv420p)을 지정하여 호환성 문제 해결
- ⭐ FFmpeg 필터 계산식 오류 해결: 파이썬에서 좌표를 직접 계산 후 전달하여 안정성 확보
- ⭐ 실행 환경 오류 해결: 작업 폴더 경로를 코드에 직접 지정하여 입력 과정 생략
"""

import os
import subprocess
import sys
from pathlib import Path
import time
import tempfile
import json
import shutil
import re

# 인코딩 문제 해결을 위한 설정
if sys.platform == 'win32':
    os.environ['PYTHONIOENCODING'] = 'utf-8'
    try:
        subprocess.run('chcp 65001', shell=True, capture_output=True, check=False)
    except Exception:
        pass

class WatermarkRemover:
    def __init__(self):
        # 작업 폴더 경로를 코드에 직접 지정
        self.target_folder = Path(r"D:\Work\00.개발\클로드아티팩트\동영상워터마크지우기\Realwatermarkdelete")
            
        self.supported_formats = ['.mp4', '.mpeg4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm', '.m4v', '.3gp']
        
        self.possible_ffmpeg_paths = []
        self.ffmpeg_path = None
        self.ffprobe_path = None
        
        # 워터마크 제거 프리셋 (계산식 템플릿)
        self.removal_presets = {
            '1': {
                'name': '상단 좌측 워터마크 제거',
                'description': '비디오 좌측 상단 영역의 로고/워터마크 제거',
                'filter': 'delogo=x=0:y=0:w=iw*0.16:h=ih*0.1'
            },
            '2': {
                'name': '하단 좌측 워터마크 제거',
                'description': '비디오 좌측 하단 영역의 로고/워터마크 제거',
                'filter': 'delogo=x=0:y=ih-ih*0.1:w=iw*0.16:h=ih*0.1'
            },
            '3': {
                'name': '우측 상단 워터마크 제거',
                'description': '비디오 우측 상단의 로고 제거',
                'filter': 'delogo=x=iw-iw*0.11:y=0:w=iw*0.11:h=ih*0.1'
            },
            '4': {
                'name': '우측 하단 워터마크 제거',
                'description': '비디오 우측 하단의 로고 제거',
                'filter': 'delogo=x=iw-iw*0.11:y=ih-ih*0.1:w=iw*0.11:h=ih*0.1'
            },
            '5': {
                'name': '중앙 하단 자막 제거',
                'description': '비디오 하단 중앙의 자막/텍스트 제거',
                'filter': 'delogo=x=iw*0.1:y=ih-ih*0.12:w=iw*0.8:h=ih*0.12'
            },
            '6': {
                'name': '전체 하단 영역 제거',
                'description': '비디오 하단 전체 영역의 자막/워터마크 제거',
                'filter': 'delogo=x=0:y=ih-ih*0.15:w=iw:h=ih*0.15'
            },
            '9': {
                'name': '광범위 자동 제거 (주요 영역 동시 처리)',
                'description': '영상 상단, 하단, 우측 등 주요 워터마크 출현 영역을 한 번에 제거합니다.',
                'filter': 'auto_text'
            },
            '0': {
                'name': '워터마크 제거 안함 (메타데이터만 제거)',
                'description': '시각적 워터마크는 그대로 두고 메타데이터만 제거',
                'filter': 'none'
            }
        }
        # FFmpeg 경로 설정
        self.setup_ffmpeg_paths()

    def setup_ffmpeg_paths(self):
        """대상 폴더를 기준으로 FFmpeg 경로를 설정합니다."""
        if not self.target_folder:
            print("❌ 대상 폴더가 설정되지 않았습니다.")
            return
        self.possible_ffmpeg_paths = [
            self.target_folder / "ffmpeg.exe",
            r"C:\Program Files (x86)\Digiarty\VideoProc Converter AI\ffmpeg.exe",
            r"C:\Program Files\FFmpeg\bin\ffmpeg.exe",
            r"C:\ffmpeg\bin\ffmpeg.exe",
            "ffmpeg"
        ]
    
    def find_ffmpeg(self):
        """FFmpeg 실행 파일 찾기"""
        for path in self.possible_ffmpeg_paths:
            try:
                if isinstance(path, Path):
                    if path.exists():
                        result = subprocess.run([str(path), '-version'], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=5)
                        if result.returncode == 0:
                            self.ffmpeg_path = str(path)
                            ffprobe_path = path.parent / "ffprobe.exe"
                            if ffprobe_path.exists():
                                self.ffprobe_path = str(ffprobe_path)
                            return True
                elif path == "ffmpeg":
                    result = subprocess.run([path, '-version'], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=5, shell=True)
                    if result.returncode == 0:
                        self.ffmpeg_path = path
                        self.ffprobe_path = "ffprobe"
                        return True
            except Exception:
                continue
        return False
    
    def check_ffmpeg(self):
        """FFmpeg가 사용 가능한지 확인"""
        print("🔍 FFmpeg 찾는 중...")
        if self.find_ffmpeg():
            print(f"✅ FFmpeg 발견: {self.ffmpeg_path}")
            if self.ffprobe_path:
                print(f"✅ FFprobe 발견: {self.ffprobe_path}")
            return True
        else:
            print("❌ FFmpeg를 찾을 수 없습니다.")
            print(f"💡 해결 방법: ffmpeg.exe를 작업 폴더에 복사했는지 확인하세요: {self.target_folder}")
            return False
    
    def get_video_files(self):
        """대상 폴더에서 동영상 파일 목록 가져오기"""
        if not self.target_folder or not self.target_folder.exists():
            print(f"❌ 오류: 대상 폴더가 올바르지 않습니다: {self.target_folder}")
            return []
        
        video_files = []
        for format_ext in self.supported_formats:
            video_files.extend(self.target_folder.glob(f"*{format_ext}"))
            video_files.extend(self.target_folder.glob(f"*{format_ext.upper()}"))
        
        return sorted(list(set(video_files)))
    
    def get_video_dimensions(self, input_path):
        """비디오의 해상도 정보 가져오기"""
        if self.ffprobe_path:
            try:
                cmd = [self.ffprobe_path, '-v', 'quiet', '-print_format', 'json', '-show_streams', '-select_streams', 'v:0', str(input_path)]
                result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=10)
                if result.stdout:
                    data = json.loads(result.stdout)
                    if 'streams' in data and data['streams'] and 'width' in data['streams'][0] and 'height' in data['streams'][0]:
                        return data['streams'][0]['width'], data['streams'][0]['height']
            except Exception: pass
        
        try:
            cmd = [self.ffmpeg_path, '-i', str(input_path)]
            result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=10)
            match = re.search(r'Stream.*Video:.*, (\d{3,5})x(\d{3,5})', result.stderr)
            if match:
                return int(match.group(1)), int(match.group(2))
            return 1920, 1080
        except Exception:
            return 1920, 1080

    def _calculate_filter_string(self, filter_template, width, height):
        """
        템플릿과 실제 해상도를 바탕으로 FFmpeg 필터 문자열을 계산합니다.
        """
        if filter_template == 'none' or filter_template == 'auto_text':
            return filter_template

        final_filters = []
        for single_filter_template in filter_template.split(','):
            calculated_parts = []
            for part in single_filter_template.split(':'):
                if '=' in part:
                    key, value_expr = part.split('=', 1)
                    try:
                        value_expr_with_dims = value_expr.replace('iw', str(width)).replace('ih', str(height))
                        calculated_value = int(eval(value_expr_with_dims))
                        calculated_parts.append(f"{key}={calculated_value}")
                    except:
                        calculated_parts.append(part)
                else:
                    calculated_parts.append(part)
            final_filters.append(':'.join(calculated_parts))
        
        return ','.join(final_filters)

    def remove_watermark_and_metadata(self, input_path, output_path, filter_string):
        """워터마크 및 메타데이터 제거 실행"""
        try:
            temp_dir = Path(tempfile.gettempdir())
            timestamp = int(time.time())
            # 파일 이름 충돌을 방지하기 위해 프로세스 ID 추가
            pid = os.getpid()
            temp_input = temp_dir / f"temp_input_{timestamp}_{pid}{input_path.suffix}"
            temp_clean = temp_dir / f"temp_clean_{timestamp}_{pid}.mp4"
            temp_final = temp_dir / f"temp_final_{timestamp}_{pid}.mp4"
            
            shutil.copy2(str(input_path), str(temp_input))
            
            try:
                process_file = temp_input
                if filter_string != 'none':
                    print("  1단계: 워터마크/자막 제거...")
                    # --- 최종 오류 수정 지점: -pix_fmt yuv420p 옵션 추가 ---
                    cmd_delogo = [
                        self.ffmpeg_path, 
                        '-i', str(temp_input), 
                        '-vf', filter_string, 
                        '-c:v', 'libx264', 
                        '-preset', 'medium', 
                        '-crf', '23', 
                        '-pix_fmt', 'yuv420p', # 인코더 호환성을 위한 픽셀 포맷 지정
                        '-c:a', 'copy', 
                        '-y', str(temp_clean)
                    ]
                    # --- 수정 완료 ---
                    result1 = subprocess.run(cmd_delogo, capture_output=True, text=True, encoding='utf-8', errors='replace')
                    if result1.returncode != 0:
                        print(f"  ❌ 1단계 FFmpeg 오류:\n{result1.stderr[-500:]}")
                        return False, "워터마크 제거 실패"
                    process_file = temp_clean
                
                print("  2단계: 메타데이터 완전 제거...")
                cmd_metadata = [self.ffmpeg_path, '-i', str(process_file), '-map', '0', '-map_metadata', '-1', '-c', 'copy', '-fflags', '+bitexact', '-movflags', '+faststart', '-y', str(temp_final)]
                result2 = subprocess.run(cmd_metadata, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=300)
                if result2.returncode != 0:
                    print(f"  ❌ 2단계 FFmpeg 오류:\n{result2.stderr[-500:]}")
                    return False, "메타데이터 제거 오류"
                
                shutil.copy2(str(temp_final), str(output_path))
                return True, "처리 완료"
            finally:
                for temp_file in [temp_input, temp_clean, temp_final]:
                    if temp_file.exists():
                        try:
                            temp_file.unlink()
                        except Exception: pass
        except Exception as e:
            return False, f"예외 발생: {str(e)}"

    def process_folder(self):
        """전체 처리 과정 제어"""
        print(f"🎯 완전한 워터마크 및 자막 제거 도구 - Version 4.5")
        print("=" * 70)
        
        if not self.target_folder.exists() or not self.target_folder.is_dir():
             print(f"❌ 설정된 작업 폴더를 찾을 수 없습니다: {self.target_folder}")
             print("   스크립트 상단의 'self.target_folder' 경로가 올바른지 확인해주세요.")
             return False
        
        print(f"📁 작업 폴더: {self.target_folder}")
        if not self.check_ffmpeg():
            return False
        
        video_files = self.get_video_files()
        if not video_files:
            print("❌ 처리할 동영상 파일을 찾을 수 없습니다.")
            return False
        
        print(f"\n📊 발견된 동영상 파일: {len(video_files)}개")
        for i, f in enumerate(video_files, 1):
            try:
                print(f"  {i}. {f.name} ({f.stat().st_size / (1024*1024):.1f}MB)")
            except FileNotFoundError:
                print(f"  {i}. {f.name} (파일을 찾을 수 없음)")

        # 비대화형 환경을 위해 기본값 설정
        choice = '1' # 기본으로 '상단 좌측 워터마크 제거' 선택
        prefix = "CLEAN"
        
        print(f"\n⚠️ 비대화형 모드입니다. 기본 옵션으로 진행합니다.")
        print(f"   - 제거 방식: {self.removal_presets[choice]['name']}")
        print(f"   - 출력 접두사: {prefix}")
        
        filter_template = self.removal_presets[choice]['filter']
        
        print("\n" + "🔄" * 35 + "\n")
        success_count = 0
        for i, video_file in enumerate(video_files, 1):
            print(f"[{i}/{len(video_files)}] 처리 중: {video_file.name}")
            
            width, height = self.get_video_dimensions(video_file)
            print(f"  해상도: {width}x{height}")

            # 템플릿을 기반으로 실제 필터 값 계산
            final_filter_string = self._calculate_filter_string(filter_template, width, height)
            print(f"  적용 필터: {final_filter_string}")

            output_path = video_file.parent / f"{prefix}_{video_file.stem}.mp4"
            if output_path.resolve() == video_file.resolve():
                output_path = video_file.parent / f"{prefix}_NEW_{video_file.stem}.mp4"
            
            success, message = self.remove_watermark_and_metadata(video_file, output_path, final_filter_string)
            if success:
                success_count += 1
                print(f"✅ 완료: {message}\n")
            else:
                print(f"❌ 실패: {message}\n")
                if output_path.exists(): 
                    try:
                        output_path.unlink()
                    except Exception: pass

        print("=" * 70)
        print(f"🎉 작업 완료: {success_count}/{len(video_files)} 파일 처리됨")
        if success_count > 0:
            print(f"📁 처리된 파일들은 '{self.target_folder}' 폴더에 '{prefix}_' 접두사로 저장되었습니다.")
        return True

def main():
    """메인 함수"""
    try:
        remover = WatermarkRemover()
        remover.process_folder()
    except Exception as e:
        print(f"\n❌ 예상치 못한 오류 발생: {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        print("\n프로그램 실행이 완료되었습니다.")

if __name__ == "__main__":
    main()
