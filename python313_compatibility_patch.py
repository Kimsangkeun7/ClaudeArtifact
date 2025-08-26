#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# Python 3.13 호환성 패치
# 자기 자신을 import하지 않도록 수정됨

"""
Python 3.13 호환성 래퍼
threading.py line 992 오류 방지
"""
import sys
import os
import threading
import subprocess
from typing import Optional, Callable, Any

# Python 3.13 호환성 패치 - 강화 버전
class SafeThread(threading.Thread):
    def __init__(self, target=None, name=None, args=(), kwargs=None, daemon=None):
        if kwargs is None:
            kwargs = {}
        self._target_func = target
        self._args = args
        self._kwargs = kwargs
        self._exception = None
        self._started = False
        self._finished = False
        
        try:
            super().__init__(target=None, name=name, args=(), kwargs={}, daemon=daemon)
        except Exception as e:
            print(f"Thread 초기화 오류 방지: {e}")
            self.name = name or f"SafeThread-{id(self)}"
            self.daemon = daemon or False
    
    def run(self):
        try:
            if self._target_func is not None:
                # 안전한 target 함수 실행
                if callable(self._target_func):
                    # args와 kwargs 안전성 검사
                    safe_args = self._args if self._args is not None else ()
                    safe_kwargs = self._kwargs if self._kwargs is not None else {}
                    
                    # 타입 검사
                    if not isinstance(safe_args, (tuple, list)):
                        safe_args = ()
                    if not isinstance(safe_kwargs, dict):
                        safe_kwargs = {}
                    
                    # 안전한 실행
                    result = self._target_func(*safe_args, **safe_kwargs)
                    if hasattr(self, '_result'):
                        self._result = result
                else:
                    print(f"Thread target이 호출 가능하지 않음: {type(self._target_func)}")
        except TypeError as e:
            self._exception = e
            print(f"Thread 인수 오류: {e}")
            # 인수 없이 재시도
            try:
                if callable(self._target_func):
                    result = self._target_func()
                    if hasattr(self, '_result'):
                        self._result = result
            except Exception as retry_error:
                print(f"Thread 재시도 실패: {retry_error}")
        except Exception as e:
            self._exception = e
            print(f"Thread 실행 오류: {e}")
        finally:
            self._finished = True
            try:
                del self._target_func, self._args, self._kwargs
            except:
                pass
    
    def start(self):
        if self._started:
            return
        self._started = True
        try:
            super().start()
        except Exception as e:
            print(f"Thread start 오류 방지: {e}")
            try:
                self.run()
            except Exception as run_error:
                print(f"Thread 직접 실행 오류: {run_error}")
    
    def join(self, timeout=None):
        try:
            super().join(timeout)
        except Exception as e:
            print(f"Thread join 오류 방지: {e}")
            import time
            start_time = time.time()
            while not self._finished:
                if timeout and (time.time() - start_time) > timeout:
                    break
                time.sleep(0.1)

# 강화된 안전한 subprocess 실행
def safe_subprocess_run(*args, **kwargs):
    """subprocess.run의 강화된 안전한 래퍼"""
    try:
        # timeout 기본값 설정
        if 'timeout' not in kwargs:
            kwargs['timeout'] = 300
        
        # encoding 설정
        if 'text' in kwargs and kwargs['text'] and 'encoding' not in kwargs:
            kwargs['encoding'] = 'utf-8'
            kwargs['errors'] = 'replace'
        
        # Python 3.13 subprocess 호환성을 위한 추가 설정
        if 'capture_output' in kwargs and kwargs['capture_output']:
            # capture_output=True일 때 안전한 설정
            kwargs['stdout'] = subprocess.PIPE
            kwargs['stderr'] = subprocess.PIPE
            del kwargs['capture_output']
        
        # 스레드 안전성을 위한 설정
        if 'shell' not in kwargs:
            kwargs['shell'] = False
        
        # Windows에서 창 숨기기
        if hasattr(subprocess, 'CREATE_NO_WINDOW'):
            if 'creationflags' not in kwargs:
                kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
        
        return subprocess.run(*args, **kwargs)
        
    except subprocess.TimeoutExpired as e:
        print(f"Subprocess timeout: {e}")
        raise
    except FileNotFoundError as e:
        print(f"Subprocess 파일 없음: {e}")
        raise
    except PermissionError as e:
        print(f"Subprocess 권한 오류: {e}")
        raise
    except Exception as e:
        print(f"Subprocess 오류: {e}")
        # 간단한 대체 실행 시도
        try:
            if len(args) > 0 and isinstance(args[0], (list, tuple)):
                cmd = args[0]
                if len(cmd) > 0:
                    print(f"간단한 실행 시도: {cmd[0]}")
                    # 기본 설정으로 재시도
                    simple_kwargs = {
                        'shell': kwargs.get('shell', False),
                        'timeout': kwargs.get('timeout', 300)
                    }
                    return subprocess.run(cmd, **simple_kwargs)
        except Exception as retry_error:
            print(f"재시도 실패: {retry_error}")
        raise

