# -*- coding: utf-8 -*-
"""브라우저 설정 화면.

채널(계정 그룹)을 등록하고, 각 채널의 플랫폼별 아이디/비밀번호를 입력·저장하는
로컬 웹 인터페이스입니다. 비밀번호는 암호화(Fernet)되어 credentials.enc 에 저장됩니다.

실행:
    python webui/app.py
    → 브라우저에서 http://127.0.0.1:5000 접속
"""

import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from flask import (Flask, flash, redirect, render_template, request,  # noqa: E402
                   url_for)

from uploader import credentials  # noqa: E402
from uploader.common import (account_platforms, get_accounts,  # noqa: E402
                             has_browser_session, load_config, save_config)

PLATFORMS = [
    ("facebook", "페이스북 릴스"),
    ("instagram", "인스타그램 릴스"),
    ("tiktok", "틱톡"),
    ("naver_clip", "네이버 클립 (실험적)"),
]

app = Flask(__name__)
app.secret_key = "video-uploader-local-ui"  # 로컬 전용 세션/flash 용도


def build_view():
    cfg = load_config()
    accounts = get_accounts(cfg)
    crypto_ok = credentials.Fernet is not None
    rows = []
    for name, acc in accounts.items():
        platforms = []
        for pid, label in PLATFORMS:
            enabled = bool(acc.get("platforms", {}).get(pid))
            creds = credentials.get_credentials(name, pid) if crypto_ok else None
            platforms.append({
                "id": pid,
                "label": label,
                "enabled": enabled,
                "has_creds": bool(creds and creds.get("username")),
                "username": (creds or {}).get("username", ""),
                "has_session": has_browser_session(name, pid, cfg),
            })
        rows.append({
            "name": name,
            "description": acc.get("description", ""),
            "platforms": platforms,
            "is_default": name == cfg.get("default_account"),
        })
    return cfg, rows, crypto_ok


@app.route("/")
def index():
    cfg, rows, crypto_ok = build_view()
    return render_template(
        "index.html",
        rows=rows,
        all_platforms=PLATFORMS,
        default_account=cfg.get("default_account", ""),
        crypto_ok=crypto_ok,
        settings={
            "watch_folder": cfg.get("watch_folder", ""),
            "check_interval_seconds": cfg.get("check_interval_seconds", 300),
            "headless": cfg.get("browser", {}).get("headless", False),
        },
    )


@app.route("/account/save", methods=["POST"])
def account_save():
    cfg = load_config()
    name = (request.form.get("name") or "").strip()
    old_name = (request.form.get("old_name") or "").strip()
    if not name:
        flash("채널 이름을 입력하세요.", "error")
        return redirect(url_for("index"))

    accounts = cfg.setdefault("accounts", {})
    selected = set(request.form.getlist("platforms"))
    platforms = {pid: (pid in selected) for pid, _ in PLATFORMS}
    entry = {
        "description": (request.form.get("description") or "").strip(),
        "platforms": platforms,
    }

    if old_name and old_name in accounts and old_name != name:
        accounts.pop(old_name)  # 이름 변경
        # 자격증명/기본계정 이름도 따라 옮긴다
        for pid, _ in PLATFORMS:
            c = credentials.get_credentials(old_name, pid)
            if c:
                credentials.set_credentials(name, pid,
                                            c.get("username", ""),
                                            c.get("password", ""))
                credentials.delete_credentials(old_name, pid)
        if cfg.get("default_account") == old_name:
            cfg["default_account"] = name
    accounts[name] = entry
    if not cfg.get("default_account"):
        cfg["default_account"] = name
    save_config(cfg)
    flash(f"채널 '{name}'을(를) 저장했습니다.", "ok")
    return redirect(url_for("index"))


@app.route("/account/delete", methods=["POST"])
def account_delete():
    cfg = load_config()
    name = (request.form.get("name") or "").strip()
    if name in cfg.get("accounts", {}):
        cfg["accounts"].pop(name)
        if cfg.get("default_account") == name:
            cfg["default_account"] = next(iter(cfg["accounts"]), "")
        save_config(cfg)
        try:
            credentials.delete_credentials(name)
        except Exception:
            pass
        flash(f"채널 '{name}'을(를) 삭제했습니다. (저장된 로그인 세션 폴더는 수동 삭제)", "ok")
    return redirect(url_for("index"))


@app.route("/account/default", methods=["POST"])
def account_default():
    cfg = load_config()
    name = (request.form.get("name") or "").strip()
    if name in cfg.get("accounts", {}):
        cfg["default_account"] = name
        save_config(cfg)
        flash(f"기본 채널을 '{name}'(으)로 설정했습니다.", "ok")
    return redirect(url_for("index"))


@app.route("/credentials/save", methods=["POST"])
def credentials_save():
    account = (request.form.get("account") or "").strip()
    platform = (request.form.get("platform") or "").strip()
    username = (request.form.get("username") or "").strip()
    password = request.form.get("password") or ""
    if not (account and platform and username and password):
        flash("아이디와 비밀번호를 모두 입력하세요.", "error")
        return redirect(url_for("index"))
    try:
        credentials.set_credentials(account, platform, username, password)
        flash(f"[{account} / {platform}] 로그인 정보를 암호화 저장했습니다.", "ok")
    except credentials.CredentialsLocked as e:
        flash(str(e), "error")
    return redirect(url_for("index"))


@app.route("/credentials/delete", methods=["POST"])
def credentials_delete():
    account = (request.form.get("account") or "").strip()
    platform = (request.form.get("platform") or "").strip()
    try:
        credentials.delete_credentials(account, platform)
        flash(f"[{account} / {platform}] 저장된 로그인 정보를 삭제했습니다.", "ok")
    except Exception:
        pass
    return redirect(url_for("index"))


@app.route("/login/manual", methods=["POST"])
def login_manual():
    """브라우저 창을 띄워 직접 로그인하도록 setup_login.py 를 실행한다."""
    account = (request.form.get("account") or "").strip()
    platform = (request.form.get("platform") or "").strip()
    try:
        subprocess.Popen([sys.executable, str(BASE_DIR / "setup_login.py"),
                          account, platform], cwd=str(BASE_DIR))
        flash(f"[{account} / {platform}] 로그인용 브라우저 창을 띄웠습니다. "
              "창에서 로그인 후 그 콘솔에서 Enter를 누르세요.", "ok")
    except Exception as e:
        flash(f"브라우저 실행 실패: {e}", "error")
    return redirect(url_for("index"))


@app.route("/settings/save", methods=["POST"])
def settings_save():
    cfg = load_config()
    cfg["watch_folder"] = (request.form.get("watch_folder")
                           or cfg.get("watch_folder"))
    try:
        cfg["check_interval_seconds"] = int(request.form.get("check_interval_seconds"))
    except (TypeError, ValueError):
        pass
    cfg.setdefault("browser", {})["headless"] = bool(request.form.get("headless"))
    save_config(cfg)
    flash("실행 설정을 저장했습니다.", "ok")
    return redirect(url_for("index"))


def main():
    print("설정 화면을 엽니다 →  http://127.0.0.1:5000")
    print("종료하려면 이 창에서 Ctrl+C 를 누르세요.")
    app.run(host="127.0.0.1", port=5000, debug=False)


if __name__ == "__main__":
    main()
