-- ============================================================================
-- [GATE 0] 동봉 실행 가능성 — KILL GATE
-- ============================================================================
-- 목적: "다음 주문 때 동봉"이 물리적으로 가능한 비율을 측정한다.
--       텐바이텐은 위탁 마켓플레이스이므로 판매자 직배송 주문에는 동봉할 수 없다.
--
-- 사전등록 통과기준:
--   ≥ 60%  → PASS, Gate 1 진행
--   40~60% → 조건부. 자사 물류 출고 이력 고객으로 대상 한정
--   < 40%  → KILL. 시나리오 폐기
--
-- ★ 실행 전 00-schema-discovery.sql로 <<PLACEHOLDER>>를 모두 치환할 것 ★
-- 엔진: Presto (Superset SQL Lab). 날짜는 epoch ms 가정.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Q0-1. 전체 주문 대비 자사 물류센터 출고 주문 비중 (최근 6개월, 월별 추이)
-- ----------------------------------------------------------------------------
-- 월별로 보는 이유: 물류센터 이전(7~9월) 영향으로 최근 데이터가 왜곡됐을 수 있음.
--                  이전 이전(以前) 안정기 수치를 기준으로 판단할 것.
SELECT
    DATE_FORMAT(FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000), '%Y-%m')      AS ym,
    COUNT(*)                                                            AS total_orders,
    SUM(CASE WHEN o.<<DELIVERY_TYPE_COL>> = <<OWN_FC_VALUE>>
             THEN 1 ELSE 0 END)                                         AS own_fc_orders,
    ROUND(
        SUM(CASE WHEN o.<<DELIVERY_TYPE_COL>> = <<OWN_FC_VALUE>>
                 THEN 1.0 ELSE 0.0 END) * 100.0 / COUNT(*), 1)          AS own_fc_pct
FROM        bk_db_log.<<ORDER_TABLE>> o
WHERE       FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000) >= TIMESTAMP '2026-02-01 00:00:00'
  AND       FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000) <  TIMESTAMP '2026-08-01 00:00:00'
GROUP BY    DATE_FORMAT(FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000), '%Y-%m')
ORDER BY    ym;


-- ----------------------------------------------------------------------------
-- Q0-2. ★ 실질 동봉 가능률 ★  (Gate 0 판정의 근거가 되는 수치)
-- ----------------------------------------------------------------------------
-- 정의: 2만원 이상 주문을 한 고객의 "다음 주문"이 자사 물류 출고일 확률.
--       뽑기를 받은 사람에게 실제로 동봉이 성사될 수 있는 비율 그 자체.
WITH qualifying AS (
    -- 뽑기 발급 대상이 되는 주문 (2만원 이상)
    SELECT  o.<<USER_ID_COL>>   AS user_id,
            o.<<ORDER_ID_COL>>  AS order_id,
            o.<<REGDATE_COL>>   AS ordered_at
    FROM    bk_db_log.<<ORDER_TABLE>> o
    WHERE   o.<<ITEM_AMOUNT_COL>> >= 20000
      AND   FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000) >= TIMESTAMP '2026-01-01 00:00:00'
      AND   FROM_UNIXTIME(o.<<REGDATE_COL>> / 1000) <  TIMESTAMP '2026-05-01 00:00:00'
      AND   o.<<ORDER_STATUS_COL>> NOT IN (<<CANCEL_STATUS_VALS>>)
),
next_order AS (
    -- 각 발급 주문 이후 90일 내 첫 재주문의 배송 유형
    SELECT  q.user_id,
            q.order_id,
            MIN_BY(n.<<DELIVERY_TYPE_COL>>, n.<<REGDATE_COL>>) AS next_delivery_type,
            MIN(n.<<REGDATE_COL>>)                              AS next_ordered_at
    FROM    qualifying q
    JOIN    bk_db_log.<<ORDER_TABLE>> n
           ON  n.<<USER_ID_COL>> = q.user_id
           AND n.<<REGDATE_COL>> >  q.ordered_at
           AND n.<<REGDATE_COL>> <= q.ordered_at + (90 * 86400 * 1000)  -- 90일(ms)
           AND n.<<ORDER_STATUS_COL>> NOT IN (<<CANCEL_STATUS_VALS>>)
    GROUP BY q.user_id, q.order_id
)
SELECT
    COUNT(*)                                                          AS draws_issued,
    SUM(CASE WHEN n.order_id IS NOT NULL THEN 1 ELSE 0 END)           AS repurchased_90d,
    SUM(CASE WHEN n.next_delivery_type = <<OWN_FC_VALUE>>
             THEN 1 ELSE 0 END)                                       AS attachable,
    -- Gate 1의 Q1-4 (90일 재주문율)도 동시에 산출됨
    ROUND(SUM(CASE WHEN n.order_id IS NOT NULL THEN 1.0 ELSE 0.0 END)
          * 100.0 / COUNT(*), 1)                                      AS repurchase_90d_pct,
    -- ★ Gate 0 판정 수치 ★
    ROUND(SUM(CASE WHEN n.next_delivery_type = <<OWN_FC_VALUE>>
                   THEN 1.0 ELSE 0.0 END) * 100.0 / COUNT(*), 1)      AS attach_rate_pct
FROM        qualifying q
LEFT JOIN   next_order n ON n.order_id = q.order_id;

-- 판정:
--   attach_rate_pct >= 60  → PASS
--   40 <= attach_rate_pct < 60 → 조건부 (대상 한정)
--   attach_rate_pct <  40  → KILL
--
-- 주의: attach_rate_pct는 repurchase_90d_pct의 하위집합이다. 재주문 자체가 없으면
--       동봉도 없다. 두 수치를 분리해서 봐야 "동봉 불가"의 원인이 마켓플레이스
--       구조 때문인지, 재구매가 안 일어나서인지 구분된다.


-- ----------------------------------------------------------------------------
-- Q0-3. 혼합 주문 비율 (자사 물류 + 판매자 직배송이 한 주문에 섞임)
-- ----------------------------------------------------------------------------
-- 혼합 주문은 부분적으로만 동봉 가능하다. 이 비율이 높으면 동봉 로직이
-- "주문 단위"가 아니라 "출고(배송) 단위"로 설계돼야 한다 = 개발 복잡도 증가.
WITH per_order AS (
    SELECT  oi.<<ORDER_ID_COL>>                                     AS order_id,
            COUNT(DISTINCT oi.<<DELIVERY_TYPE_COL>>)                AS delivery_type_cnt
    FROM    bk_db_log.<<ORDER_ITEM_TABLE>> oi
    WHERE   FROM_UNIXTIME(oi.<<REGDATE_COL>> / 1000) >= TIMESTAMP '2026-05-01 00:00:00'
    GROUP BY oi.<<ORDER_ID_COL>>
)
SELECT
    COUNT(*)                                                        AS total_orders,
    SUM(CASE WHEN delivery_type_cnt > 1 THEN 1 ELSE 0 END)          AS mixed_orders,
    ROUND(SUM(CASE WHEN delivery_type_cnt > 1 THEN 1.0 ELSE 0.0 END)
          * 100.0 / COUNT(*), 1)                                    AS mixed_pct
FROM per_order;