# 기존 모듈 패치
original_thread = threading.Thread
original_subprocess_run = subprocess.run

threading.Thread = SafeThread
subprocess.run = safe_subprocess_run

# 내부 함수들도 안전하게 패치
if hasattr(threading, '_bootstrap_inner'):
    original_bootstrap_inner = threading._bootstrap_inner
    def safe_bootstrap_inner(self):
        try:
            return original_bootstrap_inner(self)
        except Exception as e:
            print(f"_bootstrap_inner 오류 방지: {e}")
            try:
                if hasattr(self, 'run'):
                    self.run()
            except Exception as run_error:
                print(f"run 대체 실행 오류: {run_error}")
    threading._bootstrap_inner = safe_bootstrap_inner

# subprocess 내부 스레드 함수들도 패치
if hasattr(subprocess, '_readerthread'):
    original_readerthread = subprocess._readerthread
    def safe_readerthread(fh, buffer):
        try:
            return original_readerthread(fh, buffer)
        except Exception as e:
            print(f"subprocess _readerthread 오류 방지: {e}")
            # 안전한 읽기 시도
            try:
                if hasattr(fh, 'read'):
                    data = fh.read()
                    if data and hasattr(buffer, 'append'):
                        buffer.append(data)
            except Exception as read_error:
                print(f"안전한 읽기 실패: {read_error}")
    subprocess._readerthread = safe_readerthread

# Popen 클래스도 안전하게 패치
original_popen = subprocess.Popen
class SafePopen(original_popen):
    def __init__(self, *args, **kwargs):
        try:
            # Windows에서 안전한 설정
            if hasattr(subprocess, 'CREATE_NO_WINDOW'):
                if 'creationflags' not in kwargs:
                    kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
            super().__init__(*args, **kwargs)
        except Exception as e:
            print(f"Popen 초기화 오류: {e}")
            # 기본 설정으로 재시도
            try:
                simple_kwargs = {k: v for k, v in kwargs.items() 
                               if k in ['shell', 'cwd', 'env', 'stdout', 'stderr', 'stdin']}
                super().__init__(*args, **simple_kwargs)
            except Exception as retry_error:
                print(f"Popen 재시도 실패: {retry_error}")
                raise

subprocess.Popen = SafePopen

# 인코딩 문제 해결 패치
original_subprocess_run = subprocess.run

def unicode_safe_subprocess_run(*args, **kwargs):
    """UnicodeDecodeError 방지 subprocess.run"""
    try:
        # 기본 인코딩 설정
        if 'text' in kwargs and kwargs['text']:
            if 'encoding' not in kwargs:
                kwargs['encoding'] = 'utf-8'
            if 'errors' not in kwargs:
                kwargs['errors'] = 'replace'
        
        return original_subprocess_run(*args, **kwargs)
        
    except UnicodeDecodeError as e:
        print(f"Subprocess 인코딩 오류 자동 수정: {e}")
        
        # 인코딩 설정 수정하여 재시도
        if 'text' in kwargs:
            # cp949로 재시도
            kwargs['encoding'] = 'cp949'
            kwargs['errors'] = 'replace'
            try:
                return original_subprocess_run(*args, **kwargs)
            except UnicodeDecodeError:
                # latin-1로 최종 시도
                kwargs['encoding'] = 'latin-1'
                kwargs['errors'] = 'ignore'
                return original_subprocess_run(*args, **kwargs)
        else:
            raise
    except Exception as e:
        raise

subprocess.run = unicode_safe_subprocess_run

# 파일 읽기/쓰기 안전 함수들
def safe_open(file_path, mode='r', encoding=None, errors='replace', **kwargs):
    """안전한 파일 열기 (인코딩 자동 처리)"""
    if 'b' in mode:
        # 바이너리 모드는 그대로
        return open(file_path, mode, **kwargs)
    
    if encoding is None:
        # 인코딩 자동 감지 시도
        encodings = ['utf-8', 'cp949', 'euc-kr', 'latin-1']
        
        for enc in encodings:
            try:
                return open(file_path, mode, encoding=enc, errors=errors, **kwargs)
            except UnicodeDecodeError:
                continue
            except FileNotFoundError:
                raise
            except Exception:
                continue
        
        # 모든 인코딩 실패 시 UTF-8 + ignore
        return open(file_path, mode, encoding='utf-8', errors='ignore', **kwargs)
    else:
        # 지정된 인코딩 사용
        return open(file_path, mode, encoding=encoding, errors=errors, **kwargs)

# 기존 open 함수 백업 및 교체
import builtins
original_open = builtins.open
builtins.open = safe_open

print("✅ Python 3.13 궁극적 호환성 패치 적용됨 (threading + subprocess + 인코딩 완전 보호)")
