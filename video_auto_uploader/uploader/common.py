# -*- coding: utf-8 -*-
"""공용 유틸리티: 설정/메타데이터/상태 관리, Playwright 헬퍼."""

import json
import logging
import re
import time
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_DIR = Path(__file__).resolve().parent.parent
LOG_DIR = BASE_DIR / "logs"
STATE_FILE = BASE_DIR / "upload_state.json"


class NotLoggedInError(Exception):
    """저장된 브라우저 프로필에 로그인 세션이 없을 때 발생."""


class UploadError(Exception):
    """업로드 절차 중 실패했을 때 발생."""


# ---------------------------------------------------------------- 설정/로깅

def load_config(path: Path | None = None) -> dict:
    cfg_path = path or (BASE_DIR / "config.json")
    with open(cfg_path, encoding="utf-8") as f:
        return json.load(f)


def save_config(cfg: dict, path: Path | None = None) -> None:
    cfg_path = path or (BASE_DIR / "config.json")
    with open(cfg_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def has_browser_session(account: str, platform: str, cfg: dict) -> bool:
    """저장된 로그인 세션(영구 프로필)이 있는지 대략적으로 판단한다."""
    bcfg = cfg.get("browser", {})
    profile_dir = (BASE_DIR / bcfg.get("profiles_dir", "browser_profiles")
                   / account / platform)
    # 로그인하면 Default/Cookies 등 파일이 생긴다. 폴더에 내용이 있으면 세션 있다고 본다.
    return profile_dir.exists() and any(profile_dir.iterdir())


def setup_logger() -> logging.Logger:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("uploader")
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
    fh = logging.FileHandler(LOG_DIR / "uploader.log", encoding="utf-8")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    logger.addHandler(fh)
    logger.addHandler(sh)
    return logger


# ---------------------------------------------------------------- 메타데이터

_ACCOUNT_LINE = re.compile(r"^\s*(계정|account)\s*[:=]\s*(.+?)\s*$", re.IGNORECASE)


def load_metadata(video_path: Path) -> dict:
    """영상 옆의 같은 이름 .json 또는 .txt에서 제목/설명/해시태그/계정을 읽는다.

    .json 형식: {"account": "심리2", "title": "...", "description": "...",
                 "hashtags": ["태그1", ...]}  (account 대신 "계정"도 가능)
    .txt 형식: `계정: 심리2` 줄(위치 무관, 선택)을 빼고 나면
               첫 줄 = 제목, 둘째 줄부터 = 설명(해시태그 포함 가능)
    사이드카 파일이 없으면 파일명(확장자 제외)을 제목으로 사용한다.
    account가 비어 있으면 폴더 위치/기본 계정으로 결정된다(main.py 참고).
    """
    meta = {"title": video_path.stem, "description": "", "hashtags": [],
            "account": None}

    json_path = video_path.with_suffix(".json")
    txt_path = video_path.with_suffix(".txt")

    if json_path.exists():
        with open(json_path, encoding="utf-8") as f:
            data = json.load(f)
        meta["title"] = data.get("title") or meta["title"]
        meta["description"] = data.get("description", "")
        meta["hashtags"] = data.get("hashtags", [])
        meta["account"] = data.get("account") or data.get("계정")
    elif txt_path.exists():
        lines = []
        for line in txt_path.read_text(encoding="utf-8").splitlines():
            m = _ACCOUNT_LINE.match(line)
            if m and meta["account"] is None:
                meta["account"] = m.group(2)
            else:
                lines.append(line)
        if lines:
            meta["title"] = lines[0].strip() or meta["title"]
            meta["description"] = "\n".join(lines[1:]).strip()

    return meta


def build_caption(meta: dict, max_len: int = 0) -> str:
    """제목 + 설명 + 해시태그를 합쳐 플랫폼 캡션 문자열을 만든다."""
    parts = [meta["title"]]
    if meta["description"]:
        parts.append(meta["description"])
    if meta["hashtags"]:
        tags = " ".join(
            t if t.startswith("#") else f"#{t}" for t in meta["hashtags"]
        )
        parts.append(tags)
    caption = "\n\n".join(parts)
    if max_len and len(caption) > max_len:
        caption = caption[: max_len - 1].rstrip() + "…"
    return caption


def sidecar_files(video_path: Path) -> list[Path]:
    """영상과 함께 이동시켜야 할 사이드카 파일 목록."""
    return [
        p for p in (video_path.with_suffix(".json"), video_path.with_suffix(".txt"))
        if p.exists()
    ]


# ---------------------------------------------------------------- 상태 관리

def load_state() -> dict:
    if STATE_FILE.exists():
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_state(state: dict) -> None:
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------- 브라우저

def get_accounts(cfg: dict) -> dict:
    """등록된 계정 그룹 목록을 돌려준다. {이름: {description, platforms}}"""
    return cfg.get("accounts", {})


def account_platforms(cfg: dict, account: str) -> list[str]:
    """해당 계정 그룹에서 켜져 있는 플랫폼 이름 목록."""
    acc = get_accounts(cfg).get(account, {})
    return [name for name, on in acc.get("platforms", {}).items() if on]


def platform_settings(cfg: dict, platform: str) -> dict:
    return cfg.get("platform_settings", {}).get(platform, {})


@contextmanager
def open_page(account: str, platform: str, cfg: dict, mobile: bool = False):
    """계정×플랫폼별 영구 프로필로 브라우저를 열어 page를 돌려준다.

    프로필을 계정 그룹 × 플랫폼 단위로 분리해 두면(예: 심리2/tiktok)
    같은 플랫폼의 여러 계정 로그인이 서로 섞이지 않고,
    한 번 로그인하면 이후 실행에서 세션이 유지된다.
    """
    bcfg = cfg.get("browser", {})
    profile_dir = (BASE_DIR / bcfg.get("profiles_dir", "browser_profiles")
                   / account / platform)
    profile_dir.mkdir(parents=True, exist_ok=True)

    launch_kwargs = {
        "user_data_dir": str(profile_dir),
        "headless": bcfg.get("headless", False),
        "slow_mo": bcfg.get("slow_mo_ms", 0),
        "locale": bcfg.get("locale", "ko-KR"),
        "args": ["--disable-blink-features=AutomationControlled"],
        "viewport": {"width": 1280, "height": 900},
    }
    if mobile:
        launch_kwargs["viewport"] = {"width": 390, "height": 844}
        launch_kwargs["user_agent"] = (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        )
        launch_kwargs["is_mobile"] = True
        launch_kwargs["has_touch"] = True
    channel = bcfg.get("channel")
    if channel:
        launch_kwargs["channel"] = channel

    with sync_playwright() as p:
        try:
            ctx = p.chromium.launch_persistent_context(**launch_kwargs)
        except Exception:
            # 시스템 Chrome(channel)이 없으면 내장 Chromium으로 재시도
            launch_kwargs.pop("channel", None)
            ctx = p.chromium.launch_persistent_context(**launch_kwargs)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            yield page
        finally:
            ctx.close()


# ---------------------------------------------------------------- 페이지 헬퍼

def wait_any(page, selectors: list[str], timeout_ms: int = 30000,
             require_visible: bool = True):
    """여러 셀렉터 중 먼저 나타나는 요소를 돌려준다. (한국어/영어 UI 대응)"""
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        for sel in selectors:
            try:
                loc = page.locator(sel).first
                if loc.count() == 0:
                    continue
                if not require_visible or loc.is_visible():
                    return loc
            except Exception:
                continue
        page.wait_for_timeout(500)
    raise UploadError(f"요소를 찾지 못했습니다: {selectors}")


def click_any(page, selectors: list[str], timeout_ms: int = 30000):
    loc = wait_any(page, selectors, timeout_ms)
    loc.click()
    return loc


def try_click(page, selectors: list[str], timeout_ms: int = 4000) -> bool:
    """있으면 클릭, 없으면 조용히 넘어간다(선택적 팝업 처리용)."""
    try:
        click_any(page, selectors, timeout_ms)
        return True
    except UploadError:
        return False


def type_caption(page, locator, caption: str):
    """contenteditable 입력창의 기존 내용을 지우고 캡션을 입력한다."""
    locator.click()
    page.keyboard.press("Control+a")
    page.keyboard.press("Delete")
    page.keyboard.insert_text(caption)
    page.wait_for_timeout(500)


def save_failure_screenshot(page, platform: str, logger) -> None:
    try:
        shot_dir = LOG_DIR / "screenshots"
        shot_dir.mkdir(parents=True, exist_ok=True)
        path = shot_dir / f"{platform}_{time.strftime('%Y%m%d_%H%M%S')}.png"
        page.screenshot(path=str(path), full_page=False)
        logger.info("실패 시점 스크린샷 저장: %s", path)
    except Exception:
        pass
