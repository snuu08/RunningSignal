# Seongnam Signal Pilot

Pilot ID: `seongnam-namhansanseong-sujin-v1`

Direction: `남한산성입구역→수진역`

Current state: 데이터 미검증. `SIGNAL_PUBLIC_PREDICTION=false`, `LIVE_SIGNAL_UI=false`.

## Verified Facts

- Origin Kakao place: 남한산성입구역 8호선, `21160779`, WGS84 `[127.159882577768, 37.4516686968693]`.
- Destination Kakao place: 수진역 8호선, `21160483`, WGS84 `[127.140534508419, 37.4373779787206]`.
- Region is 성남시. 서울 T-DATA must not be used as this pilot's source.
- Reverse direction is not active.

## Not Verified

- TMAP pedestrian LineString for this pilot.
- Crossings along the route.
- Pedestrian signal group IDs.
- Fixed operating plans.
- Epochs.
- Complete coverage.
- Field comparison MAE.

## Why Prediction Is Off

No verified route coverage exists. Unknown wait remains `null`, never `0`.

Activation requires explicit scopes such as `field:<verified-intersection-id>` after field data exists. Do not use one broad pilot ID to include nearby intersections automatically.
