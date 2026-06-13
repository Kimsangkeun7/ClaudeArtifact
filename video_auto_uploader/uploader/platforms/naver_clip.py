# -*- coding: utf-8 -*-
"""네이버 클립 업로드 (실험적 모듈, 기본 비활성).

⚠ 네이버 클립은 현재 PC 웹 업로드를 공식 지원하지 않습니다(모바일 앱 전용).
이 모듈은 네이버가 웹 업로드를 지원하게 될 경우를 대비해 config.json의
platforms.naver_clip 항목(upload_url, selectors)만 고쳐서 쓸 수 있도록
범용 흐름(파일 선택 → 제목/설명 입력 → 등록 클릭)으로 만들어 두었습니다.
"""

from pathlib import Path

from ..common import NotLoggedInError, UploadError, click_any, wait_any

LOGIN_HINT = "nid.naver.com"


def check_login(page) -> bool:
    page.goto("https://m.naver.com", wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    return LOGIN_HINT not in page.url


def login(page, username: str, password: str, logger) -> None:
    """저장된 아이디/비밀번호로 자동 로그인 시도.

    ⚠ 네이버는 자동 입력을 강하게 차단(기기 등록/캡차)합니다. 자동 로그인이
    막히면 설정 화면의 '직접 로그인'을 이용하세요.
    """
    page.goto("https://nid.naver.com/nidlogin.login",
              wait_until="domcontentloaded")
    page.wait_for_timeout(2000)
    try:
        page.fill("#id", username)
        page.fill("#pw", password)
        click_any(page, ['button[type="submit"]', '.btn_login', "#log\\.login"],
                  15000)
    except Exception as e:
        logger.warning("[naver_clip] 로그인 폼 입력 실패(차단/화면 변경 가능): %s", e)
    page.wait_for_timeout(6000)


def ensure_logged_in(page, creds, logger) -> None:
    if check_login(page):
        return
    if creds and creds.get("username") and creds.get("password"):
        logger.info("[naver_clip] 세션 없음 → 저장된 계정으로 자동 로그인 시도")
        login(page, creds["username"], creds["password"], logger)
        if check_login(page):
            logger.info("[naver_clip] 자동 로그인 성공")
            return
    raise NotLoggedInError(
        "네이버 로그인이 필요합니다. 자동 로그인이 자주 차단되니 설정 화면에서 "
        "'직접 로그인'을 권장합니다.")


def upload(page, video_path: Path, meta: dict, logger, timeout_s: int = 600,
           platform_cfg: dict | None = None):
    if not platform_cfg:
        raise UploadError("naver_clip 설정(platform_cfg)이 없습니다.")
    sel = platform_cfg.get("selectors", {})
    url = platform_cfg.get("upload_url")
    if not url:
        raise UploadError("config.json에 naver_clip.upload_url이 설정되어 있지 않습니다.")

    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    if LOGIN_HINT in page.url:
        raise NotLoggedInError("네이버 로그인이 필요합니다. setup_login.py를 먼저 실행하세요.")

    file_input = wait_any(
        page, sel.get("file_input", ['input[type="file"]']),
        timeout_ms=30000, require_visible=False,
    )
    file_input.set_input_files(str(video_path))
    logger.info("[naver_clip] 영상 파일 선택 완료")

    if sel.get("title_input"):
        try:
            title_box = wait_any(page, sel["title_input"], timeout_ms=15000)
            title_box.fill(meta["title"])
        except UploadError:
            logger.warning("[naver_clip] 제목 입력란을 찾지 못해 건너뜁니다.")

    if sel.get("description_input") and meta.get("description"):
        try:
            desc_box = wait_any(page, sel["description_input"], timeout_ms=10000)
            desc_box.fill(meta["description"])
        except UploadError:
            logger.warning("[naver_clip] 설명 입력란을 찾지 못해 건너뜁니다.")

    click_any(page, sel.get("submit_button", ['button:has-text("올리기")']),
              timeout_ms=int(timeout_s * 1000 * 0.5))
    page.wait_for_timeout(10000)
    logger.info("[naver_clip] 등록 버튼 클릭 완료 (결과는 직접 확인 필요)")
