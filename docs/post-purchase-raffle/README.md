# 구매 후 뽑기(랜덤 사은품) 시나리오 — 평가 및 검증

2026-08-11

## 한 줄 결론

원안은 기각. **"모아서 받기" 삭제 + 거절 대신 포인트 전환 + 임계값 상향**의 축소안으로
재설계하고, Gate 0(동봉 가능률) 통과 시에만 진행. 런칭은 물류센터 이전 안정화 이후.

## 문서

| 파일 | 내용 |
|---|---|
| [`00-scenario-review.md`](00-scenario-review.md) | 시나리오 평가 — P0/P1/P2 결함, 재설계 권고안 |
| [`01-validation-plan.md`](01-validation-plan.md) | 검증 플랜 — 6개 게이트, 사전등록 통과기준, 타임라인 |
| [`queries/00-schema-discovery.sql`](queries/00-schema-discovery.sql) | **먼저 실행** — 주문 테이블 스키마 확인 |
| [`queries/01-gate0-attach-rate.sql`](queries/01-gate0-attach-rate.sql) | Gate 0 — 동봉 가능률 (KILL GATE) |
| [`queries/02-gate1-model-inputs.sql`](queries/02-gate1-model-inputs.sql) | Gate 1 — 모델 입력값 실측 |
| [`../../tools/raffle_model.py`](../../tools/raffle_model.py) | 비용 모델 (실행: `python3 tools/raffle_model.py`) |

## 핵심 숫자

- 사은품 1개 전달 비용: **동봉 1,600원 vs 모아서 별도배송 7,040원** (원가 500원 기준)
- 원안 월 총비용 **2,220만원**, 손익분기 필요 주문 상승률 **16.1%**
- 동봉 전용 설계 시 월 **1,191만원** (▼46%), 손익분기 **8.6%**
- 파라미터 조합 192개 중 **134개(70%)가 월 3,000만원 초과** (= 물류센터 월차임 수준)
- 재주문율 20~45% 구간에서 발급의 **30~44%가 미전달** → "꽝 없음" 표기 리스크

## 주의

`tools/raffle_model.py`의 다음 값은 **가정치**입니다. Gate 1 실측 후 교체하고 재실행해야
위 숫자가 유효합니다: 택배단가 2,500원, 기여이익률 25%, AOV 35,000원, 2만원 이상 비중
50%, 재주문율 45%, 거절률 15%, 모아받기 선택률 35%.

확정 근거는 물류대행 단가표(2025년, 부가세 별도)와 물류센터 이전 일정뿐입니다.
