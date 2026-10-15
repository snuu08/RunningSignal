import { describe, expect, it } from "vitest";
import {
  localLandmarkPlaces,
  mergeAndRankPlaces,
  normalizePlaceText,
  scorePlace,
  type SearchPlace,
} from "./place-ranking.ts";

const context = {
  query: "성남시청",
  bias: [126.92277, 37.57961] as [number, number],
};

describe("place ranking", () => {
  it("normalizes whitespace and punctuation for Korean place names", () => {
    expect(normalizePlaceText("성남 시청·본청")).toBe("성남시청본청");
  });

  it("keeps representative city hall above branch-like nearby businesses", () => {
    const bodyguard: SearchPlace = {
      id: "kakao:near",
      name: "보디가드 성남시청점",
      address: "경기도 성남시 수정구",
      coord: [127.124, 37.42],
      category: "가정,생활 > 패션 > 속옷",
      distanceM: 200,
      originalIndex: 0,
      source: "kakao-distance",
    };
    const cityHall: SearchPlace = {
      id: "kakao:cityhall",
      name: "성남시청",
      address: "경기도 성남시 중원구 성남대로 997",
      coord: [127.12628813511819, 37.41993055742254],
      category: "사회,공공기관 > 지방행정기관 > 시청",
      distanceM: 900,
      originalIndex: 4,
      source: "kakao-keyword",
    };

    expect(scorePlace(cityHall, context)).toBeGreaterThan(
      scorePlace(bodyguard, context),
    );
    expect(mergeAndRankPlaces([bodyguard, cityHall], context)[0].name).toBe(
      "성남시청",
    );
  });

  it("uses local representative landmarks when a provider misses them", () => {
    const places = mergeAndRankPlaces(
      [
        ...localLandmarkPlaces("성남시청", context.bias),
        {
          id: "kakao:branch",
          name: "보디가드 성남시청점",
          coord: [127.124, 37.42],
          source: "kakao-distance",
        },
      ],
      context,
    );

    expect(places[0]).toMatchObject({
      id: "local:seongnam-city-hall",
      name: "성남시청",
    });
  });

  it("allows explicit subfacility searches to prefer the subfacility term", () => {
    const parking: SearchPlace = {
      id: "parking",
      name: "성남시청 주차장",
      coord: [127.126, 37.42],
      source: "kakao-keyword",
    };
    const cityHall = localLandmarkPlaces("성남시청 주차장", context.bias)[0];

    expect(scorePlace(parking, { ...context, query: "성남시청 주차장" })).toBeGreaterThan(
      scorePlace(cityHall, { ...context, query: "성남시청 주차장" }),
    );
  });
});
