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
npm run signals -- validate
npm run signals -- report
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

## 예측 입력 관계

예측 입력은 아래 관계가 모두 검증된 경우에만 `FixedPlan`으로 변환합니다.

```text
route
↓
crossing geometry
↓
crossing direction
↓
sourceIntersectionId
↓
pedestrianSignalGroupId
↓
operating plan
↓
cycle / phase / epoch
↓
validity
```

어느 단계라도 불확실하면 해당 crossing의 `waitSec`는 `null`입니다. `0`은 검증된 계획과 도착 시각 계산 결과 실제 대기가 0초인 경우에만 사용합니다.

`crossingLengthM`은 실제 진행 방향으로 건너는 거리입니다. 도색 폭은 `paintedWidthM`에 따로 기록하며, 차도 폭 추정치를 `crossingLengthM`으로 넣지 않습니다. `directionEvidence`에는 PED 그룹이 해당 횡단 방향에 연결된 근거를 적습니다. PED1~PED8이 실제 횡단 방향과 연결되지 않았으면 `pedestrianSignalGroupId=unmapped` 또는 `directionLabel=unmapped`로 두고 예측에서 제외합니다.

T-DATA phase/timing은 현재 상태입니다. UTIC CROP/weekday/holiday/reserve는 운영계획 문서입니다. 현재 상태를 반복해 미래 현시를 만들거나, UTIC offset만으로 `epochMs`를 추측하지 않습니다.

`npm run signals -- report`는 다음 집계를 출력합니다: crossings total, crossings verified, plans total, plans verified, direction mapped, epoch known, width known, survey covered, prediction eligible, prediction excluded, excluded reasons.

## verified pilot corridor

`verified/bundle.json`은 작은 field pilot corridor만 담습니다. 서울 전체나 전국 지원을 뜻하지 않습니다.

- verified record에는 가능한 한 `sourceDocument`, `sourceRetrievedAt`, `verifiedAt`, `verifiedBy`, `verificationMethod`, `notes` metadata와 evidence를 남깁니다.
- route survey는 route coordinates, expected crossing IDs, 실제 포함 crossing IDs를 함께 보관합니다.
- `complete=true`는 `verified/pilot-corridor.md`에 적힌 동쪽 진행 pilot route 전체를 확인한 경우에만 유지합니다. 인접 도로, 역방향, 다른 TMAP 후보에는 복사하지 않습니다.
- 정적 verified data도 시간이 지나면 stale입니다. live prediction은 `currentPlanConfirmedAt` freshness 검사를 통과해야 합니다.
- 활성화는 `SIGNAL_PREDICTION_SCOPES=field:pilot-corridor-20260917`처럼 제한된 scope부터 검토합니다.
- `SIGNAL_PUBLIC_PREDICTION=true`는 crossing, direction, plan, epoch, freshness, survey coverage, tests, field comparison을 모두 재확인한 뒤에만 후보로 검토합니다. 자동 변경하지 않습니다.

파일럿 forecast replay와 누적 대기 검증은 `verified/pilot-corridor.md`에 기록합니다.

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
