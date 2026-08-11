-- ============================================================================
-- [STEP 0] 주문/배송 테이블 스키마 탐색  ★ 반드시 먼저 실행 ★
-- ============================================================================
-- 실행 위치: Superset SQL Lab (Presto 엔진)
--
-- 왜 이 단계가 필요한가:
--   본 검증 플랜의 나머지 쿼리는 주문/배송 테이블 컬럼명을 사용하는데,
--   해당 스키마는 아직 검증되지 않았습니다. 컬럼명을 추측해서 쓰면 조용히 틀린
--   숫자가 나오고, 그 숫자로 KILL 판정을 내리게 됩니다.
--   → 아래로 실제 컬럼명을 확인한 뒤 01~ 쿼리의 <<PLACEHOLDER>>를 치환하세요.
--
-- Superset은 SELECT만 허용하므로 DESCRIBE 대신 information_schema를 씁니다.
-- ============================================================================


-- 0-1. 주문 관련 테이블 목록 찾기
SELECT table_schema,
       table_name
FROM   information_schema.tables
WHERE  table_schema IN ('bk_db_log', 'bk_db_user', 'bk_db_item')
  AND  (table_name LIKE '%order%'      -- 주문
     OR table_name LIKE '%deliv%'      -- 배송
     OR table_name LIKE '%ship%'       -- 출고
     OR table_name LIKE '%claim%'      -- 취소/반품
     OR table_name LIKE '%gift%')      -- 사은품(기존 운영 테이블 존재 여부)
ORDER BY table_schema, table_name;


-- 0-2. 특정 주문 테이블의 컬럼 확인
--      (0-1 결과에서 주문 마스터로 보이는 테이블명을 넣어 반복 실행)
SELECT column_name,
       data_type
FROM   information_schema.columns
WHERE  table_schema = 'bk_db_log'
  AND  table_name   = '<<ORDER_TABLE>>'
ORDER BY ordinal_position;


-- 0-3. 출고 주체(자사 물류 vs 판매자 직배송)를 구분하는 컬럼 탐색
--      Gate 0의 핵심. 이 구분자가 없으면 동봉 가능률을 계산할 수 없습니다.
--      아래 결과에서 배송유형/출고처/창고코드 성격의 컬럼을 찾으세요.
SELECT table_name,
       column_name,
       data_type
FROM   information_schema.columns
WHERE  table_schema = 'bk_db_log'
  AND  (column_name LIKE '%deliv%'
     OR column_name LIKE '%ship%'
     OR column_name LIKE '%whouse%'
     OR column_name LIKE '%warehouse%'
     OR column_name LIKE '%center%'
     OR column_name LIKE '%vendor%'
     OR column_name LIKE '%maker%'
     OR column_name LIKE '%sendtype%'
     OR column_name LIKE '%dlvtype%')
ORDER BY table_name, column_name;


-- 0-4. 구분자 컬럼의 실제 값 분포 확인
--      코드값이 무엇을 의미하는지(1=자사, 2=직배송 등) 물류팀 확인 필요
SELECT <<DELIVERY_TYPE_COL>>  AS delivery_type,
       COUNT(*)               AS cnt
FROM   bk_db_log.<<ORDER_TABLE>>
WHERE  FROM_UNIXTIME(<<REGDATE_COL>> / 1000) >= TIMESTAMP '2026-05-01 00:00:00'
GROUP BY <<DELIVERY_TYPE_COL>>
ORDER BY cnt DESC;


-- ============================================================================
-- 치환 대상 정리 (0-1 ~ 0-4 실행 후 확정할 것)
--   <<ORDER_TABLE>>        : 주문 마스터 테이블명
--   <<ORDER_ITEM_TABLE>>   : 주문 상품(라인아이템) 테이블명
--   <<ORDER_ID_COL>>       : 주문번호 컬럼
--   <<USER_ID_COL>>        : 회원ID 컬럼
--   <<REGDATE_COL>>        : 주문일시 컬럼 (epoch ms 여부도 확인)
--   <<PAY_AMOUNT_COL>>     : 실결제금액 컬럼
--   <<ITEM_AMOUNT_COL>>    : 상품금액 컬럼 (배송비 제외분)
--   <<DELIVERY_FEE_COL>>   : 배송비 컬럼
--   <<DELIVERY_TYPE_COL>>  : 자사물류/직배송 구분 컬럼
--   <<OWN_FC_VALUE>>       : 자사 물류센터 출고를 뜻하는 코드값
--   <<ORDER_STATUS_COL>>   : 주문상태 컬럼
--   <<CANCEL_STATUS_VALS>> : 취소/반품 상태값 목록
-- ============================================================================
