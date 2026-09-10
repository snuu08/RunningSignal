export type ContractStatus =
  | "documented-openapi"
  | "documented-file"
  | "guide-only"
  | "listing-unverified"
  | "missing-document";

export type ProviderContract = {
  id: string;
  provider: string;
  title: string;
  status: ContractStatus;
  catalogUrl: string;
  listedEndpoint: string | null;
  listedOperations: string[];
  requestFields: string[];
  responseFieldsNoted: string[];
  unitsNoted: string[];
  errorResponses: string;
  callLimit: string;
  approvalScope: string;
  notes: string;
  mayCall: boolean;
};

export const PROVIDER_CONTRACTS: ProviderContract[] = [
  {
    id: "tdata-phase",
    provider: "서울특별시 T-DATA",
    title: "신호제어기 신호현시 (data_id=10119)",
    status: "documented-openapi",
    catalogUrl:
      "https://t-data.seoul.go.kr/dataprovide/trafficdataviewopenapi.do?data_id=10119",
    listedEndpoint:
      "https://t-data.seoul.go.kr/apig/apiman-gateway/tapi/v2xSignalPhaseInformation/1.0",
    listedOperations: ["GET v2xSignalPhaseInformation/1.0"],
    requestFields: ["apiKey", "type", "pageNo", "numOfRows", "itstId"],
    responseFieldsNoted: [
      "itstId",
      "trsmUtcTime",
      "dataId",
      "ntPdsgStatNm",
      "etPdsgStatNm",
      "stPdsgStatNm",
      "wtPdsgStatNm",
    ],
    unitsNoted: ["상태명 문자열", "trsmUtcTime timestamp"],
    errorResponses: "포털 페이지에 HTTP 오류 표가 없음. 캡처 시 상태코드를 기록.",
    callLimit: "개발 활용신청 하루 최대 1,000건 (포털 안내)",
    approvalScope: "T-DATA 활용신청 범위. 이 저장소에서 승인 여부를 확인하지 않음.",
    notes:
      "2026-09-08 카탈로그 페이지 확인. 공식 샘플 URL은 http 스킴. 이 코드는 https만 사용. 현재 현시이며 미래 주기 계획이 아님. 요청표에서 필수(필)는 apiKey뿐이고 itstId는 선택 인자로 나열됨.",
    mayCall: true,
  },
  {
    id: "tdata-timing",
    provider: "서울특별시 T-DATA",
    title: "신호제어기 잔여시간 (data_id=10120)",
    status: "documented-openapi",
    catalogUrl:
      "https://t-data.seoul.go.kr/dataprovide/trafficdataviewopenapi.do?data_id=10120",
    listedEndpoint:
      "https://t-data.seoul.go.kr/apig/apiman-gateway/tapi/v2xSignalPhaseTimingInformation/1.0",
    listedOperations: ["GET v2xSignalPhaseTimingInformation/1.0"],
    requestFields: ["apiKey", "type", "pageNo", "numOfRows", "itstId"],
    responseFieldsNoted: [
      "itstId",
      "trsmUtcTime",
      "ntPdsgRmdrCs",
      "etPdsgRmdrCs",
      "stPdsgRmdrCs",
      "wtPdsgRmdrCs",
    ],
    unitsNoted: ["잔여 *RmdrCs = 1/10초(센티초) — 포털 설명"],
    errorResponses: "포털 페이지에 HTTP 오류 표가 없음.",
    callLimit: "개발 활용신청 하루 최대 1,000건 (포털 안내)",
    approvalScope: "T-DATA 활용신청 범위.",
    notes: "2026-09-08 카탈로그 확인. 현재 잔여값. 여러 주기 뒤를 이 값으로 단정하지 않음. 잔여 *RmdrCs = 1/10초(센티초).",
    mayCall: true,
  },
  {
    id: "tdata-connection",
    provider: "서울특별시 T-DATA",
    title: "신호연결 Map (data_id=10123)",
    status: "documented-openapi",
    catalogUrl:
      "https://t-data.seoul.go.kr/category/dataviewopenapi.do?data_id=10123",
    listedEndpoint:
      "https://t-data.seoul.go.kr/apig/apiman-gateway/tapi/v2xSignalConnectionMapInformation/1.0",
    listedOperations: ["GET v2xSignalConnectionMapInformation/1.0"],
    requestFields: ["apiKey", "type", "pageNo", "numOfRows"],
    responseFieldsNoted: [
      "itstId",
      "laneId",
      "laneCnncId",
      "signlPermMuvrNm",
      "signlgroupCd",
      "regDt",
    ],
    unitsNoted: ["regDt timestamp"],
    errorResponses: "포털 페이지에 HTTP 오류 표가 없음.",
    callLimit: "개발 활용신청 하루 최대 1,000건 (포털 안내)",
    approvalScope: "T-DATA 활용신청 범위.",
    notes:
      "2026-09-08 카탈로그 확인. 요청 인자 표에 itstId가 없다. 캡처는 공식 표대로 itstId를 붙이지 않고, 세션 메타데이터로만 교차로 ID를 묶는다. 보행 방향 확정으로 쓰지 않음.",
    mayCall: true,
  },
  {
    id: "tdata-lane",
    provider: "서울특별시 T-DATA",
    title: "Map 차로 정보 (data_id=10122)",
    status: "documented-openapi",
    catalogUrl:
      "https://t-data.seoul.go.kr/category/dataviewopenapi.do?data_id=10122",
    listedEndpoint:
      "https://t-data.seoul.go.kr/apig/apiman-gateway/tapi/v2xLaneMapInformation/1.0",
    listedOperations: ["GET v2xLaneMapInformation/1.0"],
    requestFields: ["apiKey", "type", "pageNo", "numOfRows"],
    responseFieldsNoted: ["itstId", "laneId", "permDrcCd", "laneTypeCd", "lanePermMuvrCn"],
    unitsNoted: [],
    errorResponses: "포털 페이지에 HTTP 오류 표가 없음.",
    callLimit: "개발 활용신청 하루 최대 1,000건 (포털 안내)",
    approvalScope: "T-DATA 활용신청 범위.",
    notes: "2026-09-08 카탈로그 확인. 차량 차로. 러닝 경로·보행 현시로 사용하지 않음. 요청 표에 itstId 없음.",
    mayCall: true,
  },
  {
    id: "tdata-crossroad",
    provider: "서울특별시 T-DATA",
    title: "교차로 MAP 정보 (data_id=10144)",
    status: "documented-file",
    catalogUrl:
      "https://t-data.seoul.go.kr/dataprovide/trafficdataviewfile.do?data_id=10144",
    listedEndpoint: null,
    listedOperations: [],
    requestFields: [],
    responseFieldsNoted: [],
    unitsNoted: [],
    errorResponses: "해당 없음 (파일 다운로드).",
    callLimit: "파일 다운로드. Open API 한도 대상이 아님.",
    approvalScope: "포털 파일 다운로드 권한.",
    notes:
      "2026-09-08 카탈로그 확인: 제공유형=파일데이터 CSV. 파일명 예 v2xCrossroadMapInformation_20241114_final.csv. 코드의 v2xCrossroadMapInformation/1.0 게이트웨이 호출은 공식 카탈로그와 불일치. 캡처·프록시는 이 경로를 호출하지 않는다. 교차로 중심점은 횡단 양끝점이 아니다.",
    mayCall: false,
  },
  {
    id: "utic-cross-info",
    provider: "UTIC / 도로교통공단",
    title: "교차로기반정보서비스 CrossRoadInfoService",
    status: "documented-file",
    catalogUrl: "https://www.utic.go.kr/guide/utisRefSig.do",
    listedEndpoint:
      "http://tsihub.utic.go.kr/tsi/api/CrossRoadInfoService/download",
    listedOperations: ["crossInfo", "crossDetailInfo"],
    requestFields: ["serviceKey", "srchCTId"],
    responseFieldsNoted: [
      "L{region}_crossInfo.xlsx — REGION_CD, INT_NO, INT_NM, X/Y",
      "L{region}_crossDetailInfo.xlsx — 맵번호, A/B링 현시별 방향설정코드",
    ],
    unitsNoted: ["일 1회. 좌표계 미기재. WGS84 범위만 좌표로 수용."],
    errorResponses:
      "1 APPLICATION_ERROR, 10 INVALID_REQUEST_PARAMETER_ERROR, 12 NO_OPENAPI_SERVICE_ERROR, 20 SERVICE_ACCESS_DENIED_ERROR, 22 LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR, 30 SERVICE_KEY_IS_NOT_REGISTERED_ERROR, 31 DEADLINE_HAS_EXPIRED_ERROR, 32 UNREGISTERED_IP_ERROR, 99 UNKNOWN_ERROR",
    callLimit: "명세서 30 tps. 파일 다운로드.",
    approvalScope:
      "코드표 L01=서울. 안내 페이지는 온라인 제어기를 인천·대전·대구로 적음. 빈 L01 파일은 서울 계획 없음.",
    notes:
      "2026-09-10 CrossRoadInfoService.hwp. REST GET, JSON 표기이나 상세유형은 다운로드. SSL 없음(공식 샘플 http). 교차로 XY는 횡단 양끝점이 아님. 앱 JSON 프록시는 파일을 받지 않음.",
    mayCall: false,
  },
  {
    id: "utic-plan",
    provider: "UTIC / 도로교통공단",
    title: "교차로계획정보서비스 PlanCrossRoadInfoService",
    status: "documented-openapi",
    catalogUrl: "https://www.utic.go.kr/guide/utisRefSig.do",
    listedEndpoint:
      "http://tsihub.utic.go.kr/tsi/api/PlanCrossRoadInfoService",
    listedOperations: [
      "getPlanCRHDInfo",
      "getPlanCRWDInfo",
      "getPlanCRRSInfo",
      "getPlanCROPInfo",
    ],
    requestFields: ["serviceKey", "type", "numOfRows", "pageNo", "srchCTId", "srchCRNm"],
    responseFieldsNoted: [
      "REGION_CD, INT_NO, INT_NM, INT_PLAN_NO, COLLCT_DTIME",
      "PLAN_DY 1=월…7=일",
      "HOLYDD_PLAN_MM/DD",
      "RESRV_* , RESRV_CONTRL_CD",
      "OPER_PLAN_HH/MI, INT_OPER_CYCLE_VAL, INT_OPER_OFFSET_VAL, A/B_RING_*_PHASE_VAL",
    ],
    unitsNoted: [
      "샘플 주기 180 = A링 77+25+38+40 → 초로 해석",
      "옵셋 기준 시각 없음 → epochMs 만들지 않음",
      "COLLCT_DTIME은 수집시각, currentPlanConfirmedAt 아님",
    ],
    errorResponses: "CrossRoadInfoService와 동일 번호표.",
    callLimit: "명세서 30 tps. 일 1회 갱신.",
    approvalScope: "srchCTId는 코드표 지역만. 키는 UTIC_SERVICE_KEY.",
    notes:
      "2026-09-10 PlanCrossRoadInfoService.hwp. 코드는 https 경로를 쓰되 공식 샘플은 http. 예측 대기에는 쓰지 않음.",
    mayCall: true,
  },
  {
    id: "utic-sigmap",
    provider: "UTIC / 도로교통공단",
    title: "교차로시그널맵정보서비스 SigMapCrossRoadInfoService",
    status: "documented-openapi",
    catalogUrl: "https://www.utic.go.kr/guide/utisRefSig.do",
    listedEndpoint:
      "http://tsihub.utic.go.kr/tsi/api/SigMapCrossRoadInfoService/getSigMapCRInfo",
    listedOperations: ["getSigMapCRInfo"],
    requestFields: ["serviceKey", "type", "numOfRows", "pageNo", "srchCTId", "srchCRNm"],
    responseFieldsNoted: [
      "RING_NO, PLAN_TP, STEP_NO, CAR1–8, PED1–8, MIN_TM, MAX_TM, EOP",
    ],
    unitsNoted: [
      "PLAN_TP 0 일반제, 1–5 시차제(명세서 라벨 중복), 6 보행맵",
      "PED 값 의미(점등/초)는 샘플이 0이라 매핑하지 않음",
    ],
    errorResponses: "CrossRoadInfoService와 동일 번호표.",
    callLimit: "명세서 30 tps. 일 1회 갱신.",
    approvalScope: "별도 서비스 URL. 계획 서비스와 경로가 다름.",
    notes:
      "2026-09-10 같은 HWP 후반. 보행 현시 창으로 쓰지 않음.",
    mayCall: true,
  },
  {
    id: "utic-signal-open",
    provider: "UTIC / 경찰청·한국도로교통공단",
    title: "신호 개방데이터 안내 페이지",
    status: "guide-only",
    catalogUrl: "https://www.utic.go.kr/guide/utisRefSig.do",
    listedEndpoint:
      "http://tsihub.utic.go.kr/tsi/api/PlanCrossRoadInfoService/getPlanCRRSInfo",
    listedOperations: [],
    requestFields: [],
    responseFieldsNoted: [],
    unitsNoted: [],
    errorResponses: "안내 페이지. 오류표는 HWP.",
    callLimit: "해당 없음.",
    approvalScope:
      "2026-09-08 안내: 인천시·대전시·대구시 온라인 제어기. L01 코드 ≠ 서울 데이터 존재.",
    notes: "호출은 utic-plan / utic-sigmap 계약을 쓴다. 이 항목은 안내 URL만.",
    mayCall: false,
  },
  {
    id: "police-crossroad-info",
    provider: "경찰청",
    title: "교차로기반정보서비스 (목록 15056721)",
    status: "listing-unverified",
    catalogUrl: "https://www.data.go.kr/data/15056721/openapi.do",
    listedEndpoint: "http://apis.data.go.kr/1320000/CrossRoadInfoService",
    listedOperations: [],
    requestFields: [],
    responseFieldsNoted: [],
    unitsNoted: [],
    errorResponses: "기술문서 docx 미수집. 오류 코드 미확인.",
    callLimit: "개발계정 10,000 (목록 페이지). 운영 한도는 활용사례 등록 후.",
    approvalScope: "목록상 자동승인. 보행 현시·서울 전 교차로 범위를 문서 없이 단정하지 않음.",
    notes:
      "data.go.kr 1320000 게이트웨이. 수령 HWP는 tsihub CrossRoadInfoService/download 이다. 포털 목록 getCrossRoadInfoList를 tsihub 경로로 바꿔 호출하지 않음.",
    mayCall: false,
  },
  {
    id: "police-plan",
    provider: "경찰청",
    title: "교차로계획정보서비스 (목록 15056569)",
    status: "listing-unverified",
    catalogUrl: "https://www.data.go.kr/data/15056569/openapi.do",
    listedEndpoint: "http://apis.data.go.kr/1320000/PlanCrossRoadInfoService",
    listedOperations: ["getPlanCRHDInfo (목록에 요청주소가 있음)"],
    requestFields: ["type", "srchCTId", "srchCRNm"],
    responseFieldsNoted: ["특수일 계획 필드가 목록 설명에 있음"],
    unitsNoted: [],
    errorResponses: "기술문서 미수집.",
    callLimit: "개발계정 10,000 (목록 페이지).",
    approvalScope: "목록상 자동승인. 현재 적용 중인 계획인지 확인 절차는 별도.",
    notes:
      "data.go.kr 1320000. 계획 필드·오퍼레이션은 tsihub PlanCrossRoadInfoService HWP(utic-plan)로 구현. 이 포털 베이스 URL은 섞지 않음.",
    mayCall: false,
  },
  {
    id: "mois-realtime",
    provider: "행정안전부 한국지역정보개발원",
    title: "교통안전 신호등 실시간 정보 (목록 15157604)",
    status: "listing-unverified",
    catalogUrl: "https://www.data.go.kr/data/15157604/openapi.do",
    listedEndpoint: "https://apis.data.go.kr/B551982/rti",
    listedOperations: [],
    requestFields: ["serviceKey"],
    responseFieldsNoted: [
      "교차로 위경도",
      "방향별 보행신호 잔여시간·점등상태명 (목록 설명)",
    ],
    unitsNoted: ["잔여시간 단위는 오퍼레이션 명세 없음"],
    errorResponses: "미확인.",
    callLimit: "개발계정 5,000 (목록).",
    approvalScope: "지자체 범위·지연은 목록 주의문에 따름. 공식 계획 존재가 아님.",
    notes:
      "베이스 URL만 기록됨. 오퍼레이션 경로를 추측하지 않음. 현재 상태 ≠ 운영계획.",
    mayCall: false,
  },
  {
    id: "national-signal-xls",
    provider: "서울특별시 / 공공데이터포털 파일",
    title: "신호등표준데이터 파일 (목록 15113147)",
    status: "documented-file",
    catalogUrl: "https://www.data.go.kr/data/15113147/fileData.do",
    listedEndpoint: null,
    listedOperations: [],
    requestFields: [],
    responseFieldsNoted: ["신호기위치", "신호등화방식", "신호등종류 (키워드)"],
    unitsNoted: [],
    errorResponses: "해당 없음.",
    callLimit: "파일 다운로드.",
    approvalScope: "포털 파일.",
    notes:
      "시설 위치 목록. 주기·녹색을 만들지 않음. 실제 XLS/컬럼 설명 수령 후 매핑을 확정.",
    mayCall: false,
  },
  {
    id: "seoul-crossing-spatial",
    provider: "서울 공간정보 (미확인 데이터셋)",
    title: "횡단보도 시설물 공간 파일",
    status: "missing-document",
    catalogUrl: "",
    listedEndpoint: null,
    listedOperations: [],
    requestFields: [],
    responseFieldsNoted: [],
    unitsNoted: [],
    errorResponses: "미확인.",
    callLimit: "미확인.",
    approvalScope: "미확인.",
    notes:
      "정확한 서비스 ID·좌표계 문서가 없다. 입력 자리만 둔다. URL을 만들지 않는다.",
    mayCall: false,
  },
];

export function unverifiedContracts(): ProviderContract[] {
  return PROVIDER_CONTRACTS.filter((c) => !c.mayCall);
}
