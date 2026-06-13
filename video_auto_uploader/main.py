# -*- coding: utf-8 -*-
"""영상 멀티플랫폼·멀티계정 자동 업로더.

지정한 폴더(watch_folder)를 주기적으로 검사해서 새 영상이 있으면
config.json에 등록된 계정 그룹(예: 심리1, 심리2)의 플랫폼들
(페이스북 릴스 / 인스타그램 릴스 / 틱톡 / 옵션: 네이버 클립)에 차례로 업로드한다.

영상을 올릴 계정 그룹 지정 방법 (우선순위 순):
  1. 사이드카 .txt에 `계정: 심리2` 줄 또는 .json에 "account": "심리2"
  2. 감시 폴더 안의 계정 이름 하위 폴더 (예: videos/inbox/심리2/영상.mp4)
  3. 둘 다 없으면 config.json의 default_account

사용법:
    python main.py            # 무한 감시 루프 (check_interval_seconds 간격)
    python main.py --once     # 한 번만 검사하고 종료 (작업 스케줄러용)
"""

import argparse
import shutil
import time
from pathlib import Path

from uploader.common import (BASE_DIR, NotLoggedInError, account_platforms,
                             get_accounts, load_config, load_metadata,
                             load_state, open_page, platform_settings,
                             save_failure_screenshot, save_state, setup_logger,
                             sidecar_files)
from uploader.credentials import get_credentials
from uploader.platforms import facebook, instagram, naver_clip, tiktok

PLATFORM_MODULES = {
    "facebook": facebook,
    "instagram": instagram,
    "tiktok": tiktok,
    "naver_clip": naver_clip,
}


def resolve_dir(cfg_value: str) -> Path:
    p = Path(cfg_value)
    if not p.is_absolute():
        p = BASE_DIR / p
    p.mkdir(parents=True, exist_ok=True)
    return p


def collect_videos(watch_dir: Path, cfg) -> list[Path]:
    """감시 폴더 바로 아래 + 계정 폴더(1단계 하위) 안의 영상을 모두 찾는다."""
    exts = {e.lower() for e in cfg.get("video_extensions", [".mp4"])}
    found = []
    for p in sorted(watch_dir.iterdir()):
        if p.is_file() and p.suffix.lower() in exts:
            found.append(p)
        elif p.is_dir():
            found.extend(
                f for f in sorted(p.iterdir())
                if f.is_file() and f.suffix.lower() in exts
            )
    return found


def filter_stable(videos: list[Path], cfg, logger) -> list[Path]:
    """복사가 끝난(크기가 더 이상 변하지 않는) 영상만 골라낸다."""
    if not videos:
        return []
    sizes1 = {p: p.stat().st_size for p in videos}
    time.sleep(cfg.get("file_stable_seconds", 10))
    stable = []
    for p in videos:
        try:
            if p.stat().st_size == sizes1[p] and sizes1[p] > 0:
                stable.append(p)
            else:
                logger.info("아직 복사 중인 파일이라 다음 주기에 처리: %s", p.name)
        except FileNotFoundError:
            pass
    return stable


def resolve_account(video: Path, meta: dict, watch_dir: Path, cfg, logger):
    """영상을 올릴 계정 그룹 이름을 결정한다. 잘못된 지정이면 None."""
    accounts = get_accounts(cfg)

    # 1순위: 사이드카 파일에 적힌 계정
    if meta.get("account"):
        name = str(meta["account"]).strip()
        if name in accounts:
            return name
        logger.error("'%s': 사이드카에 적힌 계정 '%s'이(가) config.json의 "
                     "accounts에 없습니다. (등록된 계정: %s)",
                     video.name, name, ", ".join(accounts) or "없음")
        return None

    # 2순위: 계정 이름 폴더 안에 있는 경우
    if video.parent != watch_dir:
        name = video.parent.name
        if name in accounts:
            return name
        logger.error("'%s': 폴더 이름 '%s'이(가) 등록된 계정이 아닙니다. "
                     "(등록된 계정: %s)", video.name, name, ", ".join(accounts))
        return None

    # 3순위: 기본 계정
    name = cfg.get("default_account")
    if name in accounts:
        return name
    logger.error("'%s': default_account('%s')가 accounts에 등록되어 있지 "
                 "않습니다. config.json을 확인하세요.", video.name, name)
    return None


def upload_to_platform(account: str, platform: str, video: Path, meta: dict,
                       cfg, logger) -> bool:
    pcfg = platform_settings(cfg, platform)
    timeout_s = pcfg.get("upload_timeout_seconds", 600)
    mobile = bool(pcfg.get("mobile_emulation"))
    creds = get_credentials(account, platform)
    logger.info("[%s/%s] '%s' 업로드 시작", account, platform, video.name)
    try:
        with open_page(account, platform, cfg, mobile=mobile) as page:
            try:
                # 저장된 세션이 없으면 입력해 둔 아이디/비밀번호로 자동 로그인 시도
                PLATFORM_MODULES[platform].ensure_logged_in(page, creds, logger)
                if platform == "naver_clip":
                    PLATFORM_MODULES[platform].upload(
                        page, video, meta, logger,
                        timeout_s=timeout_s, platform_cfg=pcfg,
                    )
                else:
                    PLATFORM_MODULES[platform].upload(
                        page, video, meta, logger, timeout_s=timeout_s
                    )
                return True
            except Exception:
                save_failure_screenshot(page, f"{account}_{platform}", logger)
                raise
    except NotLoggedInError as e:
        logger.error("[%s/%s] %s (python setup_login.py %s %s)",
                     account, platform, e, account, platform)
    except Exception as e:
        logger.error("[%s/%s] 업로드 실패: %s", account, platform, e)
    return False


