# PHASE 6 배포 전 통합 점검

검증 시각: 2026-09-17 KST

## 1. 발견한 실제 원인

- `src/real/RealApp.tsx`가 2,978줄 규모로 auth, planner, run, signals, profile 상태를 한 파일에서 조합하고 있었다. 신호 현재 상태 패널과 live ETA 계산도 같은 파일에 있어 변경 범위가 커지는 구조였다.
- `src/real/RealApp.tsx`의 상태 모델은 다음 기준으로 연결되어 있었다.
  - `position`: planner의 현재 위치/출발지 추천용.
  - `origin`: 사용자가 확정한 출발지. `plannerPosition = origin?.coord ?? position`.
  - `run.fix`: 실제 러닝 중 현재 GPS fix. 경로 진행도는 `run.fix ?? run.live.track.fixes.at(-1)`.
  - `route projection`: `progressOnRoute(run.live.route.coordinates, currentRawFix.coord)`.
  - `current route`: planner에서는 `routes[candidate]`, 러닝 중에는 `run.live.route`.
  - `candidate`: 후보 index. reroute 뒤에는 `candidateIndex(response.routes, response.recommendedId)`로 재정렬.
  - `forecast`: route id별 forecast. 신호 활성 조건이 false면 UI에서 대기를 사용하지 않는다.
  - `departureMs`: 검색 시점 forecast 기준 시각. live ETA는 `run.live.lastTick` 기반으로 재계산.
  - `signal coverage`: 서버 응답 `signalCoverage`; unknown/incomplete이면 false zero를 만들지 않는다.
- production 환경 감사 결과 server-only key는 client bundle에서 직접 읽지 않는다. client `import.meta.env` 사용은 `VITE_APP_MODE`, `VITE_MAPTILER_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`만 확인됐다.
- Netlify routing은 `/api/* -> /.netlify/functions/api/:splat`가 SPA fallback보다 먼저 있고 `force=true`라 `/api`가 SPA에 먹히지 않는다.
- `npm ci` 첫 실행은 RunningSignal Vite dev server가 `@rolldown/...node` native binding을 잠가 EPERM으로 실패했다. dev server 중지 뒤 재실행 통과.

## 2. 수정한 내용

- `src/real/features/signals/CurrentStatePanel.tsx`
  - T-DATA 현재 상태 표시 컴포넌트를 `RealApp.tsx`에서 분리했다.
  - current state가 예측이 아니라는 문구와 잔여 raw display를 유지했다.
- `src/real/features/signals/liveSignalGuidance.ts`
  - 러닝 중 다음 crossing ETA, 예상 대기, 안전 guidance 계산을 순수 함수로 분리했다.
  - plan/width/forecast가 없으면 `waitSec=null`을 유지한다.
  - 현재 신호와 예상 도착 시 신호 문구를 분리한다.
- `src/real/features/signals/liveSignalGuidance.test.ts`
  - current state와 prediction 분리.
  - plan 미확인 시 false zero 방지.
  - crossing 근접 시 안전 우선 guidance를 테스트한다.
- `src/real/RealApp.tsx`
  - 신호 표시/계산 코드를 feature 모듈로 이동해 2,869줄로 축소했다.
  - 아직 auth/planner/run/profile까지 완전 분해되지는 않았다.

## 3. GPS 현재 상태

```text
위치 획득: navigator.geolocation 기반 현재 위치 획득 및 run watchPosition 사용. production browser 실제 권한 흐름은 미검증.
accuracy 처리: 위치 정확도 표시, poor/unreliable 안내, rolling pace에서 poor accuracy 구간 제외/저가중 처리.
outlier 처리: GPS jump/outlier 필터와 sustained off-route 샘플링 적용.
route matching: progressOnRoute로 polyline projection, off-route/reroute 판단 연결.
background: 화면 잠금/백그라운드 장시간 추적은 미검증. Web geolocation 한계 존재.
남은 한계: 실외/고층건물/LTE/5G 실제 기기 비교는 미검증.
```

## 4. 신호 상태

```text
T-DATA 연결: production /api/status 기준 미설정. current state는 예측과 분리.
UTIC 연결: production /api/status 기준 미설정. operating plan은 검증 전 예측에 사용하지 않음.
crossing mapping: local verified bundle 기준 crossings verified=2, direction mapped=2.
operating plan: local verified bundle 기준 plans verified=2.
epoch: local verified bundle 기준 epoch known=2. 추측 epoch 없음.
verified coverage: survey covered=2이나 scope_inactive/stale_plan으로 prediction eligible=0.
predictionReady: false.
```

## 5. 테스트

