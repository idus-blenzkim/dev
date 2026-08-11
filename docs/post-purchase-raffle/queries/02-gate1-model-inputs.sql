-- ============================================================================
-- [GATE 1] 모델 가정 실측 — tools/raffle_model.py 입력값 교체용
-- ============================================================================
-- 각 쿼리 결과를 raffle_model.py의 base 딕셔너리에 반영한 뒤 재실행하면
-- 00-scenario-review.md의 비용 결론이 실측 기반으로 갱신됩니다.
--
-- ★ 실행 전 00-schema-discovery.sql로 <<PLACEHOLDER>>를 모두 치환할 것 ★
-- 엔진: Presto (Superset SQL Lab)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Q1-1 / Q1-3. 주문 금액 분포 — 임계값 설계의 근거
-- ----------------------------------------------------------------------------
-- 두 가지를 동시에 본다:
--   (a) 2만원 이상 비중  → 뽑기 발급량 = 비용 규모
--   (b) 15,000~19,999원 비중 → "조금만 더 담으면 뽑기" 상향 유인 여력
--       이 구간이 두터우면 임계값이 실제로 AOV를 밀어올릴 수 있다.
--       얇으면 뽑기는 이미 살 사람에게 공짜로 주는 순수 비용이 된다.
--
-- 기준액은 배송비를 제외한 상품금액으로 계산한다(권고안 §4).
SELECT
    CASE
        WHEN o.<<ITEM_AMOUNT_COL>> <  10000 THEN '1. ~9,999'
        WHEN o.<<ITEM_AMOUNT_COL>> <  15000 THEN '2. 10,000~14,999'
        WHEN o.<<ITEM_AMOUNT_COL>> <  18000 THEN '3. 15,000~17,999'
        WHEN o.<<ITEM_AMOUNT_COL>> <  20000 THEN '4. 18,000~19,999  <-- 상향 유인 구간'
        WHEN o.<<ITEM_AMOUNT_COL>> <  30000 THEN '5. 20,000~29,999  <-- 발급 시작'
        WHEN o.<<ITEM_AMOUNT_COL>> <  50000 THEN '6. 30,000~49,999'
        ELSE                                     '7. 50,000~'
    END                                                     AS amount_band,
    COUNT(*)                                                AS orders,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1)      AS pct,
    ROUND(AVG(o.<<ITEM_AMOUNT_COL>>), 0)                    AS avg_item_amount
FROM        bk_db_log.<<ORDER_TABLE>> o
WHERE       FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000) >= TIMESTAMP '2026-02-01 00:00:00'
  AND       FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000) <  TIMESTAMP '2026-08-01 00:00:00'
  AND       o.<<ORDER_STATUS_COL>> NOT IN (<<CANCEL_STATUS_VALS>>)
GROUP BY 1
ORDER BY 1;

-- → 밴드 5,6,7 합계 = raffle_model.py 의 p_over_20k
-- → 밴드 4 비중이 8% 미만이면 임계값 상향 효과를 기대하기 어렵다 (플랜 Q1-3 기준)


-- ----------------------------------------------------------------------------
-- Q1-2. ★ 무료배송 임계값 역산 ★  (P1-1 주문 분할 방어의 핵심)
-- ----------------------------------------------------------------------------
-- 뽑기 임계값이 무료배송 임계값보다 낮거나 같으면, 주문을 쪼개도 고객은 손해가
-- 전혀 없다 → 분할 주문이 순수 물류비 증가로 직결된다.
-- 배송비가 0으로 청구된 주문의 금액 하한을 보면 실제 운영 임계값이 드러난다.
SELECT
    CASE
        WHEN o.<<ITEM_AMOUNT_COL>> < 20000 THEN '~19,999'
        WHEN o.<<ITEM_AMOUNT_COL>> < 30000 THEN '20,000~29,999'
        WHEN o.<<ITEM_AMOUNT_COL>> < 50000 THEN '30,000~49,999'
        ELSE                                    '50,000~'
    END                                                     AS amount_band,
    COUNT(*)                                                AS orders,
    SUM(CASE WHEN o.<<DELIVERY_FEE_COL>> = 0
             THEN 1 ELSE 0 END)                             AS free_shipping_orders,
    ROUND(SUM(CASE WHEN o.<<DELIVERY_FEE_COL>> = 0
                   THEN 1.0 ELSE 0.0 END) * 100.0 / COUNT(*), 1)
                                                            AS free_shipping_pct,
    ROUND(AVG(o.<<DELIVERY_FEE_COL>>), 0)                   AS avg_delivery_fee
