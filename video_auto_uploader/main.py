# -*- coding: utf-8 -*-
"""영상 멀티플랫폼 자동 업로더.

지정한 폴더(watch_folder)를 주기적으로 검사해서 새 영상이 있으면
페이스북 릴스 / 인스타그램 릴스 / 틱톡 (+옵션: 네이버 클립)에 차례로 업로드한다.

사용법:
    python main.py            # 무한 감시 루프 (check_interval_seconds 간격)
    python main.py --once     # 한 번만 검사하고 종료 (작업 스케줄러용)
"""

import argparse
import shutil
import time
from pathlib import Path

from uploader import common
from uploader.common import (BASE_DIR, NotLoggedInError, load_config,
                             load_metadata, load_state, open_page, save_state,
                             save_failure_screenshot, setup_logger,
                             sidecar_files)
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


def find_stable_videos(watch_dir: Path, cfg, logger) -> list[Path]:
    """복사가 끝난(크기가 더 이상 변하지 않는) 영상만 골라낸다."""
    exts = {e.lower() for e in cfg.get("video_extensions", [".mp4"])}
    candidates = sorted(
        p for p in watch_dir.iterdir()
        if p.is_file() and p.suffix.lower() in exts
    )
    if not candidates:
        return []

    sizes1 = {p: p.stat().st_size for p in candidates}
    time.sleep(cfg.get("file_stable_seconds", 10))
    stable = []
    for p in candidates:
        try:
            if p.stat().st_size == sizes1[p] and sizes1[p] > 0:
                stable.append(p)
            else:
                logger.info("아직 복사 중인 파일이라 다음 주기에 처리: %s", p.name)
        except FileNotFoundError:
            pass
    return stable


def enabled_platforms(cfg) -> list[str]:
    return [
        name for name, pcfg in cfg.get("platforms", {}).items()
        if pcfg.get("enabled") and name in PLATFORM_MODULES
    ]


def upload_to_platform(name: str, video: Path, meta: dict, cfg, logger) -> bool:
    pcfg = cfg["platforms"][name]
    timeout_s = pcfg.get("upload_timeout_seconds", 600)
    mobile = bool(pcfg.get("mobile_emulation"))
    logger.info("[%s] '%s' 업로드 시작", name, video.name)
    try:
        with open_page(name, cfg, mobile=mobile) as page:
            try:
                if name == "naver_clip":
                    PLATFORM_MODULES[name].upload(
                        page, video, meta, logger,
                        timeout_s=timeout_s, platform_cfg=pcfg,
                    )
                else:
                    PLATFORM_MODULES[name].upload(
                        page, video, meta, logger, timeout_s=timeout_s
                    )
                return True
            except Exception:
                save_failure_screenshot(page, name, logger)
                raise
    except NotLoggedInError as e:
        logger.error("[%s] %s", name, e)
    except Exception as e:
        logger.error("[%s] 업로드 실패: %s", name, e)
    return False


def process_video(video: Path, cfg, state: dict, logger, dirs: dict) -> None:
    key = video.name
    entry = state.setdefault(key, {"platforms": {}, "attempts": 0})
    targets = [
        p for p in enabled_platforms(cfg)
        if entry["platforms"].get(p) != "success"
    ]
    if not targets:
        finish_video(video, cfg, state, logger, dirs, success=True)
        return

    meta = load_metadata(video)
    logger.info("'%s' 처리 시작 (제목: %s / 대상: %s)",
                video.name, meta["title"], ", ".join(targets))
    entry["attempts"] += 1

    for name in targets:
        ok = upload_to_platform(name, video, meta, cfg, logger)
        entry["platforms"][name] = "success" if ok else "failed"
        save_state(state)

    remaining = [p for p in enabled_platforms(cfg)
                 if entry["platforms"].get(p) != "success"]
    if not remaining:
        finish_video(video, cfg, state, logger, dirs, success=True)
    elif entry["attempts"] >= cfg.get("max_retries", 3):
        logger.error("'%s' 최대 재시도 횟수 초과. 실패 플랫폼: %s",
                     video.name, ", ".join(remaining))
        finish_video(video, cfg, state, logger, dirs, success=False)
    else:
        logger.warning("'%s' 일부 플랫폼 실패(%s). 다음 주기에 재시도합니다.",
                       video.name, ", ".join(remaining))


def finish_video(video: Path, cfg, state, logger, dirs, success: bool) -> None:
    dest = dirs["done"] if success else dirs["failed"]
    for f in [video, *sidecar_files(video)]:
        target = dest / f.name
        if target.exists():
            target = dest / f"{f.stem}_{int(time.time())}{f.suffix}"
        shutil.move(str(f), str(target))
    state.pop(video.name, None)
    save_state(state)
    if success:
        logger.info("✅ '%s' 모든 플랫폼 업로드 완료 → %s", video.name, dest)
    else:
        logger.error("❌ '%s' 업로드 실패 → %s", video.name, dest)


def run_once(cfg, logger) -> None:
    dirs = {
        "watch": resolve_dir(cfg["watch_folder"]),
        "done": resolve_dir(cfg["done_folder"]),
        "failed": resolve_dir(cfg["failed_folder"]),
    }
    state = load_state()
    videos = find_stable_videos(dirs["watch"], cfg, logger)
    if not videos:
        logger.info("새 영상 없음 (%s)", dirs["watch"])
        return
    for video in videos:
        process_video(video, cfg, state, logger, dirs)


def main():
    parser = argparse.ArgumentParser(description="영상 멀티플랫폼 자동 업로더")
    parser.add_argument("--once", action="store_true",
                        help="한 번만 검사하고 종료 (작업 스케줄러용)")
    parser.add_argument("--config", default=None, help="config.json 경로")
    args = parser.parse_args()

    cfg = load_config(Path(args.config) if args.config else None)
    logger = setup_logger()
    platforms = enabled_platforms(cfg)
    logger.info("=== 자동 업로더 시작 (활성 플랫폼: %s) ===",
                ", ".join(platforms) or "없음")
    if not platforms:
        logger.error("config.json에서 활성화된 플랫폼이 없습니다.")
        return

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
