# -*- coding: utf-8 -*-
"""페이스북 릴스 업로드 (www.facebook.com/reels/create)."""

from pathlib import Path

from ..common import (NotLoggedInError, UploadError, build_caption, click_any,
                      try_click, type_caption, wait_any)

LOGIN_URL_HINT = "login"
CREATE_URL = "https://www.facebook.com/reels/create"

HOME_URL = "https://www.facebook.com/"


def check_login(page) -> bool:
    page.goto(HOME_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    return LOGIN_URL_HINT not in page.url and page.locator("#email").count() == 0


def upload(page, video_path: Path, meta: dict, logger, timeout_s: int = 600):
    caption = build_caption(meta)
    page.goto(CREATE_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    if LOGIN_URL_HINT in page.url:
        raise NotLoggedInError("페이스북 로그인이 필요합니다. setup_login.py를 먼저 실행하세요.")

    file_input = wait_any(
        page,
        ['input[type="file"][accept*="video"]', 'input[type="file"]'],
        timeout_ms=30000, require_visible=False,
    )
    file_input.set_input_files(str(video_path))
    logger.info("[facebook] 영상 파일 선택 완료, 업로드 대기 중...")

    # 단계 이동: 다음 → 다음 (UI에 따라 1~2회)
    for _ in range(2):
        try_click(
            page,
            ['div[role="button"]:has-text("다음")', 'div[role="button"]:has-text("Next")'],
            timeout_ms=60000,
        )
        page.wait_for_timeout(2000)

    # 릴스 설명 입력
    desc_box = wait_any(
        page,
        [
            'div[contenteditable="true"][aria-label*="설명"]',
            'div[contenteditable="true"][aria-label*="Describe" i]',
            'div[contenteditable="true"]',
        ],
        timeout_ms=30000,
    )
    type_caption(page, desc_box, caption)
    logger.info("[facebook] 설명 입력 완료")

    click_any(
        page,
        [
            'div[role="button"]:has-text("공유하기")',
            'div[role="button"]:has-text("게시")',
            'div[role="button"]:has-text("Publish")',
            'div[role="button"]:has-text("Share")',
        ],
        timeout_ms=int(timeout_s * 1000 * 0.8),
    )
    logger.info("[facebook] 게시 버튼 클릭, 처리 완료 대기 중...")

    # 게시 후 작성 화면이 닫히거나 피드로 이동할 때까지 대기
    deadline_ms = 120000
    try:
        page.wait_for_url(lambda url: "reels/create" not in url, timeout=deadline_ms)
    except Exception:
        # URL이 안 바뀌는 UI도 있으므로 에러 표시가 없으면 성공으로 간주
        if page.locator(':text("문제가 발생했습니다"), :text("Something went wrong")').count():
            raise UploadError("페이스북 게시 중 오류 메시지가 표시되었습니다.")
    page.wait_for_timeout(5000)
    logger.info("[facebook] 업로드 완료")