FROM        bk_db_log.<<ORDER_TABLE>> o
WHERE       FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000) >= TIMESTAMP '2026-05-01 00:00:00'
  AND       o.<<ORDER_STATUS_COL>> NOT IN (<<CANCEL_STATUS_VALS>>)
GROUP BY 1
ORDER BY 1;

-- → free_shipping_pct가 급등하는 밴드의 하한 = 실질 무료배송 임계값
-- → 뽑기 임계값은 반드시 이 값보다 높게 설정 (플랜 Q1-2 기준)


-- ----------------------------------------------------------------------------
-- Q1-5. ★ 월 실측 출고 건수 ★  (계단식 단가 역전 판정 — P1-1a)
-- ----------------------------------------------------------------------------
-- 무차별점 17,619건.
--   실측 > 17,620건 → 분할 주문이 출고비 총액을 오히려 낮춤 (분할 방어 우선순위 하향)
--   실측 < 17,619건 → 분할은 순수 손실 (상한 정책 필수)
-- 자사 물류센터 출고분만 집계해야 한다. 판매자 직배송은 물류대행비 청구 대상이 아니다.
SELECT
    DATE_FORMAT(FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000), '%Y-%m')    AS ym,
    COUNT(*)                                                          AS own_fc_shipments,
    CASE
        WHEN COUNT(*) >= 50000 THEN 1960
        WHEN COUNT(*) >= 45000 THEN 2000
        WHEN COUNT(*) >= 40000 THEN 2060
        WHEN COUNT(*) >= 35000 THEN 2140
        WHEN COUNT(*) >= 30000 THEN 2240
        WHEN COUNT(*) >= 25000 THEN 2380
        WHEN COUNT(*) >= 20000 THEN 2590
        ELSE                        2940
    END                                                               AS rate_per_box,
    COUNT(*) *
    CASE
        WHEN COUNT(*) >= 50000 THEN 1960
        WHEN COUNT(*) >= 45000 THEN 2000
        WHEN COUNT(*) >= 40000 THEN 2060
        WHEN COUNT(*) >= 35000 THEN 2140
        WHEN COUNT(*) >= 30000 THEN 2240
        WHEN COUNT(*) >= 25000 THEN 2380
        WHEN COUNT(*) >= 20000 THEN 2590
        ELSE                        2940
    END                                                               AS est_shipping_cost,
    CASE WHEN COUNT(*) >= 17620 THEN 'ABOVE_INDIFFERENCE'
         ELSE                        'BELOW_INDIFFERENCE' END         AS tier_verdict
FROM        bk_db_log.<<ORDER_TABLE>> o
WHERE       o.<<DELIVERY_TYPE_COL>> = <<OWN_FC_VALUE>>
  AND       FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000) >= TIMESTAMP '2026-01-01 00:00:00'
  AND       o.<<ORDER_STATUS_COL>> NOT IN (<<CANCEL_STATUS_VALS>>)
GROUP BY    DATE_FORMAT(FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000), '%Y-%m')
ORDER BY    ym;

-- 주의: 물류대행비는 "택배사 정산수량(BOX)" 기준이다. 주문 1건이 여러 박스로
--       분할 출고되면 BOX 수 > 주문 수가 된다. 정확한 판정을 위해서는
--       Webadmin 출고내역(BOX 기준)과 대조할 것. 위 쿼리는 하한 추정치다.


