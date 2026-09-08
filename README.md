## 실제 GPS·API 모드 베타

실제 지도/보행 경로/계정 연결과 GPS 기록 모드를 추가했습니다. 기존 체험 모드는 그대로 유지됩니다.

- **[버튼별 기능·계산식·API 준비 상태·출시 검증 안내](docs/IMPLEMENTATION_KO.md)**
- 환경변수: [.env.example](.env.example)
- 계정 DB/RLS: [supabase/schema.sql](supabase/schema.sql)
- `npm ci` → `.env.example`을 `.env.local`로 복사 → 키 설정 → `npm run dev`
- `/real/home` 또는 `VITE_APP_MODE=real`로 실제 모드 진입. 키가 없어도 기기 GPS 자유 러닝/기기 저장은 가능합니다.
- **실제 신호 예측은 아직 활성화하지 않았습니다.** 교차로 방향 매핑·운영계획·응답 신선도를 검증해야 합니다. 키 설정과 서비스 검증은 별개입니다.
- 상업 배포·야외 검증·앱스토어 배포는 완료되지 않았습니다. 아래의 기존 설명은 **데모 모드** 설명입니다.

---

# FLOW RUN

출발지·목적지·평균 페이스를 입력하면 연결된 보행길을 찾고, 그 페이스에서 보행신호 대기가 길어지는 구간만 우회하는 러닝 데모 앱입니다.

앱 이름은 `src/config/app.ts`의 `APP_NAME` 한 곳에서 바꿉니다.

이 결과물은 **실제 길 안내가 아닙니다.** 지도·신호·GPS·인증 API는 연결되어 있지 않습니다. 가상 보행망과 로컬 계산으로 전체 흐름을 조작할 수 있는 모바일 우선 웹앱입니다.

## 지도/신호 API 키 없이 실행하는 방법

환경 변수와 API 키는 필요 없습니다. 기본 모드는 `demo`입니다.

```bash
npm install
npm run dev
```

브라우저에서 개발 서버 주소(보통 `http://localhost:5173`)를 엽니다.

검증:

```bash
npm test
npm run build
```

`VITE_APP_MODE=real` 로 켜면 실제 어댑터가 없다는 안내를 띄우고, 가상 데이터를 실제 지도처럼 섞지 않습니다. 데모로 쓰려면 변수를 비우면 됩니다.

## 데모 계정 · 비밀번호 재설정

- 가입/로그인은 `MockAuthProvider`입니다. 이 기기에만 저장되는 체험용 계정입니다. **실제 사용하는 비밀번호를 넣지 마세요.**
- 비밀번호 원문은 저장하지 않습니다. Web Crypto PBKDF2 검증값만 남습니다. 운영용 인증이 아닙니다.
- `데모로 체험하기`로 둘러볼 수 있습니다.
- 비밀번호 찾기: 실제 메일은 발송되지 않습니다. 설정 또는 `/inbox`의 **데모 수신함**에서 재설정 링크를 엽니다.
- 재설정 토큰은 만료되며 한 번만 사용할 수 있습니다. 데모 수신함은 demo 모드에만 있습니다.

## 테스트 시나리오

1. 키 없는 새 환경에서 실행 → 스플래시 → 가입(닉네임 포함) → 로그인 → 지역(서울/인천/대구/성남, 모두 데모 체험) → 홈. 데모 게스트는 지역 다음 닉네임을 묻습니다.
2. 각 지역에서 장소 검색과 루트 찾기가 동작하는지 확인.
3. 없는 주소를 검색하면 가상 지도에서 출발/도착을 지정해 계속.
4. 직접 설정 → 로딩 → 추천 → 다른 루트 → 선택 → 준비 → 시작 → 일시정지 → 재개 → 종료 → 저장 → 나의 루트.
5. 데모 비밀번호 재설정 후 새 비밀번호 로그인, 같은 링크 재사용 거절.
6. 샘플 인기 루트 공감, 내 루트 다시 달리기.
7. 시뮬레이션 속도 30×로 완주. 수동 일시정지 중 거리 증가 없음.
8. 새로고침 후 계정/지역/닉네임/기록 유지. 진행 중이면 paused로 복구.
9. 같은 루트 두 번 저장 시 카드 하나와 세션 둘. 저장 버튼 연타는 세션 하나.
10. 다른 계정에 기존 기록이 보이지 않음.

자동 테스트: `src/tests/domain.test.ts`, `src/tests/flow.test.ts`.

우회율 초기값 10%는 사용자 확정 수치가 아니라 `INITIAL_DETOUR_RATIO`로 조정하는 데모 값입니다.

## API 연결 체크리스트

실제 연동 시 아래 계약만 교체하고, 화면이 외부 응답을 직접 읽지 않게 합니다.

| 책임 | 계약 | 현재 | 향후 연결 지점 |
| --- | --- | --- | --- |
| 인증 | `src/providers/contracts/index.ts` `AuthProvider` | `src/providers/mock/auth.ts` | `src/providers/real/stubs.ts` — 서버 측 비밀키, 프론트 번들에 키를 넣지 않음 |
| 장소 | `PlaceProvider` | `src/providers/mock/places.ts` | 실제 장소검색 어댑터 |
| 경로 | `RouteProvider` | `src/providers/mock/routes.ts` + `src/domain/routing-policy.ts` | 보행망 SDK. WGS84는 어댑터에서만 변환 |
| 신호 | `SignalProvider` | `src/providers/mock/signals.ts` | 현재 상태와 미래 계획을 구분. current-state만 있으면 대기를 확정하지 않음 |
| 위치 | `LocationProvider` | 시뮬레이션 | 실제 GPS. 사용자 일시정지로 실제 신호 시계를 동결하지 않음 |
| 카탈로그 | `RouteCatalogProvider` | 로컬 샘플 | 허가된 콘텐츠만 |
| 기록 | `RunRepository` | `src/providers/mock/runs.ts` | `source=demo` 기록은 실제 랭킹과 분리 |
| 지도 표현 | `MapRenderer` | `src/components/map/MapRenderer.tsx` | 추천 로직을 지도에 넣지 않음 |

신호 API만 실패하면 지도·기록 등 가능한 기능은 유지하고 해당 예측만 `정보 없음`으로 둡니다.

로컬 저장은 `flowrun:` 접두사와 schema version을 씁니다. 데모 초기화는 앱 키만 지웁니다. `localStorage.clear()`는 사용하지 않습니다.

네이티브 스토어 배포와 백그라운드 GPS는 이번 범위가 아닙니다.
