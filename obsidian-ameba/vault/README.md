# 영어 튜터 지식 베이스 (Vault)

이 볼트는 1:1 영어 교육 튜터의 실제 수업 기록을 시뮬레이션한 샘플 데이터입니다. "아메바 시스템"이 학생의 특성을 시간에 따라 수렴(convergence)하고 분기(divergence)하는 것을 테스트하기 위해 만들어졌습니다.

## 구성

- `students/` — 학생 3명의 수업 노트
  - `Jiwon Park/` — 중급 성인, 비즈니스 영어 목표 (세션 6개)
  - `Minseo Lee/` — 십대, 시험/문법 중심 (세션 6개)
  - `Daniel Cho/` — 고급, 유창성/발음 + 관용표현 (세션 6개)
- `concepts/` — 문법/발음 개념 참고 노트 (위키링크로 상호 연결)

## 노트 형식

각 세션 노트는 YAML frontmatter로 시작합니다: `student`, `session`, `date`, `category`, `tags`, `strength`. `strength`는 해당 관찰이 얼마나 강하게 성립하는지를 나타내는 0.0~1.0 실수값입니다.

## 아메바 동작 메모

- **수렴 예시**: Jiwon의 초기 시제 실수(현재완료, 과거시제 혼동)가 후반 세션에서 하나의 "tense-aspect" 패턴으로 요약됩니다.
- **분기 예시**: Daniel의 초기 "발음 문제" 노트가 후반에 [[th-sound]]와 [[r-l-distinction]]으로 분리됩니다.
