import { meters, type Coord, type Place } from "./core.ts";

export type PlaceSource = "local" | "kakao-keyword" | "kakao-distance" | "kakao-address";

export type SearchPlace = Place & {
  aliases?: string[];
  category?: string;
  distanceM?: number;
  originalIndex?: number;
  source?: PlaceSource;
};

export type PlaceRankingContext = {
  query: string;
  bias?: Coord | null;
};

const LOCAL_LANDMARKS: SearchPlace[] = [
  {
    id: "local:mju-humanities-campus",
    name: "명지대학교 인문캠퍼스",
    aliases: ["명지대 인문캠퍼스", "명지대학교", "명지대", "MJU", "Myongji University"],
    address: "서울특별시 서대문구 거북골로 34",
    coord: [126.92277, 37.57961],
    category: "school",
    source: "local",
  },
  {
    id: "local:myongji-university-social-science-campus",
    name: "Myongji University Social Science Campus",
    aliases: ["MJU Social Science Campus", "명지대학교 인문캠퍼스"],
    address: "34 Geobukgol-ro, Seodaemun-gu, Seoul",
    coord: [126.92277, 37.57961],
    category: "school",
    source: "local",
  },
  {
    id: "local:seongnam-city-hall",
    name: "성남시청",
    aliases: ["성남 시청", "Seongnam City Hall"],
    address: "경기도 성남시 중원구 성남대로 997",
    coord: [127.12628813511819, 37.41993055742254],
    category: "public-office",
    source: "local",
  },
];

const REPRESENTATIVE_CATEGORY_HINTS = [
  "공공기관",
  "관공서",
  "시청",
  "구청",
  "군청",
  "읍사무소",
  "면사무소",
  "동주민센터",
  "학교",
  "대학교",
  "대학",
  "교통",
  "지하철",
  "역",
];

const SUBFACILITY_TERMS = [
  "점",
  "지점",
  "센터",
  "민원실",
  "주차장",
  "주차",
  "출입구",
  "정문",
  "후문",
  "별관",
  "의회",
  "노동조합",
  "매점",
  "카페",
  "식당",
  "은행",
  "atm",
];

const ADDRESS_TOKENS = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|특별시|광역시|특별자치시|특별자치도|도|시|군|구|읍|면|동|리)$/;

export function normalizePlaceText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[()[\]{}·.,/\\_\-:;'"`~!@#$%^&*+=?|<>]/g, "")
    .replace(/\s+/g, "");
}