-- ----------------------------------------------------------------------------
-- Q1-6. 취소·반품률 — 뽑기 회수 정책 및 어뷰징 방어 설계용
-- ----------------------------------------------------------------------------
-- 특히 "2만원 턱걸이 주문의 취소율"이 전체 취소율보다 유의하게 높으면,
-- 런칭 후 결제-취소 어뷰징이 발생할 소지가 크다는 사전 신호다.
SELECT
    CASE WHEN o.<<ITEM_AMOUNT_COL>> BETWEEN 20000 AND 22000
         THEN 'threshold_20k_22k'
         ELSE 'other' END                                      AS segment,
    COUNT(*)                                                    AS orders,
    SUM(CASE WHEN o.<<ORDER_STATUS_COL>> IN (<<CANCEL_STATUS_VALS>>)
             THEN 1 ELSE 0 END)                                 AS cancelled,
    ROUND(SUM(CASE WHEN o.<<ORDER_STATUS_COL>> IN (<<CANCEL_STATUS_VALS>>)
                   THEN 1.0 ELSE 0.0 END) * 100.0 / COUNT(*), 2)
                                                                AS cancel_pct
FROM        bk_db_log.<<ORDER_TABLE>> o
WHERE       FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000) >= TIMESTAMP '2026-02-01 00:00:00'
GROUP BY 1;


-- ----------------------------------------------------------------------------
-- Q1-7. AOV 및 주문 규모 — 손익분기 계산 입력
-- ----------------------------------------------------------------------------
SELECT
    DATE_FORMAT(FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000), '%Y-%m')  AS ym,
    COUNT(*)                                                        AS orders,
    ROUND(AVG(o.<<ITEM_AMOUNT_COL>>), 0)                            AS aov_item,
    ROUND(AVG(o.<<PAY_AMOUNT_COL>>), 0)                             AS aov_paid,
    ROUND(SUM(o.<<ITEM_AMOUNT_COL>>) / 1000000.0, 1)                AS gmv_mil
FROM        bk_db_log.<<ORDER_TABLE>> o
WHERE       FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000) >= TIMESTAMP '2026-02-01 00:00:00'
  AND       o.<<ORDER_STATUS_COL>> NOT IN (<<CANCEL_STATUS_VALS>>)
GROUP BY    DATE_FORMAT(FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000), '%Y-%m')
ORDER BY    ym;

-- → aov_item = raffle_model.py breakeven_gmv_uplift(aov=...) 입력
-- → 기여이익률(TAKE_RATE 0.25 가정)은 재무팀 확인 필요. DB에서 산출 불가.


-- ----------------------------------------------------------------------------
-- Q1-8. 분할 주문 기저율 — A/B 가드레일의 대조군 기준선
-- ----------------------------------------------------------------------------
-- 런칭 전 "같은 날 같은 사람이 여러 번 주문"하는 자연 발생률을 미리 재둔다.
-- A/B에서 이 수치가 유의하게 올라가면 분할 어뷰징이 발생한 것이다.
WITH daily AS (
    SELECT  o.<<USER_ID_COL>>                                          AS user_id,
            DATE(FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000))              AS d,
            COUNT(*)                                                    AS orders_that_day
    FROM    bk_db_log.<<ORDER_TABLE>> o
    WHERE   FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000) >= TIMESTAMP '2026-05-01 00:00:00'
      AND   o.<<ORDER_STATUS_COL>> NOT IN (<<CANCEL_STATUS_VALS>>)
    GROUP BY o.<<USER_ID_COL>>, DATE(FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000))
)
SELECT
    COUNT(*)                                                            AS user_days,
    SUM(CASE WHEN orders_that_day > 1 THEN 1 ELSE 0 END)                AS multi_order_days,
    ROUND(SUM(CASE WHEN orders_that_day > 1 THEN 1.0 ELSE 0.0 END)
          * 100.0 / COUNT(*), 2)                                        AS multi_order_pct,
    ROUND(AVG(orders_that_day), 3)                                      AS avg_orders_per_day
FROM daily;
