# -*- coding: utf-8 -*-
"""인스타그램 릴스 업로드 (www.instagram.com, 만들기 → 동영상 선택 → 공유)."""

from pathlib import Path

from ..common import (NotLoggedInError, UploadError, build_caption, click_any,
                      try_click, type_caption, wait_any)

HOME_URL = "https://www.instagram.com/"
MAX_CAPTION = 2200


def check_login(page) -> bool:
    page.goto(HOME_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    return "accounts/login" not in page.url


def upload(page, video_path: Path, meta: dict, logger, timeout_s: int = 600):
    caption = build_caption(meta, max_len=MAX_CAPTION)
    page.goto(HOME_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    if "accounts/login" in page.url:
        raise NotLoggedInError("인스타그램 로그인이 필요합니다. setup_login.py를 먼저 실행하세요.")

    # 알림 허용 등 팝업 닫기
    try_click(page, ['button:has-text("나중에 하기")', 'button:has-text("Not Now")'], 3000)

    # 왼쪽 메뉴 '만들기' 클릭
    click_any(
        page,
        [
            'svg[aria-label="새로운 게시물"]',
            'svg[aria-label="새 게시물"]',
            'svg[aria-label="New post"]',
            'svg[aria-label="만들기"]',
            'svg[aria-label="Create"]',
        ],
        timeout_ms=30000,
    )
    # '게시물' 하위 메뉴가 뜨는 UI 대응
    try_click(
        page,
        ['svg[aria-label="게시물"]', 'span:has-text("게시물")', 'span:has-text("Post")'],
        timeout_ms=4000,
    )

    file_input = wait_any(
        page, ['input[type="file"]'], timeout_ms=30000, require_visible=False
    )
    file_input.set_input_files(str(video_path))
    logger.info("[instagram] 영상 파일 선택 완료")

    # "동영상 게시물은 이제 릴스로 공유됩니다" 안내 팝업
    try_click(page, ['button:has-text("확인")', 'button:has-text("OK")'], 8000)

    # 자르기 → 편집 화면: 다음 2회
    for _ in range(2):
        click_any(
            page,
            ['div[role="button"]:has-text("다음")', 'div[role="button"]:has-text("Next")'],
            timeout_ms=120000,
        )
        page.wait_for_timeout(2000)

    # 문구(캡션) 입력
    cap_box = wait_any(
        page,
        [
            'div[contenteditable="true"][aria-label*="문구"]',
            'div[contenteditable="true"][aria-label*="caption" i]',
            'div[contenteditable="true"]',
        ],
        timeout_ms=30000,
    )
    type_caption(page, cap_box, caption)
    logger.info("[instagram] 문구 입력 완료")

    click_any(
        page,
        [
            'div[role="button"]:has-text("공유하기")',
            'div[role="button"]:has-text("공유")',
            'div[role="button"]:has-text("Share")',
        ],
        timeout_ms=30000,
    )
    logger.info("[instagram] 공유 버튼 클릭, 처리 완료 대기 중...")

    wait_any(
        page,
        [
            ':text("게시물이 공유되었습니다")',
            ':text("릴스가 공유되었습니다")',
            ':text("post has been shared")',
            ':text("reel has been shared")',
        ],
        timeout_ms=int(timeout_s * 1000),
    )
    logger.info("[instagram] 업로드 완료")
    try_click(page, ['svg[aria-label="닫기"]', 'svg[aria-label="Close"]'], 3000)
