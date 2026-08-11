#!/usr/bin/env python3
"""
구매 후 뽑기(랜덤 사은품) 시나리오 — 물류/경제성 검증 모델

목적
----
"2만원 이상 구매 시 뽑기 1회, 꽝 없음, 고객이 수령 여부와 수령 방식(다음 주문 동봉 /
모아서 받기)을 선택" 시나리오를 텐바이텐의 **실제 물류대행 단가표**에 태워
(1) 건당·월간 비용, (2) 손익분기 조건, (3) 파괴 구간(failure region)을 산출한다.

근거 데이터 (10x10-company-info 스킬, 2025년 물류대행 단가표 / 부가세 별도)
  - B2C 출고 작업비: 처리량 구간별 BOX당 단가 (아래 SHIPPING_TIERS)
  - 유통가공 정합작업: 세트당 1,000원 (세트/박스 포장, 재포장, 단순조립)
  - 유통가공 상품 바코드: UNIT당 100원
  - 반품 작업비 B2C: BOX당 2,540원
  - 월 처리량: 10,000 ~ 20,000건 (일 평균 300~700건)

가정으로 표시된 값(ASSUMPTION)은 전부 검증 대상이며 민감도 분석으로 다룬다.
실행: python3 tools/raffle_model.py
"""

from itertools import product

WON = "원"


# ---------------------------------------------------------------------------
# 1. 실측 단가 (계약서 기반 — 확정값)
# ---------------------------------------------------------------------------

# (최소 처리건수, BOX당 단가). 내림차순으로 평가.
SHIPPING_TIERS = [
    (50_000, 1_960),
    (45_000, 2_000),
    (40_000, 2_060),
    (35_000, 2_140),
    (30_000, 2_240),
    (25_000, 2_380),
    (20_000, 2_590),
    (0,      2_940),   # 20,000건 미만
]

KITTING_PER_SET = 1_000     # 유통가공 정합작업(사은품 피킹/동봉/재포장) 세트당
BARCODE_PER_UNIT = 100      # 유통가공 상품 바코드 UNIT당
RETURN_B2C_PER_BOX = 2_540  # 반품 작업비 B2C BOX당

# ASSUMPTION: 택배 단가는 계약서에 없음 (별도 택배사 계약). 업계 통상 대량계약가.
COURIER_PER_BOX = 2_500

# ASSUMPTION: 마켓플레이스 위탁 수수료율(기여이익률 근사).
TAKE_RATE = 0.25


def shipping_rate(monthly_boxes: int) -> int:
    """월 처리량에 대응하는 BOX당 출고 작업비."""
    for threshold, rate in SHIPPING_TIERS:
        if monthly_boxes >= threshold:
            return rate
    return SHIPPING_TIERS[-1][1]


def shipping_cost(monthly_boxes: int) -> int:
    """월 출고 작업비 총액 (계단식 단가는 전량에 소급 적용되는 구조)."""
    return monthly_boxes * shipping_rate(monthly_boxes)


# ---------------------------------------------------------------------------
# 2. 수령 방식별 건당 한계비용
# ---------------------------------------------------------------------------

def cost_per_gift(mode: str, gift_cogs: int, monthly_boxes: int,
                  gifts_per_batch: int = 1) -> float:
    """
    사은품 1개를 실제로 고객 손에 전달하는 데 드는 한계비용.

    mode:
      'attach'  — 다음 주문에 동봉. 출고/택배는 어차피 발생하므로 태우지 않고,
                  추가로 발생하는 정합작업 + 바코드 + 원가만 계상.
      'collect' — 모아서 별도 배송. 출고 + 택배가 통째로 추가 발생.
      'reject'  — 고객이 수령 거절. 물류비 0 (뽑기 UI/운영비는 별도).
    """
    if mode == "reject":
        return 0.0
    if mode == "attach":
        return KITTING_PER_SET + BARCODE_PER_UNIT + gift_cogs
    if mode == "collect":
        # 한 박스에 gifts_per_batch개를 모아 보냄 → 출고/택배는 배치당 1회
        per_batch = (shipping_rate(monthly_boxes) + COURIER_PER_BOX
                     + KITTING_PER_SET
                     + gifts_per_batch * (BARCODE_PER_UNIT + gift_cogs))
        return per_batch / gifts_per_batch
    raise ValueError(mode)


# ---------------------------------------------------------------------------
# 3. 티어 클리프 분석 — 분할 주문이 물류비에 미치는 영향
# ---------------------------------------------------------------------------

