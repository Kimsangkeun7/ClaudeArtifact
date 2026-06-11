# 영상 멀티플랫폼·멀티계정 자동 업로더

특정 폴더를 주기적으로 감시해서 새 영상(세로 숏폼)이 들어오면
**페이스북 릴스 / 인스타그램 릴스 / 틱톡**에 자동으로 업로드하는 프로그램입니다.

채널(계정 그룹)을 여러 개 운영하는 경우를 지원합니다.
`심리1`, `심리2`처럼 이름과 설명을 붙여 계정 그룹을 등록해 두고,
영상마다 **"심리2에 올려라"** 하고 지정하면 그 그룹에 연결된
플랫폼 계정들로만 업로드됩니다.

브라우저 자동화(Playwright) 방식이라 개발자 앱 등록·API 심사 없이 바로 쓸 수 있습니다.

> **네이버 클립**: 현재 네이버 클립은 PC 웹 업로드를 공식 지원하지 않고
> 모바일 앱(네이버 앱/블로그 앱)에서만 업로드할 수 있습니다.
> 그래서 네이버 클립 모듈은 **실험적 기능(기본 꺼짐)** 으로 포함했습니다.
> 네이버가 PC 업로드를 지원하게 되면 `config.json`의 `platform_settings.naver_clip`에서
> URL과 셀렉터를 고치고 각 계정의 `naver_clip`을 `true`로 켜면 됩니다.
>
> **카카오톡**: 공개 게시용 영상 업로드 API/웹 경로가 없어 요청에 따라 제외했습니다.

---

## 1. 설치 (Windows 기준)

Python 3.10 이상이 설치되어 있어야 합니다.

```bat
cd video_auto_uploader
pip install -r requirements.txt
python -m playwright install chromium
```

PC에 크롬이 설치되어 있으면 자동으로 크롬을 사용합니다(자동화 탐지 회피에 유리).
크롬이 없으면 내장 Chromium으로 자동 전환됩니다.

## 2. 계정 그룹 등록: `config.json`

운영 중인 채널을 `accounts`에 등록합니다. 이름은 자유롭게 붙이면 됩니다.

```json
"default_account": "심리1",
"accounts": {
  "심리1": {
    "description": "심리학 메인 채널",
    "platforms": { "facebook": true, "instagram": true, "tiktok": true, "naver_clip": false }
  },
  "심리2": {
    "description": "심리학 서브 채널 (짧은 명언 위주)",
    "platforms": { "facebook": false, "instagram": true, "tiktok": true, "naver_clip": false }
  }
}
```

- `description`: 채널 설명(메모용 — 로그인 설정 시 어떤 계정인지 보여줍니다)
- `platforms`: 그룹별로 사용할 플랫폼을 켜고 끕니다 (그룹마다 다르게 설정 가능)
- `default_account`: 영상에 계정 지정이 없을 때 올라가는 기본 그룹

그 외 주요 설정:

| 항목 | 설명 | 기본값 |
|---|---|---|
| `watch_folder` | 감시할 폴더 | `videos/inbox` |
| `done_folder` / `failed_folder` | 성공/실패 영상이 이동되는 폴더 (계정별 하위 폴더 생성) | `videos/done` 등 |
| `check_interval_seconds` | 폴더 검사 주기(초) | `300` (5분) |
| `max_retries` | 플랫폼 실패 시 재시도 횟수 | `3` |
| `browser.headless` | `true`면 브라우저 창 숨김 (탐지 위험 ↑, 권장: `false`) | `false` |

`watch_folder`는 절대 경로도 가능합니다. 예: `"D:/Work/업로드대기"`

## 3. 최초 1회: 계정별 로그인

```bat
python setup_login.py                  :: 모든 계정 × 켜진 플랫폼 전부
python setup_login.py 심리2            :: 심리2 계정의 플랫폼만
python setup_login.py 심리2 tiktok     :: 심리2 계정의 틱톡만
```

브라우저 창이 (계정 × 플랫폼)별로 차례로 열립니다. **그 채널용 계정으로 직접 로그인**한 뒤
콘솔에서 Enter를 누르세요. 세션은 `browser_profiles/<계정>/<플랫폼>/`에 저장되어
같은 플랫폼이라도 심리1 틱톡과 심리2 틱톡 로그인이 서로 섞이지 않습니다.

> ⚠ `browser_profiles/` 폴더에는 로그인 세션이 들어 있으니 절대 공유하지 마세요.

## 4. 영상을 어느 계정에 올릴지 지정하기

세 가지 방법이 있고, 우선순위는 ① > ② > ③ 입니다.

**① 사이드카 파일에 적기** — `내영상.txt`:

```
계정: 심리2
오늘의 심리 명언
설명은 여기부터 자유롭게.
#쇼츠 #심리
```

(첫 줄이 아니어도 되며, `계정:` 줄을 빼고 나면 첫 줄=제목, 나머지=설명입니다)

`내영상.json`을 쓰는 경우:

```json
{ "account": "심리2", "title": "오늘의 심리 명언", "description": "설명...", "hashtags": ["쇼츠", "심리"] }
```

**② 계정 이름 폴더에 넣기** — 프로그램이 inbox 안에 계정 이름 폴더를 자동으로 만들어 줍니다:

```
videos/inbox/심리1/   ← 여기 넣으면 심리1로
videos/inbox/심리2/   ← 여기 넣으면 심리2로
```

**③ 아무 지정 없이 inbox에 바로 넣기** → `default_account`로 올라갑니다.

사이드카 파일이 없으면 **파일명(확장자 제외)이 제목**으로 사용됩니다.
사이드카 파일은 영상과 함께 `done/<계정>/` 또는 `failed/<계정>/`으로 이동됩니다.
등록되지 않은 계정 이름을 지정하면 파일을 옮기지 않고 로그에 오류만 남기므로,
config에 계정을 추가하거나 이름을 고치면 다음 주기에 자동으로 처리됩니다.

## 5. 실행

```bat
python main.py          :: 무한 감시 루프 (5분마다 폴더 검사)
python main.py --once   :: 한 번만 검사하고 종료 (작업 스케줄러 등록용)
```

또는 `run_uploader.bat` 더블클릭.

**Windows 작업 스케줄러로 돌리려면**: 트리거를 원하는 주기로 설정하고
동작에 `python <경로>\main.py --once` 를 등록하세요.

### 동작 방식

1. 감시 폴더(+계정 폴더)에서 영상 파일을 찾고, 크기가 변하지 않을 때까지(복사 완료) 기다립니다.
2. 영상별로 계정 그룹을 결정하고, 그 그룹에 켜진 플랫폼에 순서대로 업로드합니다.
3. **모든 플랫폼 성공** → 영상+사이드카를 `done/<계정>/`으로 이동.
4. 일부 실패 → 다음 주기에 **실패한 플랫폼만** 재시도. `max_retries` 초과 시 `failed/<계정>/`로 이동.
5. 진행 상황은 `upload_state.json`에, 로그는 `logs/uploader.log`에 기록되고,
   실패 시 화면 스크린샷이 `logs/screenshots/`에 저장됩니다.

## 6. 네이버 클립 (실험적)

네이버 클립은 PC 웹 업로드 미지원이라 기본 비활성입니다. 대안:

- **현재 가능한 방법**: PC에서 영상을 만들고, 휴대폰 네이버(블로그) 앱에서 업로드.
  감시 폴더를 클라우드(네이버 MYBOX 등)와 동기화해 두면 폰에서 바로 올리기 편합니다.
- 네이버가 PC 업로드를 열면 `config.json`의 `platform_settings.naver_clip`에서
  `upload_url`과 `selectors`(파일 선택/제목/설명/등록 버튼)를 실제 화면에 맞게 수정한 뒤
  각 계정의 `"naver_clip": true`로 변경하세요. 코드는 수정할 필요 없습니다.

## 7. 주의사항 & 문제 해결

- **사이트 개편**: 브라우저 자동화 특성상 플랫폼 화면이 바뀌면 버튼을 못 찾을 수 있습니다.
  이때 `logs/screenshots/`의 스크린샷을 보면 어느 단계에서 멈췄는지 알 수 있습니다.
  셀렉터는 `uploader/platforms/*.py`에 한국어/영어 UI 모두 등록되어 있습니다.
- **자동화 탐지**: 너무 짧은 주기로 대량 업로드하면 계정이 일시 제한될 수 있습니다.
  `headless: false`(창 보이는 모드) + 적당한 업로드 빈도를 권장합니다.
- **로그인 만료**: `python setup_login.py <계정> <플랫폼>`으로 해당 계정만 재로그인하면 됩니다.
- **2단계 인증**: 최초 로그인 시 창에서 직접 인증하면 이후에는 세션이 유지됩니다.
- 영상 규격은 9:16 세로, 페이스북/인스타 릴스는 90초 이내, 네이버 클립은 60초 이내가 안전합니다.

## 파일 구성

```
video_auto_uploader/
├── main.py                 # 메인: 폴더 감시 + 계정 결정 + 업로드 오케스트레이션
├── setup_login.py          # 최초 1회 계정×플랫폼 로그인 설정
├── config.json             # 계정 그룹 등록 및 모든 설정
├── run_uploader.bat        # 더블클릭 실행용
├── uploader/
│   ├── common.py           # 설정/메타데이터/상태/브라우저 공용 코드
│   └── platforms/
│       ├── facebook.py     # 페이스북 릴스
│       ├── instagram.py    # 인스타그램 릴스
│       ├── tiktok.py       # 틱톡 (TikTok Studio)
│       └── naver_clip.py   # 네이버 클립 (실험적)
├── browser_profiles/<계정>/<플랫폼>/   # 로그인 세션 (자동 생성)
└── videos/inbox/<계정>/ | done/<계정>/ | failed/<계정>/
```
