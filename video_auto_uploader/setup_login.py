# -*- coding: utf-8 -*-
"""최초 1회 로그인 설정 스크립트.

각 플랫폼의 브라우저 창을 차례로 열어 줍니다. 창에서 직접 로그인한 뒤
콘솔로 돌아와 Enter를 누르면 로그인 세션이 플랫폼별 프로필에 저장되고,
이후 main.py 실행 시 자동으로 로그인된 상태로 업로드가 진행됩니다.

사용법:
    python setup_login.py             # 활성화된 모든 플랫폼
    python setup_login.py tiktok      # 특정 플랫폼만
"""

import sys

from uploader.common import load_config, open_page, setup_logger
from uploader.platforms import facebook, instagram, naver_clip, tiktok

LOGIN_PAGES = {
    "facebook": ("https://www.facebook.com/", facebook),
    "instagram": ("https://www.instagram.com/", instagram),
    "tiktok": ("https://www.tiktok.com/login", tiktok),
    "naver_clip": ("https://nid.naver.com/nidlogin.login", naver_clip),
}


def main():
    cfg = load_config()
    logger = setup_logger()

    if len(sys.argv) > 1:
        targets = [t for t in sys.argv[1:] if t in LOGIN_PAGES]
    else:
        targets = [
            name for name, pcfg in cfg.get("platforms", {}).items()
            if pcfg.get("enabled") and name in LOGIN_PAGES
        ]

    if not targets:
        print("설정할 플랫폼이 없습니다. config.json의 enabled 값을 확인하세요.")
        return

    for name in targets:
        url, module = LOGIN_PAGES[name]
        mobile = bool(cfg["platforms"].get(name, {}).get("mobile_emulation"))
        print(f"\n=== [{name}] 로그인 설정 ===")
        print("브라우저 창이 열리면 직접 로그인하세요.")
        with open_page(name, cfg, mobile=mobile) as page:
            page.goto(url, wait_until="domcontentloaded")
            input(f"[{name}] 로그인을 마쳤으면 Enter를 누르세요... ")
            try:
                ok = module.check_login(page)
            except Exception:
                ok = False
            if ok:
                logger.info("[%s] 로그인 세션 저장 완료", name)
            else:
                logger.warning("[%s] 로그인 상태를 확인하지 못했습니다. "
                               "다시 실행해 보세요.", name)

    print("\n로그인 설정이 끝났습니다. 이제 `python main.py`로 자동 업로드를 시작하세요.")


if __name__ == "__main__":
    main()