def tier_cliff_report():
    """
    계단식 단가는 '건수가 늘면 총액이 줄어드는' 역전 구간을 만든다.
    2만원 임계값은 주문 분할(splitting)을 유인하므로 이 역전을 반드시 확인해야 한다.
    """
    rows = []
    for i in range(len(SHIPPING_TIERS) - 1):
        hi_threshold, hi_rate = SHIPPING_TIERS[i]      # 더 큰 물량 / 더 싼 단가
        lo_threshold, lo_rate = SHIPPING_TIERS[i + 1]  # 더 작은 물량 / 더 비싼 단가
        cost_at_threshold = hi_threshold * hi_rate
        # n * lo_rate == hi_threshold * hi_rate 인 n = 무차별점
        indifference = cost_at_threshold / lo_rate
        rows.append({
            "tier_below": f"{lo_threshold:,}~{hi_threshold - 1:,}건 @ {lo_rate:,}{WON}",
            "tier_at": f"{hi_threshold:,}건 이상 @ {hi_rate:,}{WON}",
            "cost_just_below": (hi_threshold - 1) * lo_rate,
            "cost_at": cost_at_threshold,
            "indifference_n": indifference,
        })
    return list(reversed(rows))


# ---------------------------------------------------------------------------
# 4. 월간 시나리오 시뮬레이션
# ---------------------------------------------------------------------------

def simulate(monthly_orders: int,
             p_over_20k: float,
             reject_rate: float,
             collect_share_of_accept: float,
             redeem_rate_attach: float,
             gift_cogs: int,
             gifts_per_batch: int = 3,
             split_uplift: float = 0.0):
    """
    monthly_orders          : 기준 월 주문(출고) 건수
    p_over_20k              : 2만원 이상 주문 비중  → 뽑기 발급 건수
    reject_rate             : 뽑기 결과를 보고 '안 받기'를 고른 비율
    collect_share_of_accept : 수령 선택자 중 '모아서 받기' 비율
    redeem_rate_attach      : '다음 주문 동봉' 선택자 중 유효기간 내 실제 재주문이
                              발생해 전달에 성공하는 비율 (나머지는 미전달/소멸)
    gift_cogs               : 사은품 매입원가
    gifts_per_batch         : '모아서 받기' 1회 배송에 담기는 평균 사은품 수
    split_uplift            : 2만원 임계값 때문에 유발되는 주문 건수 증가율
                              (주문 분할 + 임계 상향 구매)
    """
    orders = round(monthly_orders * (1 + split_uplift))
    draws = orders * p_over_20k

    accepted = draws * (1 - reject_rate)
    collect_n = accepted * collect_share_of_accept
    attach_n = accepted * (1 - collect_share_of_accept)

    # 동봉은 '다음 주문'이 유효기간 내 발생해야만 실제로 전달된다
    attach_delivered = attach_n * redeem_rate_attach
    attach_expired = attach_n - attach_delivered

    # 모아서 받기는 배치가 찰 때까지 대기 → 배송 건수
    collect_batches = collect_n / gifts_per_batch if gifts_per_batch else 0

    c_attach = attach_delivered * cost_per_gift("attach", gift_cogs, orders)
    c_collect = collect_n * cost_per_gift("collect", gift_cogs, orders, gifts_per_batch)
    gift_cost = c_attach + c_collect

    # 물류 출고비: 기준 대비 증분 (분할 주문으로 건수가 변하면 티어도 변한다)
    base_ship = shipping_cost(monthly_orders)
    new_ship = shipping_cost(orders) + collect_batches * shipping_rate(orders)
    ship_delta = new_ship - base_ship
    courier_delta = ((orders - monthly_orders) + collect_batches) * COURIER_PER_BOX

    total = gift_cost + ship_delta + courier_delta

    return {
        "orders": orders,
        "draws": draws,
        "accepted": accepted,
        "attach_n": attach_n,
        "attach_delivered": attach_delivered,
        "attach_expired": attach_expired,
        "collect_n": collect_n,
        "collect_batches": collect_batches,
        "gift_cost": gift_cost,
        "ship_delta": ship_delta,
        "courier_delta": courier_delta,
        "total_monthly_cost": total,
        "cost_per_draw": total / draws if draws else 0,
        "cost_per_delivered": (total / (attach_delivered + collect_n)
                               if (attach_delivered + collect_n) else 0),
        "undelivered_ratio": attach_expired / draws if draws else 0,
        "shipping_rate_used": shipping_rate(orders),
    }


def breakeven_gmv_uplift(result, aov: int, take_rate: float = TAKE_RATE):
    """비용을 상쇄하려면 몇 건의 '증분 주문'이 필요한가."""
    margin_per_order = aov * take_rate
    need_orders = result["total_monthly_cost"] / margin_per_order
    return {
        "need_incremental_orders": need_orders,
        "need_uplift_pct": need_orders / result["orders"] * 100,
        "margin_per_order": margin_per_order,
    }


