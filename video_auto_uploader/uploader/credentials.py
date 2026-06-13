# -*- coding: utf-8 -*-
"""계정 자격증명(아이디/비밀번호) 암호화 저장.

웹 설정 화면에서 입력한 채널별 아이디/비밀번호를 평문이 아니라
Fernet(AES) 대칭키로 암호화해서 credentials.enc 에 저장한다.
암호화 키는 secret.key 파일에 보관하며, 두 파일 모두 .gitignore 로
저장소에 올라가지 않게 막아 두었다.

보안 메모:
- secret.key 가 곧 비밀번호 금고의 열쇠다. 이 PC를 신뢰할 수 있는 사람만
  접근하도록 폴더 권한을 관리하고, secret.key / credentials.enc 는 절대
  공유하거나 커밋하지 말 것.
- 더 강한 보호가 필요하면 마스터 비밀번호 방식으로 확장할 수 있다.
"""

import json
import os
import stat
from pathlib import Path

try:
    from cryptography.fernet import Fernet
except ImportError:  # 설치 안내를 위해 지연 처리
    Fernet = None

BASE_DIR = Path(__file__).resolve().parent.parent
KEY_FILE = BASE_DIR / "secret.key"
CRED_FILE = BASE_DIR / "credentials.enc"


class CredentialsLocked(Exception):
    """cryptography 미설치 등으로 자격증명을 다룰 수 없을 때."""


def _require_crypto():
    if Fernet is None:
        raise CredentialsLocked(
            "cryptography 패키지가 필요합니다. `pip install -r requirements.txt` 후 다시 시도하세요."
        )


def _restrict(path: Path) -> None:
    """소유자만 읽고 쓰도록 파일 권한을 제한한다(가능한 OS에서)."""
    try:
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass


def _get_key() -> bytes:
    _require_crypto()
    if KEY_FILE.exists():
        return KEY_FILE.read_bytes()
    key = Fernet.generate_key()
    KEY_FILE.write_bytes(key)
    _restrict(KEY_FILE)
    return key


def load_credentials() -> dict:
    """전체 자격증명을 {계정: {플랫폼: {username, password}}} 형태로 반환."""
    if not CRED_FILE.exists():
        return {}
    _require_crypto()
    try:
        plain = Fernet(_get_key()).decrypt(CRED_FILE.read_bytes())
        return json.loads(plain.decode("utf-8"))
    except Exception:
        # 키가 바뀌었거나 파일이 손상된 경우
        return {}


def save_credentials(data: dict) -> None:
    _require_crypto()
    token = Fernet(_get_key()).encrypt(
        json.dumps(data, ensure_ascii=False).encode("utf-8")
    )
    CRED_FILE.write_bytes(token)
    _restrict(CRED_FILE)


def get_credentials(account: str, platform: str) -> dict | None:
    return load_credentials().get(account, {}).get(platform)


def set_credentials(account: str, platform: str, username: str,
                    password: str) -> None:
    data = load_credentials()
    data.setdefault(account, {})[platform] = {
        "username": username,
        "password": password,
    }
    save_credentials(data)


def delete_credentials(account: str, platform: str | None = None) -> None:
    data = load_credentials()
    if account not in data:
        return
    if platform:
        data[account].pop(platform, None)
        if not data[account]:
            data.pop(account, None)
    else:
        data.pop(account, None)
    save_credentials(data)


def has_credentials(account: str, platform: str) -> bool:
    c = get_credentials(account, platform)
    return bool(c and c.get("username") and c.get("password"))
