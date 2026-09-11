# 신호 자료 수집 (실시간 예측은 비활성)

이 폴더는 원본 → 정규화 → 검증완료를 나눕니다. 합성 샘플은 `samples/`에만 있고 `synthetic=true`입니다. 시설 좌표로 주기·녹색·조사완료를 만들지 않습니다.

## 넣을 위치

| 경로 | 용도 |
|---|---|
| `forms/` | 빈 양식. 복사해서 작성 |
| `inbox/` | 받은 원본 CSV·GeoJSON·키 제거 응답 |
| `raw/` | 수집 직후 원본 보관 |
| `normalized/` | ETL 통과 레코드와 제외 보고서 |
| `verified/` | 사람이 방향·현시·적용을 확인한 레코드만 |
| `captures/` | T-DATA 교차로 묶음 캡처 (gitignore, 키 제거) |
| `mappings/` | 컬럼·좌표계 매핑 |
| `samples/` | 합성 예시. 실서비스 로드 금지 |

작성 양식:

- `forms/crossing-register.csv` — 양끝점, 진행 방향, 보행 현시 키, **crossingLengthM(건너는 거리)**, paintedWidthM(도색 폭, 선택)
- `forms/plan-register.csv` — sourcePlanId/version, 주기, epoch, 녹색/점멸/소거, 유효기간, Asia/Seoul 요일·시간대·특수일, operationMode
- `forms/field-observation.csv` — 현장 녹색/점멸/적색, 진입 도착, 예측대기, 관측대기, 원천 응답시각, 예외운영. 예측 실패는 빈칸(0으로 채우지 않음)

시각 필드 네 가지를 섞지 마세요: `planVerifiedAt`, `observedAt`, `fetchedAt`, `currentPlanConfirmedAt`. 요청 시각을 검증 시각에 넣지 마세요. 엔진 60초 제한은 **현재 계획 적용 확인**에만 쓰이며, 문서 검증일과 다릅니다.

## 실행

저장소 루트에서:

```bash
npm run signals -- help
npm run signals -- contracts
npm run signals -- capture --itstId 1537
npm run signals -- etl --kind crossings --input data/signals/inbox/crossings.csv --mapping data/signals/mappings/crossing-csv.json
npm run signals -- etl --kind plans --input data/signals/inbox/plans.csv --mapping data/signals/mappings/plan-csv.json
npm run signals -- etl --kind observations --input data/signals/inbox/field-observation.csv
npm run signals -- etl --kind geojson --input data/signals/inbox/crossings.geojson --mapping data/signals/mappings/seoul-spatial.json
```

XLS/XLSX는 `npm run signals -- xlsx-csv --input …`로 CSV를 만들 수 있습니다. 선행 0은 문자열로 유지합니다. `.xls`(OLE)는 엑셀에서 CSV로 저장하세요. `national-xls-placeholder.json`은 서울 표준데이터와 다른 전국/파일 자리입니다. 헤더를 추측 이름으로 확정하지 마세요.

수집:

```bash
npm run signals -- collect --provider utic --op getPlanCROPInfo --srchCTId L02
npm run signals -- collect --provider tdata --service phase --itstId 1537
npm run signals -- mae --input data/signals/inbox/field-observation.csv
npm run signals -- pack-verified --crossings data/signals/verified/crossings.json --plans data/signals/verified/plans.json
```

`pack-verified`는 `samples/`를 넣지 않습니다. 공개 예측은 `SIGNAL_PUBLIC_PREDICTION=true`와 `SIGNAL_PREDICTION_SCOPES=field:교차로ID`가 있을 때만 켜집니다.

합성 예시 ETL (실서비스 로드 금지):

```bash
npm run signals -- etl --kind crossings --input data/signals/samples/synthetic-crossings.csv --mapping data/signals/mappings/crossing-csv.json --out data/signals/normalized
npm run signals -- etl --kind plans --input data/signals/samples/synthetic-plans.csv --mapping data/signals/mappings/plan-csv.json --out data/signals/normalized
npm run signals -- etl --kind observations --input data/signals/samples/synthetic-observations.csv --out data/signals/normalized
```

캡처는 공식 Open API인 phase/timing/connection/lane과, HWP에 있는 UTIC 계획 조회만 호출합니다. 교차로 MAP(data_id=10144)과 CrossRoadInfo xlsx는 파일입니다.

```bash
npm run signals -- utic-url --op getPlanCROPInfo --srchCTId L01
npm run signals -- parse-utic --kind crop --input data/signals/inbox/crop.json
```

인증키는 결과 JSON에서 `[redacted]`로 바뀝니다. `.env.local`의 `SEOUL_TDATA_API_KEY`를 로그에 인쇄하지 않습니다.