# ---------------------------------------------------------------------------
# 5. 리포트
# ---------------------------------------------------------------------------

def hr(title=""):
    print("\n" + "=" * 78)
    if title:
        print(title)
        print("=" * 78)


def main():
    hr("[1] 수령 방식별 사은품 1개 전달 한계비용 (부가세 별도)")
    print(f"{'사은품 원가':>10} | {'동봉(attach)':>14} | {'모아서 1개':>12} | "
          f"{'모아서 3개씩':>13} | {'모아서 5개씩':>13}")
    print("-" * 78)
    for cogs in (500, 1_000, 2_000, 3_000, 5_000):
        a = cost_per_gift("attach", cogs, 15_000)
        c1 = cost_per_gift("collect", cogs, 15_000, 1)
        c3 = cost_per_gift("collect", cogs, 15_000, 3)
        c5 = cost_per_gift("collect", cogs, 15_000, 5)
        print(f"{cogs:>9,}{WON} | {a:>13,.0f}{WON} | {c1:>11,.0f}{WON} | "
              f"{c3:>12,.0f}{WON} | {c5:>12,.0f}{WON}")
    print("\n→ '모아서 받기'는 원가가 0이어도 출고 2,940 + 택배 2,500 + 정합 1,000이")
    print("  고정으로 붙는다. 배치를 못 채우면 사은품 하나에 6천원대가 나간다.")

    hr("[2] 계단식 출고단가의 역전 구간 (분할 주문이 오히려 총액을 낮추는 구간)")
    print(f"{'구간':>34} | {'직전 최대 총액':>16} | {'티어 진입 총액':>16} | {'무차별점':>10}")
    print("-" * 78)
    for r in tier_cliff_report():
        print(f"{r['tier_below']:>34} | {r['cost_just_below']:>15,}{WON} | "
              f"{r['cost_at']:>15,}{WON} | {r['indifference_n']:>9,.0f}건")
    print("\n→ 현재 월 처리량 10,000~20,000건. 17,620건을 넘긴 상태라면 건수를 20,000건")
    print("  까지 밀어올리는 편이 출고비 '총액'이 오히려 싸다. 반대로 17,619건 이하")
    print("  구간에서 분할 주문이 늘면 총액은 순수 증가한다. 현재 실측 건수 확인 필수.")

    hr("[3] 기본 시나리오 (중앙 가정) — 월 15,000건 기준")
    base = dict(monthly_orders=15_000, p_over_20k=0.50, reject_rate=0.15,
                collect_share_of_accept=0.35, redeem_rate_attach=0.45,
                gift_cogs=1_500, gifts_per_batch=3, split_uplift=0.05)
    r = simulate(**base)
    print(f"  주문 건수(분할 반영)      : {r['orders']:>12,.0f}건")
    print(f"  뽑기 발급                 : {r['draws']:>12,.0f}회")
    print(f"  수령 선택                 : {r['accepted']:>12,.0f}건")
    print(f"    ├ 동봉 선택             : {r['attach_n']:>12,.0f}건")
    print(f"    │   └ 실제 전달 성공    : {r['attach_delivered']:>12,.0f}건")
    print(f"    │   └ 재주문 없어 소멸  : {r['attach_expired']:>12,.0f}건  ← '꽝 없음' 광고와 충돌")
    print(f"    └ 모아서 받기           : {r['collect_n']:>12,.0f}건 "
          f"({r['collect_batches']:,.0f} 박스 추가 출고)")
    print(f"  ── 비용 ──")
    print(f"  사은품+가공비             : {r['gift_cost']:>12,.0f}{WON}")
    print(f"  출고 작업비 증분          : {r['ship_delta']:>12,.0f}{WON}")
    print(f"  택배비 증분               : {r['courier_delta']:>12,.0f}{WON}")
    print(f"  월 총비용                 : {r['total_monthly_cost']:>12,.0f}{WON}")
    print(f"  뽑기 1회당                : {r['cost_per_draw']:>12,.0f}{WON}")
    print(f"  실제 전달 1건당           : {r['cost_per_delivered']:>12,.0f}{WON}")
    print(f"  미전달 비율(발급 대비)    : {r['undelivered_ratio']*100:>11,.1f}%")
    be = breakeven_gmv_uplift(r, aov=35_000)
    print(f"  ── 손익분기 (AOV 35,000{WON}, 기여이익률 {TAKE_RATE:.0%}) ──")
    print(f"  필요 증분 주문            : {be['need_incremental_orders']:>12,.0f}건/월")
    print(f"  필요 주문 상승률          : {be['need_uplift_pct']:>11,.1f}%")

    hr("[4] 민감도 — '모아서 받기' 비율 × 사은품 원가 (월 총비용, 백만원)")
    cogs_list = [500, 1_000, 2_000, 3_000, 5_000]
    print(f"{'모아받기':>8} |" + "".join(f"{c:>11,}{WON}" for c in cogs_list))
    print("-" * 78)
    for cs in (0.0, 0.2, 0.35, 0.5, 0.8, 1.0):
        cells = []
        for cogs in cogs_list:
            p = dict(base); p["collect_share_of_accept"] = cs; p["gift_cogs"] = cogs
            cells.append(simulate(**p)["total_monthly_cost"] / 1_000_000)
        print(f"{cs*100:>7.0f}% |" + "".join(f"{v:>11,.1f}백만" for v in cells))
    print("\n→ 원가보다 '모아서 받기 비율'이 비용을 훨씬 크게 흔든다. 이 옵션이")
    print("  설계의 지배적 리스크 변수다.")

    hr("[5] 민감도 — 2만원 이상 주문 비중 × 분할 주문 유발률 (월 총비용, 백만원)")
    splits = [0.0, 0.05, 0.10, 0.20, 0.35]
    print(f"{'2만↑비중':>8} |" + "".join(f"{s*100:>12.0f}%" for s in splits))
    print("-" * 78)
    for p20 in (0.30, 0.40, 0.50, 0.60, 0.70):
        cells = []
        for s in splits:
            p = dict(base); p["p_over_20k"] = p20; p["split_uplift"] = s
            cells.append(simulate(**p)["total_monthly_cost"] / 1_000_000)
        print(f"{p20*100:>7.0f}% |" + "".join(f"{v:>10,.1f}백만" for v in cells))

    hr("[6] 파괴 구간 탐색 — 월 총비용 3,000만원 초과 조합")
    print("(월 3,000만원 = 물류센터 월차임 34,385,000원에 준하는 규모)")
    danger = []
    for p20, cs, cogs, split in product((0.4, 0.5, 0.6, 0.7),
                                        (0.2, 0.35, 0.5, 0.8),
                                        (1_000, 2_000, 3_000, 5_000),
                                        (0.0, 0.1, 0.2)):
        p = dict(base)
        p.update(p_over_20k=p20, collect_share_of_accept=cs,
                 gift_cogs=cogs, split_uplift=split)
        res = simulate(**p)
        if res["total_monthly_cost"] > 30_000_000:
            danger.append((res["total_monthly_cost"], p20, cs, cogs, split))
    total_combos = 4 * 4 * 4 * 3
    print(f"  탐색 조합 {total_combos}개 중 {len(danger)}개가 월 3,000만원을 초과 "
          f"({len(danger)/total_combos*100:.0f}%)")
    danger.sort(reverse=True)
    for cost, p20, cs, cogs, split in danger[:8]:
        print(f"   {cost/1_000_000:>6,.1f}백만  | 2만↑ {p20:.0%} | 모아받기 {cs:.0%} | "
              f"원가 {cogs:,}{WON} | 분할 {split:.0%}")

    hr("[7] '모아서 받기' 제거 시 (동봉 전용 설계)")
    p = dict(base); p["collect_share_of_accept"] = 0.0
    r2 = simulate(**p)
    print(f"  월 총비용    : {r2['total_monthly_cost']:>12,.0f}{WON}  "
          f"(기본안 대비 {(1 - r2['total_monthly_cost']/r['total_monthly_cost'])*100:,.0f}% 절감)")
    print(f"  뽑기 1회당   : {r2['cost_per_draw']:>12,.0f}{WON}")
    be2 = breakeven_gmv_uplift(r2, aov=35_000)
    print(f"  필요 주문 상승률 : {be2['need_uplift_pct']:>8,.1f}%")

    hr("[8] 재주문 전환율(동봉 성사율)에 따른 미전달 사은품 — '꽝 없음' 리스크")
    print(f"{'유효기간 내 재주문율':>20} | {'미전달 건수/월':>15} | {'발급 대비 미전달':>16}")
    print("-" * 78)
    for rr in (0.20, 0.30, 0.45, 0.60, 0.80):
        p = dict(base); p["redeem_rate_attach"] = rr
        res = simulate(**p)
        print(f"{rr*100:>19.0f}% | {res['attach_expired']:>14,.0f}건 | "
              f"{res['undelivered_ratio']*100:>15.1f}%")
    print("\n→ '꽝은 없다'고 광고하지만, 재주문이 없으면 사은품은 전달되지 않는다.")
    print("  표시광고 관점에서 이 구간이 가장 위험하다. 법무 검토 필요.")


if __name__ == "__main__":
    main()
