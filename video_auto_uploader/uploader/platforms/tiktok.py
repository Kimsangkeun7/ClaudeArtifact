# -*- coding: utf-8 -*-
"""틱톡 업로드 (TikTok Studio: www.tiktok.com/tiktokstudio/upload)."""

import time
from pathlib import Path

from ..common import (NotLoggedInError, UploadError, build_caption, click_any,
                      try_click, type_caption, wait_any)

UPLOAD_URL = "https://www.tiktok.com/tiktokstudio/upload?from=upload"
MAX_CAPTION = 4000


def check_login(page) -> bool:
    page.goto(UPLOAD_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    return "/login" not in page.url


def upload(page, video_path: Path, meta: dict, logger, timeout_s: int = 600):
    caption = build_caption(meta, max_len=MAX_CAPTION)
    page.goto(UPLOAD_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    if "/login" in page.url:
        raise NotLoggedInError("틱톡 로그인이 필요합니다. setup_login.py를 먼저 실행하세요.")

    file_input = wait_any(
        page, ['input[type="file"]'], timeout_ms=60000, require_visible=False
    )
    file_input.set_input_files(str(video_path))
    logger.info("[tiktok] 영상 파일 선택 완료, 업로드 처리 대기 중...")

    # 캡션 편집기가 나타나면 업로드 폼이 준비된 것
    editor = wait_any(
        page,
        [
            'div[contenteditable="true"][aria-label*="캡션"]',
            'div[contenteditable="true"][aria-label*="caption" i]',
            'div.public-DraftEditor-content',
            'div[contenteditable="true"]',
        ],
        timeout_ms=180000,
    )
    # 파일명이 캡션에 자동 입력되므로 지우고 새로 입력
    type_caption(page, editor, caption)
    logger.info("[tiktok] 캡션 입력 완료")

    # 게시 버튼이 활성화될 때까지(영상 검사/처리 완료) 대기 후 클릭
    post_selectors = [
        'button[data-e2e="post_video_button"]',
        'button:has-text("게시")',
        'button:has-text("Post")',
    ]
    btn = wait_any(page, post_selectors, timeout_ms=int(timeout_s * 1000))
    deadline = time.monotonic() + timeout_s
    while btn.is_disabled():
        if time.monotonic() > deadline:
            raise UploadError("틱톡 게시 버튼이 활성화되지 않았습니다(영상 처리 지연/실패).")
        page.wait_for_timeout(2000)
    btn.click()
    logger.info("[tiktok] 게시 버튼 클릭, 완료 대기 중...")

    # 게시 완료 확인: 성공 모달 또는 콘텐츠 관리 화면으로 이동
    wait_any(
        page,
        [
            ':text("동영상이 게시되었습니다")',
            ':text("게시되었습니다")',
            ':text("Your video has been published")',
            ':text("has been published")',
            'button:has-text("동영상 관리")',
            'button:has-text("Manage your posts")',
        ],
        timeout_ms=180000,
    )
    logger.info("[tiktok] 업로드 완료")
    try_click(page, ['button:has-text("닫기")', 'button:has-text("Close")'], 3000)
