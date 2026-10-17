# Cursor 작업 인계 — RunningSignal

이 문서는 2026년 10월 17일 작업 중 작성한 코드 체크포인트입니다. 사용자 목표는 **실제 횡단보도와 서울 보행신호의 대응을 검증하고, 서버 인스턴스가 달라도 T-DATA 호출 제한을 함께 지키는 것**입니다. 사용자는 이 시점의 작업을 Cursor로 이어받기를 요청했습니다.

## 시작

저장소: `https://github.com/snuu08/RunningSignal.git`

작업 브랜치: `feat/shared-tdata-crossings-20261017`

기준 브랜치: `feat/seoul-live-pilot-20261017`

```bash
git clone --branch feat/shared-tdata-crossings-20261017 https://github.com/snuu08/RunningSignal.git
cd RunningSignal
npm ci
npm test -- --reporter=dot
npm run build
```

이미 저장소가 있다면 작업 변경사항부터 확인하고 새 브랜치를 체크아웃하세요. 사용자 변경사항을 강제로 초기화하지 마세요. `main`에 직접 커밋하거나 병합하지 않습니다. Node 22.12 이상을 사용합니다.

## 코드 상태

이번 체크포인트의 릴리스 식별자는 `seoul-shared-crossings-20261017-r6`입니다. **r6 배포와 운영 DB 생성·마이그레이션·서버 간 실측은 아직 수행하지 않았습니다.** 기존 배포와 이번 로컬 구현을 구분해야 합니다.

### 공유 호출 제한

- `server/seoul-shared-calls.ts`: Postgres 트랜잭션·행 잠금으로 계정별 호출 임대를 예약합니다. 서비스별 호출 간격, 공유 캐시, 서비스/계정 429 차단, 만료 토큰 검증, 비밀정보 제거를 포함합니다.
- `netlify/database/migrations/20261017024000_tdata_shared_calls.sql`: 계정·서비스 제한과 응답 캐시 테이블을 추가합니다. 기존 데이터베이스에는 적용하지 않은 새 마이그레이션입니다.
- `server/seoul-feed.ts`: 공유 모드에서는 로컬 성공 캐시로 DB 검사를 건너뛰지 않습니다. 결합 API가 없을 때 현재 현시·잔여시간을 순서대로 조회하고 실패 뒤 추가 호출을 중단합니다.
- `netlify/functions/api.ts`: 플랫폼 `context.deploy.context`와 `context.deploy.published`로 운영 배포를 판별하고 공유 DB 사용을 강제합니다. `CONTEXT`를 일반 런타임 환경변수라고 가정하지 않습니다.
- `server/api.ts`: 공유 모드와 실제 응답의 `coordination` 메타데이터를 노출합니다. DB 확인 실패는 503이며 운영 API를 추가 호출하지 않습니다.

현재 전용 API는 서비스별 2초, 과거 현시·잔여시간과 MAP API는 보수적으로 5분 간격을 적용합니다. 이것은 앱의 정책이며 제공기관의 모든 한도를 확정한 수치가 아닙니다. 더 긴 제공기관 `Retry-After`를 존중합니다. 명시적 서비스 한도가 아닌 429는 계정 전체에 적용합니다. 예약 범위는 이 앱의 새 서버 배포입니다. 같은 계정으로 호출하는 다른 앱과 사람의 요청까지 통제하지 않습니다.

`@netlify/database` 설치와 커밋된 마이그레이션을 포함한 배포로 DB가 자동 준비되는 방식입니다. `NETLIFY_DB_URL`은 플랫폼이 주입합니다. SQL 연결 문자열이나 키를 소스에 넣지 않습니다. 임의로 운영 DDL을 실행하지 말고 배포 마이그레이션을 사용합니다. DB 활성 사용량은 기존 Netlify 크레딧을 사용합니다. 요금제 업그레이드나 자동 충전을 새로 켜지 않습니다.

### 실제 횡단보도

