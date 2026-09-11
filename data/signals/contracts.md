# 제공기관 계약 (호출 가능 여부)

실시간 대기 예측은 이 목록과 무관하게 비활성입니다. 목록 URL이 있다고 호출하지 않습니다.

| id | 상태 | 호출 | 문서 |
|---|---|---|---|
| tdata-phase | documented-openapi | 예 (캡처 전용) | https://t-data.seoul.go.kr/dataprovide/trafficdataviewopenapi.do?data_id=10119 |
| tdata-timing | documented-openapi | 예 (캡처 전용) | https://t-data.seoul.go.kr/dataprovide/trafficdataviewopenapi.do?data_id=10120 |
| tdata-connection | documented-openapi | 예 (캡처 전용, 요청표에 itstId 없음) | https://t-data.seoul.go.kr/category/dataviewopenapi.do?data_id=10123 |
| tdata-lane | documented-openapi | 예 (캡처 전용, 차로·보행 아님) | https://t-data.seoul.go.kr/category/dataviewopenapi.do?data_id=10122 |
| tdata-crossroad | documented-file | 아니오 | https://t-data.seoul.go.kr/dataprovide/trafficdataviewfile.do?data_id=10144 |
| utic-cross-info | documented-file | 아니오 (xlsx 다운로드) | CrossRoadInfoService.hwp |
| utic-plan | documented-openapi | 예 (조회, 예측 아님) | PlanCrossRoadInfoService.hwp |
| utic-sigmap | documented-openapi | 예 (조회, 예측 아님) | 같은 HWP 시그널맵 |
| utic-signal-open | guide-only | 아니오 | https://www.utic.go.kr/guide/utisRefSig.do |
| police-crossroad-info | listing-unverified | 아니오 | https://www.data.go.kr/data/15056721/openapi.do |
| police-plan | listing-unverified | 아니오 | https://www.data.go.kr/data/15056569/openapi.do |
| mois-realtime | listing-unverified | 아니오 | https://www.data.go.kr/data/15157604/openapi.do |
| national-signal-xls | documented-file | 아니오 | https://www.data.go.kr/data/15113147/fileData.do |
| seoul-crossing-spatial | missing-document | 아니오 | (서비스 ID 없음) |
| seoul-walk-network | documented-file | 아니오 | https://data.seoul.go.kr/dataList/OA-21208/A/1/datasetView.do |

필드·단위·오류 응답·한도의 원문은 `src/real/signals/contracts.ts`입니다.

2026-09-10 HWP: CrossRoadInfo는 파일, Plan/SigMap은 tsihub 조회. 주기·요일·예약코드는 파서로 읽고 대기 예측에는 쓰지 않음. data.go.kr 1320000 과 tsihub 키를 섞지 않음.
