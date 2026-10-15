# Gangnam Exit 1 to Kukkiwon Demo Pilot

Pilot ID: `gangnam-exit1-kukkiwon-v1`

Purpose: short promo route for “same destination, different rhythm.”

## Verified

- Origin: 강남역 2호선 1번출구.
- Destination: 국기원.
- TMAP pedestrian route exists.
- Route distance: 626m.
- TMAP route includes one crossing candidate near `쿡앤쑈`, at about 214m.

## Not Verified

- Actual crossing entry/exit endpoints.
- Seoul T-DATA intersection ID.
- Pedestrian signal group.
- Operating plan.
- Epoch.
- Complete coverage.
- Whether Flow Run hits green at filming time.

## Demo Use

Safe claim:

> 같은 목적지에서 Flow Run은 신호 대기 가능성을 고려하는 경로 추천을 목표로 합니다.

Unsafe claim until field verified:

> Flow Run이 실제로 초록불을 맞춰준다.

## Field Steps

1. Film KakaoMap route to same destination.
2. Film Flow Run route from this route file.
3. At the crossing candidate, record signal state and song continuity.
4. Repeat at least 5 runs for promo proof, 10 cycles for data proof.
5. If timing is favorable, write observations into `field-observation.csv`.