- `data/signals/catalog/2026-10-17/seoul-crossing-candidates.json`: 공식 2026년 시설 위치자료와 2021년 횡단보도 도형에서 추출한 시범 교차로 3곳, 시설 13개입니다. 출처·SHA-256·EPSG:5186 근거를 포함합니다.
- `src/real/signals/crossing-field.ts`: GPS·동일 장비·실제 보행등 상태와 원천 시각·적색/녹색 전환 각 2회·잔여값 단위의 검토 조건입니다.
- `src/real/features/signals/CrossingFieldCheck.tsx`: 개발 연결 확인 화면에서 실제 시설 선택, 공식 도형 표시, 양끝점 GPS와 직접 본 상태 기록, 기기 내 저장과 JSON 내보내기를 제공합니다. 정확한 위치를 서버에 보내지 않습니다.
- `src/real/RealApp.tsx`: 새 대조 화면 연결과 서울 실시간 필드 대응 상태를 구분하는 문구를 추가했습니다.

T-GIS 교차로 관리번호와 T-DATA ID는 다른 체계입니다. 같은 이름은 후보 선정 근거일 뿐입니다. API의 `nt/et/...`는 관련 차량 진입 방향 코드이며 횡단보도 위치나 보행 방향으로 바로 해석하지 않습니다. 2021년 도형을 현재 양끝점의 검증 증거로 자동 승격하지 않습니다. `이단` 등 시설 단계와 중간 안전지대도 실제 검토 대상입니다.

**실제 현장 관측은 아직 없습니다.** 검토자료 조건이 충족되어도 `physicalCrossingVerified`와 `predictionReady`는 계속 `false`입니다. 검토 후 기존 `data/signals/verified/bundle.json`의 실제 crossing·liveMappings·surveys와 활성 범위를 함께 채워야 합니다. 미래 대기 예측과 공개 통행 안내는 아직 켜면 안 됩니다.

## 검증 결과와 한계

최종 전체 자동 테스트는 **432개 통과, 37개 파일 통과**입니다. TypeScript/Vite 빌드와 서버 엔트리 별도 strict 타입 검사도 통과했습니다. 기존 대형 번들 경고는 남아 있습니다.

추가 테스트는 공유 제한 10개와 횡단보도 모델/화면 13개입니다. SQL 테스트의 PGlite는 단일 연결 엔진입니다. 독립 클라이언트 로직과 실제 SQL은 검사하지만 실제 다중 Postgres 연결·서버 인스턴스의 부하 검증은 대체하지 않습니다. 새 화면은 아직 실제 휴대폰과 브라우저에서 시각 검증하지 않았습니다.

## Cursor에서 다음 할 일

1. 이 문서와 `docs/SHARED_TDATA_CROSSINGS_KO.md`를 읽고 변경사항을 리뷰합니다. 특히 임대 만료·작업 중단·캐시 우회·배포 컨텍스트 판별을 확인합니다.
2. 저장소와 연결된 Netlify 프로젝트에서 DB 제공 여부와 남은 크레딧을 확인합니다. `@netlify/database` 자동 준비와 배포 마이그레이션을 실제로 검증합니다. 인증은 Cursor 환경에서 정식 Netlify 로그인/연결을 사용합니다.
3. 사용자 소유 Netlify 프로젝트에 r6을 배포합니다. `main`에 직접 병합하지 말고 작업 브랜치 또는 기존 배포 브랜치의 검토된 변경을 사용합니다. 실패하면 정확한 오류와 배포 로그를 남깁니다.
4. `npm run verify:release -- https://your-site.example [intersectionId]`로 r6·공유 DB·최신 응답을 확인합니다. 소수의 동시 요청으로 서로 다른 `instanceId`가 같은 `callId` 캐시를 쓰는지 확인합니다. 한 인스턴스만 관측되면 서버 간 검증 완료라고 쓰지 않습니다. 제공기관 429를 일부러 소진시키는 부하 테스트는 하지 않습니다.
5. 개발 연결 확인 화면을 실제 브라우저에서 검증합니다. 현장 대조 JSON은 휴대폰에서 확보해야 합니다. 현장 증거 없이 방향·양끝점·단위·통과 가능 시간을 채우지 않습니다.
6. 현장 증거와 공식 대응 자료를 검토하고, 검증된 횡단 범위만 활성화합니다. 공백 구간과 원천 시각 10초 초과 응답은 계속 미확인으로 처리합니다.

로그인 세션, API 키 값, 정확한 사용자 위치, 비공개 운영 관측은 이 공개 인계 문서에 넣지 않습니다. 별도로 받은 재개 문서가 있다면 공개 커밋에 추가하지 않습니다.