function queryTokens(query: string): string[] {
  return query
    .normalize("NFKC")
    .toLowerCase()
    .split(/[\s()[\]{}·.,/\\_\-:;'"`~!@#$%^&*+=?|<>]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !ADDRESS_TOKENS.test(item));
}

function placeTexts(place: SearchPlace): string[] {
  return [place.name, place.address, ...(place.aliases ?? [])].filter(
    (value): value is string => !!value,
  );
}

function bestTextMatch(place: SearchPlace, query: string) {
  const q = normalizePlaceText(query);
  const tokens = queryTokens(query).map(normalizePlaceText);
  let exact = false;
  let startsWith = false;
  let contains = false;
  let tokenHits = 0;
  for (const text of placeTexts(place)) {
    const t = normalizePlaceText(text);
    exact ||= t === q;
    startsWith ||= t.startsWith(q) || q.startsWith(t);
    contains ||= t.includes(q) || q.includes(t);
    tokenHits = Math.max(
      tokenHits,
      tokens.filter((token) => t.includes(token)).length,
    );
  }
  return { exact, startsWith, contains, tokenHits, tokenCount: tokens.length };
}

function wantsSubfacility(query: string) {
  const q = normalizePlaceText(query);
  return SUBFACILITY_TERMS.some((term) => q.includes(normalizePlaceText(term)));
}

function hasSubfacilityName(place: SearchPlace) {
  const name = normalizePlaceText(place.name);
  return (
    /(점|지점)$/.test(name) ||
    /(민원실|주차장|주차|출입구|정문|후문|별관|노동조합|매점|카페|식당|은행|atm)/i.test(name)
  );
}

function hasRepresentativeCategory(place: SearchPlace) {
  const category = normalizePlaceText(`${place.category ?? ""} ${place.name}`);
  return REPRESENTATIVE_CATEGORY_HINTS.some((hint) =>
    category.includes(normalizePlaceText(hint)),
  );
}

export function scorePlace(place: SearchPlace, context: PlaceRankingContext) {
  const match = bestTextMatch(place, context.query);
  let score = 0;
  if (place.source === "local") score += 5_000;
  if (match.exact) score += 10_000;
  if (match.startsWith) score += 2_000;
  if (match.contains) score += 1_000;
  score += match.tokenHits * 250;
  if (match.tokenCount > 0 && match.tokenHits === match.tokenCount) score += 750;
  if (hasRepresentativeCategory(place)) score += 650;
  if (place.source === "kakao-keyword") score += 180;
  if (place.source === "kakao-address") score += 120;
  if (place.source === "kakao-distance") score += 40;
  if (hasSubfacilityName(place) && !wantsSubfacility(context.query)) score -= 2_400;
  if (context.bias) {
    const distance = place.distanceM ?? meters(place.coord, context.bias);
    score += Math.max(0, 260 - Math.min(distance, 2_600) / 10);
  }
  score -= (place.originalIndex ?? 0) * 2;
  return score;
}

function isDuplicatePlace(a: SearchPlace, b: SearchPlace) {
  if (a.id && b.id && a.id === b.id) return true;
  const sameName = normalizePlaceText(a.name) === normalizePlaceText(b.name);
  const sameAddress =
    !!a.address &&
    !!b.address &&
    normalizePlaceText(a.address) === normalizePlaceText(b.address);
  const close = meters(a.coord, b.coord) <= 35;
  return (sameName && close) || (sameAddress && close);
}

function richerPlace(a: SearchPlace, b: SearchPlace, context: PlaceRankingContext) {
  const aScore = scorePlace(a, context);
  const bScore = scorePlace(b, context);
  if (Math.abs(aScore - bScore) > 100) return aScore >= bScore ? a : b;
  if (a.source === "local" && b.source !== "local") return { ...a, id: b.id || a.id };
  if (b.source === "local" && a.source !== "local") return { ...b, id: a.id || b.id };
  return aScore >= bScore ? a : b;
}

export function localLandmarkPlaces(query: string, bias?: Coord | null): SearchPlace[] {
  const q = normalizePlaceText(query);
  const queryHasMju = q.includes("명지대") || q.includes("mju") || q.includes("myongji");
  return LOCAL_LANDMARKS.filter((place) => {
    const texts = placeTexts(place).map(normalizePlaceText);
    return (
      texts.some((text) => text.includes(q) || q.includes(text)) ||
      (queryHasMju && place.id.includes("mju"))
    );
  })
    .map((place, originalIndex) => ({ ...place, originalIndex }))
    .sort((a, b) => {
      const scoreDiff =
        scorePlace(b, { query, bias }) - scorePlace(a, { query, bias });
      if (scoreDiff !== 0) return scoreDiff;
      return bias ? meters(a.coord, bias) - meters(b.coord, bias) : 0;
    });
}

export function mergeAndRankPlaces(
  places: SearchPlace[],
  context: PlaceRankingContext,
): Place[] {
  const merged: SearchPlace[] = [];
  for (const place of places) {
    const duplicate = merged.findIndex((item) => isDuplicatePlace(item, place));
    if (duplicate < 0) {
      merged.push(place);
      continue;
    }
    merged[duplicate] = richerPlace(merged[duplicate], place, context);
  }
  return merged
    .sort((a, b) => scorePlace(b, context) - scorePlace(a, context))
    .map(({ aliases: _aliases, category: _category, distanceM: _distanceM, originalIndex: _originalIndex, source: _source, ...place }) => place);
}
