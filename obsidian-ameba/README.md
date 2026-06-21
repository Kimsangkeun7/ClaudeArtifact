# 🧬 Obsidian · Amoeba

**영어 1:1 강사를 위한 진화형 노트 시스템.**
옵시디언 스타일의 마크다운 노트 위에, 학생 데이터가 세대를 거쳐 **수렴(융합)** 하고
**발산(분기)** 하며 진화하는 **아메바 시스템**을 얹었습니다.

> 빌드 도구·설치 없이 동작하는 순수 HTML/CSS/JS 단일 앱입니다.
> `index.html` 만 열면 바로 실행됩니다. (예시 볼트가 자동 탑재되어 있습니다.)

---

## ▶ 실행 방법

가장 간단:

```bash
# 저장소 루트에서
cd obsidian-ameba
python3 -m http.server 8080
# 브라우저에서 http://localhost:8080 접속
```

또는 `index.html` 을 브라우저로 직접 열어도 됩니다. (모든 JS가 클래식 스크립트라 `file://` 에서도 동작)

---

## 🧩 기능

### 옵시디언 베이스
- **마크다운 편집기 + 실시간 미리보기** (분할 / 미리보기 / 편집 모드 토글)
- **위키링크** `[[노트이름]]`, 깨진 링크 표시, 클릭 시 이동·자동 생성
- **백링크** 패널 (이 노트를 가리키는 노트 + 문맥)
- **YAML 프론트매터** 파싱 (`student`, `category`, `tags`, `strength`, `session`, `type`)
- **검색** (제목·본문·태그·학생)
- **그래프 뷰** — 노트(노드) + 위키링크/공유태그(엣지), 학생별 색상, 드래그·줌·클릭 이동
- **localStorage 자동 저장** + `.md` 가져오기 / `.json` 백업·복원

### 아메바 시스템 (핵심 차별점)
각 학생은 살아있는 **아메바**입니다. 노트(관찰)가 세포가 되어 세대를 거치며 진화합니다.

| 단계 | 의미 | 동작 |
|------|------|------|
| **유입 (ingest)** | 세션 관찰이 세포로 들어옴 | 노트 1개 = 세포 1개 |
| **수렴 (converge)** | 비슷한 세포가 하나의 *특질(trait)* 로 융합 | 태그·카테고리 코사인 유사도 기반 응집 클러스터링 |
| **발산 (diverge)** | 과하게 뭉친 특질이 전문화된 하위 특질로 분기 | 공통 태그를 제거하고 하위 구조(2-means) 탐지 → 예: `pronunciation` → `th-sound` ⟂ `r-l-distinction` |
| **도태 (decay)** | 보강 안 된 약한 신호는 강도 감쇠 후 소멸 | 세대마다 strength 감쇠, 큰 클러스터는 보강 |
| **고도화 지수** | 구조가 정제될수록 오르는 "천재 지수" | 수렴률·카테고리 커버리지·평균 강도로 산출 |

→ 우측 패널에 **특질 목록**과 **다음 수업 추천**이 자동 생성됩니다.
→ 타임라인 슬라이더로 진화 과정을 **되감기/재생** 할 수 있습니다.

---

## 🗂 구조

```
obsidian-ameba/
├── index.html            # 앱 셸
├── css/styles.css        # 다크 테마 UI
├── js/
│   ├── markdown.js       # 마크다운 + 프론트매터 + 위키링크 렌더러
│   ├── store.js          # 데이터 모델 + localStorage
│   ├── vault.js          # 링크/백링크/그래프 모델/검색
│   ├── amoeba.js         # ★ 아메바 진화 엔진 (수렴/발산/도태/점수)
│   ├── graph.js          # force-directed 그래프 뷰
│   ├── amoebaView.js     # 아메바 유기체 시각화
│   ├── app.js            # 전체 UI 와이어링
│   └── seed.js           # vault/ 에서 자동 생성된 내장 예시 데이터
├── vault/                # 예시 볼트 (학생 3명 × 세션 6 + 개념 노트 9)
└── tools/
    ├── bundle-seed.js    # vault/ → js/seed.js 재생성
    └── test-engine.js    # 아메바 엔진 헤드리스 테스트
```

### 데이터 포맷 (노트 프론트매터)
```markdown
---
student: Jiwon Park
session: 3
date: 2026-05-12
category: grammar          # grammar|vocabulary|pronunciation|fluency|listening|
                           # writing|confidence|interests|goals|errors
tags: [present-perfect, articles]
strength: 0.7              # 0.0 ~ 1.0 관찰 확신도
---
지원은 압박 상황에서 관사를 자주 누락한다 ...
```

---

## 🔧 개발

```bash
node tools/test-engine.js     # 엔진 동작 검증 (수렴/발산/점수 상승 확인)
node tools/bundle-seed.js      # vault/*.md 를 수정한 뒤 내장 시드 갱신
```

`vault/` 의 마크다운을 고치고 `bundle-seed.js` 를 다시 돌리면 앱 첫 로드 데이터가 갱신됩니다.
(이미 데이터가 있으면 localStorage 가 우선하므로, 새 시드를 보려면 앱의 데이터를 비우거나 다른 브라우저/시크릿창에서 확인)

---

## 📌 설계 메모 / 가정
- **플랫폼**: 일렉트론 데스크톱 대신 **자체 웹 앱**으로 구현(설치·빌드 없이 즉시 실행, 아티팩트 친화적).
- **UI 언어**: 한국어 기본(영어 강사용), 노트 내용은 영어 그대로.
- **진화 결정성**: 엔진은 결정적(deterministic)이며 각 세대를 스냅샷으로 저장해 타임라인 재생이 가능합니다.
