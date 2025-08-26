#!/usr/bin/env python
# -*- coding: utf-8 -*-

# Python 3.13 호환성 패치
try:
    import python313_compatibility_patch
except ImportError:
    pass

"""
간단한 워터마크 제거 도구 - FFmpeg 기반
Python 2.7 호환, 외부 라이브러리 불필요
"""

import os
import subprocess
import sys
import time

class SimpleWatermarkRemover:
    def __init__(self):
        # WSL 환경에 맞는 경로 설정
        self.target_folder = "/mnt/d/Work/00.개발/클로드아티팩트/동영상워터마크지우기/Realwatermarkdelete"
        self.supported_formats = ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm', '.m4v']
        self.ffmpeg_path = None
        self.setup_ffmpeg()
    
    def setup_ffmpeg(self):
        """FFmpeg 경로 찾기"""
        # WSL 환경에서 Windows 경로 변환
        wsl_target_folder = self.target_folder.replace("D:\\", "/mnt/d/").replace("\\", "/")
        
        possible_paths = [
            os.path.join(wsl_target_folder, "ffmpeg.exe"),
            "/usr/bin/ffmpeg",  # WSL 시스템 ffmpeg
            "ffmpeg"  # PATH에서 찾기
        ]
        
        for path in possible_paths:
            if os.path.exists(path):
                self.ffmpeg_path = path
                print("✅ FFmpeg 발견: %s" % path)
                return True
        
        # PATH에서 ffmpeg 찾기
        try:
            import subprocess
            result = subprocess.check_output(["which", "ffmpeg"], stderr=subprocess.STDOUT)
            self.ffmpeg_path = result.strip().decode()
            print("✅ FFmpeg 발견 (PATH): %s" % self.ffmpeg_path)
            return True
        except:
            pass
            
        return False
    
    def get_video_files(self):
        """비디오 파일 찾기 (하위 폴더 포함)"""
        video_files = []
        if not os.path.exists(self.target_folder):
            return []
        
        print("📁 폴더 스캔: %s" % self.target_folder)
        
        # 메인 폴더와 하위 폴더 모두 검색
        for root, dirs, files in os.walk(self.target_folder):
            print("  📂 검색 중: %s" % root)
            for file in files:
                print("    파일 확인: %s" % file)
                if any(file.lower().endswith(ext) for ext in self.supported_formats):
                    full_path = os.path.join(root, file)
                    video_files.append(full_path)
                    print("      ✅ 비디오 파일 발견!")
        
        return sorted(video_files)
    
    def remove_watermark(self, input_path, output_path):
        """워터마크 제거 실행"""
        import tempfile
        import shutil
        
        temp_input = None
        temp_output = None
        
        try:
            print("  처리 중: %s" % os.path.basename(input_path))
            
            # 임시 파일명 생성 (Windows FFmpeg 호환)
            video_dir = os.path.dirname(input_path)
            import random
            rand_id = random.randint(10000, 99999)
            temp_input = os.path.join(video_dir, "temp_input_%d.mp4" % rand_id)
            temp_output = os.path.join(video_dir, "temp_output_%d.mp4" % rand_id)
            
            # 원본 파일을 임시 파일로 복사
            print("    원본 파일 크기: %d bytes" % os.path.getsize(input_path))
            print("    임시 파일로 복사 중...")
            shutil.copy2(input_path, temp_input)
            
            if os.path.exists(temp_input):
                print("    임시 파일 생성 성공: %d bytes" % os.path.getsize(temp_input))
            else:
                print("    ❌ 임시 파일 생성 실패")
                return False
            
            # 다중 워터마크 제거 필터
            filter_complex = (
                "delogo=x=iw-iw*0.15:y=0:w=iw*0.15:h=ih*0.12,"
                "delogo=x=0:y=0:w=iw*0.15:h=ih*0.12,"
                "delogo=x=0:y=ih-ih*0.15:w=iw:h=ih*0.15,"
                "delogo=x=iw-iw*0.15:y=ih-ih*0.12:w=iw*0.15:h=ih*0.12"
            )
            
            cmd = [
                self.ffmpeg_path,
                '-i', temp_input,
                '-vf', filter_complex,
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '18',
                '-pix_fmt', 'yuv420p',
                '-c:a', 'copy',
                '-map_metadata', '-1',
                '-fflags', '+bitexact',
                '-movflags', '+faststart',
                '-y', temp_output
            ]
            
            # FFmpeg 실행
            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            stdout, stderr = process.communicate()
            
            if process.returncode == 0 and os.path.exists(temp_output):
                # 처리된 파일을 최종 위치로 이동
                shutil.move(temp_output, output_path)
                print("  ✅ 성공: %s" % os.path.basename(output_path))
                return True
            else:
                print("  ❌ 실패: FFmpeg 오류")
                if stderr:
                    print("  오류 내용: %s" % stderr[-200:])
                return False
                
        except Exception as e:
            print("  ❌ 예외 발생: %s" % str(e))
            return False
        finally:
            # 임시 파일 정리
            try:
                if temp_input and os.path.exists(temp_input):
                    os.remove(temp_input)
                    print("    임시 입력 파일 삭제됨")
                if temp_output and os.path.exists(temp_output):
                    os.remove(temp_output)
                    print("    임시 출력 파일 삭제됨")
            except Exception as e:
                print("    임시 파일 정리 중 오류: %s" % str(e))
    
    def process_all(self):
        """모든 비디오 처리"""
        print("🎯 간단한 워터마크 제거 도구")
        print("=" * 50)
        
        if not self.ffmpeg_path:
            print("❌ FFmpeg를 찾을 수 없습니다.")
            print("💡 ffmpeg.exe를 작업 폴더에 복사하세요.")
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
            print("\n[%d/%d]" % (i, len(video_files)))
            
            # 원본 파일과 같은 폴더에 저장
            video_dir = os.path.dirname(video_file)
            base_name = os.path.splitext(os.path.basename(video_file))[0]
            output_path = os.path.join(video_dir, "CLEAN_%s.mp4" % base_name)
            
            if self.remove_watermark(video_file, output_path):
                success_count += 1
            else:
                if os.path.exists(output_path):
                    try:
                        os.remove(output_path)
                    except:
                        pass
        
        print("\n" + "=" * 50)
        print("🎉 완료: %d/%d 파일 처리됨" % (success_count, len(video_files)))
        return True

def main():
    try:
        remover = SimpleWatermarkRemover()
        remover.process_all()
    except KeyboardInterrupt:
        print("\n⚠️ 중단됨")
    except Exception as e:
        print("\n❌ 오류: %s" % str(e))
    finally:
        print("\n프로그램 종료")

if __name__ == "__main__":
    main()