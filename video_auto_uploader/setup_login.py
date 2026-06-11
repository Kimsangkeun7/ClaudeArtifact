# -*- coding: utf-8 -*-
"""최초 1회 로그인 설정 스크립트 (계정 그룹 × 플랫폼별).

각 계정 그룹(예: 심리1, 심리2)의 플랫폼별 브라우저 창을 차례로 열어 줍니다.
창에서 해당 채널 계정으로 직접 로그인한 뒤 콘솔로 돌아와 Enter를 누르면
로그인 세션이 browser_profiles/<계정>/<플랫폼>/ 에 저장되고,
이후 main.py 실행 시 자동으로 로그인된 상태로 업로드가 진행됩니다.

사용법:
    python setup_login.py                  # 모든 계정 × 켜진 플랫폼 전부
    python setup_login.py 심리2            # 심리2 계정의 모든 플랫폼
    python setup_login.py 심리2 tiktok     # 심리2 계정의 틱톡만
"""

import sys

from uploader.common import (account_platforms, get_accounts, load_config,
                             open_page, platform_settings, setup_logger)
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
    accounts = get_accounts(cfg)
    if not accounts:
        print("config.json에 등록된 계정(accounts)이 없습니다.")
        return

    args = sys.argv[1:]
    if args:
        account_name = args[0]
        if account_name not in accounts:
            print(f"'{account_name}'은(는) 등록된 계정이 아닙니다. "
                  f"(등록된 계정: {', '.join(accounts)})")
            return
        platforms = [p for p in args[1:] if p in LOGIN_PAGES] or \
            account_platforms(cfg, account_name)
        targets = [(account_name, p) for p in platforms]
    else:
        targets = [
            (name, p)
            for name in accounts
            for p in account_platforms(cfg, name)
            if p in LOGIN_PAGES
        ]

    if not targets:
        print("로그인 설정할 대상이 없습니다. config.json의 accounts를 확인하세요.")
        return

    print("로그인 설정 대상:")
    for name, p in targets:
        desc = accounts[name].get("description", "")
        print(f"  - {name} / {p}" + (f"  ({desc})" if desc else ""))

    for name, p in targets:
        url, module = LOGIN_PAGES[p]
        mobile = bool(platform_settings(cfg, p).get("mobile_emulation"))
        desc = accounts[name].get("description", "")
        print(f"\n=== [{name} / {p}] 로그인 설정 ===")
        if desc:
            print(f"채널 설명: {desc}")
        print(f"브라우저 창이 열리면 '{name}' 채널용 {p} 계정으로 직접 로그인하세요.")
        with open_page(name, p, cfg, mobile=mobile) as page:
            page.goto(url, wait_until="domcontentloaded")
            input(f"[{name} / {p}] 로그인을 마쳤으면 Enter를 누르세요... ")
            try:
                ok = module.check_login(page)
            except Exception:
                ok = False
            if ok:
                logger.info("[%s/%s] 로그인 세션 저장 완료", name, p)
            else:
                logger.warning("[%s/%s] 로그인 상태를 확인하지 못했습니다. "
                               "다시 실행해 보세요.", name, p)

    print("\n로그인 설정이 끝났습니다. 이제 `python main.py`로 자동 업로드를 시작하세요.")


if __name__ == "__main__":
    main()
