#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
파일 인코딩 변환 도구
"""
import os
import chardet

def convert_file_encoding(input_file, output_file=None, target_encoding='utf-8'):
    """파일 인코딩 변환"""
    if output_file is None:
        output_file = input_file + '.utf8'
    
    # 원본 인코딩 감지
    with open(input_file, 'rb') as f:
        raw_data = f.read()
    
    detected = chardet.detect(raw_data)
    source_encoding = detected.get('encoding', 'cp949')
    
    print(f"원본 인코딩: {source_encoding}")
    print(f"대상 인코딩: {target_encoding}")
    
    # 변환
    try:
        text = raw_data.decode(source_encoding, errors='replace')
        
        with open(output_file, 'w', encoding=target_encoding, errors='replace') as f:
            f.write(text)
        
        print(f"변환 완료: {output_file}")
        return True
    except Exception as e:
        print(f"변환 실패: {e}")
        return False

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        convert_file_encoding(sys.argv[1])
    else:
        print("사용법: python encoding_converter.py <파일명>")