def process_video(video: Path, cfg, state: dict, logger, dirs: dict) -> None:
    watch_dir = dirs["watch"]
    meta = load_metadata(video)
    account = resolve_account(video, meta, watch_dir, cfg, logger)
    if account is None:
        return  # 계정 지정 오류는 파일을 건드리지 않고 사용자가 고칠 때까지 대기

    key = str(video.relative_to(watch_dir))
    entry = state.setdefault(key, {"account": account, "platforms": {},
                                   "attempts": 0})
    platforms = account_platforms(cfg, account)
    if not platforms:
        logger.error("'%s': 계정 '%s'에 켜진 플랫폼이 없습니다.", video.name, account)
        return

    targets = [p for p in platforms
               if p in PLATFORM_MODULES
               and entry["platforms"].get(p) != "success"]
    if not targets:
        finish_video(video, key, account, state, logger, dirs, success=True)
        return

    logger.info("'%s' 처리 시작 (계정: %s / 제목: %s / 대상: %s)",
                video.name, account, meta["title"], ", ".join(targets))
    entry["attempts"] += 1

    for platform in targets:
        ok = upload_to_platform(account, platform, video, meta, cfg, logger)
        entry["platforms"][platform] = "success" if ok else "failed"
        save_state(state)

    remaining = [p for p in platforms
                 if entry["platforms"].get(p) != "success"]
    if not remaining:
        finish_video(video, key, account, state, logger, dirs, success=True)
    elif entry["attempts"] >= cfg.get("max_retries", 3):
        logger.error("'%s' 최대 재시도 횟수 초과. 실패 플랫폼: %s",
                     video.name, ", ".join(remaining))
        finish_video(video, key, account, state, logger, dirs, success=False)
    else:
        logger.warning("'%s' 일부 플랫폼 실패(%s). 다음 주기에 재시도합니다.",
                       video.name, ", ".join(remaining))


def finish_video(video: Path, key: str, account: str, state, logger, dirs,
                 success: bool) -> None:
    dest = (dirs["done"] if success else dirs["failed"]) / account
    dest.mkdir(parents=True, exist_ok=True)
    for f in [video, *sidecar_files(video)]:
        target = dest / f.name
        if target.exists():
            target = dest / f"{f.stem}_{int(time.time())}{f.suffix}"
        shutil.move(str(f), str(target))
    state.pop(key, None)
    save_state(state)
    if success:
        logger.info("✅ '%s' [%s] 모든 플랫폼 업로드 완료 → %s",
                    video.name, account, dest)
    else:
        logger.error("❌ '%s' [%s] 업로드 실패 → %s", video.name, account, dest)


def ensure_account_folders(watch_dir: Path, cfg) -> None:
    """등록된 계정 이름으로 inbox 하위 폴더를 만들어 두어 넣기 쉽게 한다."""
    for name in get_accounts(cfg):
        (watch_dir / name).mkdir(parents=True, exist_ok=True)


def run_once(cfg, logger) -> None:
    dirs = {
        "watch": resolve_dir(cfg["watch_folder"]),
        "done": resolve_dir(cfg["done_folder"]),
        "failed": resolve_dir(cfg["failed_folder"]),
    }
    ensure_account_folders(dirs["watch"], cfg)
    state = load_state()
    videos = filter_stable(collect_videos(dirs["watch"], cfg), cfg, logger)
    if not videos:
        logger.info("새 영상 없음 (%s)", dirs["watch"])
        return
    for video in videos:
        process_video(video, cfg, state, logger, dirs)


def main():
    parser = argparse.ArgumentParser(description="영상 멀티플랫폼·멀티계정 자동 업로더")
    parser.add_argument("--once", action="store_true",
                        help="한 번만 검사하고 종료 (작업 스케줄러용)")
    parser.add_argument("--config", default=None, help="config.json 경로")
    args = parser.parse_args()

    cfg = load_config(Path(args.config) if args.config else None)
    logger = setup_logger()

    accounts = get_accounts(cfg)
    if not accounts:
        logger.error("config.json에 등록된 계정(accounts)이 없습니다.")
        return
    summary = ", ".join(
        f"{name}({'/'.join(account_platforms(cfg, name)) or '플랫폼 없음'})"
        for name in accounts
    )
    logger.info("=== 자동 업로더 시작 — 등록된 계정: %s / 기본 계정: %s ===",
                summary, cfg.get("default_account"))

    if args.once:
        run_once(cfg, logger)
        return

    interval = cfg.get("check_interval_seconds", 300)
    while True:
        try:
            run_once(cfg, logger)
        except KeyboardInterrupt:
            logger.info("사용자 중단. 종료합니다.")
            break
        except Exception as e:
            logger.exception("감시 루프 오류: %s", e)
        time.sleep(interval)


if __name__ == "__main__":
    main()