```text
npm ci
결과: 통과. 첫 실행은 dev server 파일 잠금 EPERM, dev server 중지 후 재실행 통과. audit 0 vulnerabilities.

npm test
결과: 통과. 16 files, 215 tests.
비고: clean install 직후 첫 실행은 Vitest worker timeout. 동일 명령 재시도 및 최종 실행 통과.

npm run lint
결과: 통과. 기존 React lint warning 다수 남음.

npm run build
결과: 통과. Vite chunk size warning 남음.

npm run signals -- validate
결과: 통과. predictionReady=false, predictionEligible=0, excluded scope_inactive=2/stale_plan=2.

npm run signals -- report
결과: 통과. crossings total=2, verified=2, plans total=2, verified=2, epoch known=2, predictionReady=false.

node scripts/deploy-routes-check.ts
결과: 통과. status 200, places=true, routes=true, signalPrediction=false, predictionReady=false.

production /api/status
결과: 200. places=true, routes=true, reverseGeocode=true, signalPrediction=false, predictionReady=false.

production /api/places?q=서울시청
결과: 200. Kakao 장소 후보 반환.

production /api/routes
결과: 200. TMAP 후보 tmap-30 반환, signalCoverage=unknown, recommendationReason=walking-baseline.

browser smoke test
결과: 미검증. scripts/browser-verify.mjs가 playwright-core 미설치로 실행 불가.

MapLibre render test
결과: 자동 단위 테스트 범위는 통과. 실제 브라우저 렌더 픽셀 검증은 미검증.

GPS mock test
결과: 자동 테스트 통과. 실제 스마트폰 GPS는 미검증.

signal pipeline test
결과: 통과.
```

## 6. 실제 기기 검증 필요사항

### GPS

```text
[ ] 위치 권한 허용 - 미검증
[ ] 위치 권한 거부 - 미검증
[ ] 현재 위치 최초 획득 - 미검증
[ ] 재측정 - 미검증
[ ] 실외 - 미검증
[ ] 고층건물 주변 - 미검증
[ ] Wi-Fi - 미검증
[ ] LTE/5G - 미검증
[ ] accuracy 표시 - 코드/테스트 확인, 실제 기기 미검증
```

### 러닝

```text
[ ] 시작 - 코드/테스트 확인, 실제 기기 미검증
[ ] 일시정지 - 코드/테스트 확인, 실제 기기 미검증
[ ] 재개 - 코드/테스트 확인, 실제 기기 미검증
[ ] 종료 - 코드/테스트 확인, 실제 기기 미검증
[ ] 10m 이상 저장 - 미검증
[ ] 1km 이상 기록 - 미검증
[ ] 경로 이탈 - 코드/테스트 확인, 실제 기기 미검증
[ ] 경로 복귀 - 미검증
[ ] reroute - API/코드 확인, 실제 기기 미검증
[ ] 화면 잠금 - 미검증
[ ] 화면 복귀 - 미검증
```

### 지도

```text
[ ] 현재 위치 - 코드/테스트 확인, 실제 브라우저/기기 미검증
[ ] 출발지 - 코드/테스트 확인, 실제 브라우저/기기 미검증
[ ] 도착지 - 코드/테스트 확인, 실제 브라우저/기기 미검증
[ ] 경로 - production API 확인, 실제 렌더 미검증
[ ] 확대/축소 - 미검증
[ ] 수동 이동 - 코드/테스트 확인, 실제 브라우저/기기 미검증
[ ] follow - 코드/테스트 확인, 실제 브라우저/기기 미검증
[ ] MapTiler 실패 fallback - 코드/테스트 확인, production 실제 실패 주입 미검증
```

### API

```text
[x] Kakao 장소 검색 - production /api/places 확인
[ ] Kakao 역지오코딩 - endpoint/status 확인, production 실제 호출 미검증
[x] TMAP 보행 경로 - production /api/routes 확인
[x] 일부 TMAP 후보 실패 - 자동 테스트 확인
[x] API key 없음 - 자동 테스트 확인
[x] API timeout - 자동 테스트 확인
```

### 신호

```text
[x] API configured와 prediction ready 구분 - /api/status 및 테스트 확인
[x] unknown은 null - 테스트 확인
[x] current state와 prediction 분리 - 테스트 확인
[x] verified route만 forecast - signal validate/report 확인
[x] incomplete coverage에서 forecast 비활성 - signal validate/report 확인
```

## 7. 남은 TODO

```text
P0
- 실제 스마트폰에서 GPS 권한/최초 획득/러닝 시작-종료/저장/화면 잠금 복귀 검증 필요.
- 검증된 실제 pilot corridor의 fresh operating plan과 field comparison 필요. 현재 production predictionReady=false.

P1
- RealApp.tsx를 auth/location/planner/run/signals/profile 단위로 추가 분해.
- browser smoke test 의존성(playwright-core 또는 별도 smoke runner) 정리.
- MapLibre 실제 렌더 픽셀 검증 추가.
- production Kakao reverse geocode 실제 호출 검증.

P2
- Vite chunk size 경고 완화: RealApp route-level code split 검토.
- 기존 React lint warning 정리.
```
