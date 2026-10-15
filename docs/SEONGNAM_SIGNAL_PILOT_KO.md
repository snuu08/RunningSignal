# 성남 신호 파일럿

파일럿 ID: `seongnam-namhansanseong-sujin-v1`

검증 방향: 남한산성입구역에서 수진역. 반대 방향은 미검증.

## 현재 결론

코드로 완료: pilot 폴더, 조사 양식, 평가 명령, status audit 기반 readiness.

공식 데이터로 확인: UTIC 공개 신호 데이터 안내는 온라인 신호제어기 신호운영 계획정보를 인천·대구 중심으로 설명한다. 성남시 보행신호 운영계획 API는 현재 확인하지 못했다.

사용자 현장조사 필요: 횡단보도 endpoints, 보행신호 그룹, cycle, epoch, 유효기간, field comparison.

## 데이터 출처 검토

| 제공기관 | 데이터셋 이름 | 공식 문서 URL | 대상 지역 | 성남 포함 | 현재 상태 | 보행신호 | 잔여시간 | 운영계획 | 교차로 ID | 보행신호 그룹 ID | 좌표 | API 신청 | 코드 연결 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UTIC | 교통신호정보 | https://www.utic.go.kr/guide/newUtisData.do | 안내상 인천·대구 온라인 신호제어기 | 확인 안 됨 | 문서상 계획/시그널맵 | 확인 필요 | 확인 안 됨 | 있음 | 있음 | 확인 필요 | 시그널맵 | 필요 | 성남은 미연결 |
| 경기도 교통정보센터 | 오픈API | https://openapigits.gg.go.kr/api/jsp/manual_getUserInsertList.jsp | 경기도 교통정보 | 신호 API 확인 안 됨 | 확인 안 됨 | 확인 안 됨 | 확인 안 됨 | 확인 안 됨 | 확인 안 됨 | 확인 안 됨 | 확인 안 됨 | 필요 | 미연결 |
| 경기데이터드림 | Open API 사용방법 | https://data.gg.go.kr/portal/openapi/usagePage.do | 경기도 공개 데이터 | 데이터셋별 상이 | 데이터셋별 상이 | 확인 안 됨 | 확인 안 됨 | 확인 안 됨 | 확인 안 됨 | 확인 안 됨 | 데이터셋별 상이 | 필요 | 미연결 |
| 서울 T-DATA | 서울 신호 current state | 서울시 T-DATA | 서울 | 아니오 | 있음 | 일부 current state | 원시 잔여값 단위 미확인 | 운영계획 아님 | 있음 | 방향 매핑 필요 | 일부 | 필요 | 성남 pilot 사용 금지 |
| 행안부·한국지역정보개발원 | B551982 계열 API | https://www.data.go.kr/en/bbs/ntc/selectNotice.do?originId=NOTICE_0000000004498 | 전국 일부 실시간 생활 데이터 | 신호등 API 확인 안 됨 | 신호등 아님 | 확인 안 됨 | 확인 안 됨 | 확인 안 됨 | 확인 안 됨 | 확인 안 됨 | 확인 안 됨 | 필요 | 미연결 |

## 활성화 조건

- TMAP 실제 보행 route 확보.
- route 위 모든 횡단 조사.
- direction과 pedestrianSignalGroupId 확인.
- fixed operating plan과 epoch 확인.
- currentPlanConfirmedAt 최신 확인.
- `completeCoverage=true`.
- field comparison 수행.
- `npm test`, `npm run lint`, `npm run build`, `npm run signals -- validate`, `npm run signals -- report` 통과.

## 현재 활성화 상태

- `SIGNAL_PUBLIC_PREDICTION=false`
- `LIVE_SIGNAL_UI=false`
- `predictionEligible=0`
- `predictionReady=false`

## 테스트

```bash
npm run signals -- evaluate --pilot seongnam-namhansanseong-sujin-v1 --observations data/signals/pilots/seongnam-namhansanseong-sujin/field-observation.csv
npm run signals -- validate
npm run signals -- report
```
