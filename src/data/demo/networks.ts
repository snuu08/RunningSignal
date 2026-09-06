import { localPoint, polylineLength, curvePoints } from "../../domain/geo.ts";
import type {
  GraphEdge,
  GraphNode,
  LocalMetersPoint,
  MapFeature,
  PlaceRef,
  RegionId,
  WalkKind,
  WalkingNetwork,
} from "../../domain/models.ts";

const XS = [160, 520, 880, 1240, 1600, 1960, 2320] as const;
const YS = [160, 480, 800, 1120, 1440, 1760] as const;
const BRIDGE_X = new Set([520, 1960]);
const RIVER_TOP = 800;
const RIVER_BOTTOM = 1120;
const GEOMETRY_VERSION = 1;

const PLACE_NAMES: Record<RegionId, Record<string, string>> = {
  seoul: {
    cafe: "카페거리",
    hall: "시청 앞",
    park: "공원 쉼터",
    riverN: "한강공원 북단",
    riverS: "한강공원 남단",
    ttuk: "뚝섬 산책",
    namsan: "남산 둘레 입구",
  },
  incheon: {
    cafe: "개항로 카페",
    hall: "시청 광장",
    park: "중앙공원 쉼터",
    riverN: "해안 산책 북",
    riverS: "해안 산책 남",
    ttuk: "월미 산책",
    namsan: "송도 둘레 입구",
  },
  daegu: {
    cafe: "동성로 카페",
    hall: "시청 앞",
    park: "국채보상 공원",
    riverN: "신천 북단",
    riverS: "신천 남단",
    ttuk: "수성못 산책",
    namsan: "앞산 둘레 입구",
  },
  seongnam: {
    cafe: "서현 카페거리",
    hall: "시청 앞",
    park: "분당 중앙공원",
    riverN: "탄천 북단",
    riverS: "탄천 남단",
    ttuk: "정자 산책",
    namsan: "율동 둘레 입구",
  },
};

function nid(x: number, y: number): string {
  return `n:${x}:${y}`;
}

function addNode(
  nodes: Record<string, GraphNode>,
  id: string,
  x: number,
  y: number,
  kind: GraphNode["kind"],
): void {
  nodes[id] = { id, point: localPoint(x, y), kind };
}

function edgeOf(
  id: string,
  from: GraphNode,
  to: GraphNode,
  walkKind: WalkKind,
  geometry?: LocalMetersPoint[],
  flags?: { stairs?: boolean; overpass?: boolean; walkable?: boolean },
): GraphEdge {
  const geom = geometry ?? [from.point, to.point];
  return {
    id,
    from: from.id,
    to: to.id,
    lengthM: polylineLength(geom),
    geometry: geom,
    walkable: flags?.walkable ?? true,
    walkKind,
    isStairs: flags?.stairs ?? walkKind === "stairs",
    isOverpass: flags?.overpass ?? walkKind === "overpass",
    geometryVersion: GEOMETRY_VERSION,
  };
}

function crossesRiver(y1: number, y2: number): boolean {
  const lo = Math.min(y1, y2);
  const hi = Math.max(y1, y2);
  return lo <= RIVER_TOP && hi >= RIVER_BOTTOM;
}

export function buildNetwork(regionId: RegionId): WalkingNetwork {
  const nodes: Record<string, GraphNode> = {};
  const edges: Record<string, GraphEdge> = {};

  for (const x of XS) {
    for (const y of YS) {
      addNode(nodes, nid(x, y), x, y, "intersection");
    }
  }

  addNode(nodes, "parkA", 700, 300, "park");
  addNode(nodes, "parkB", 1060, 250, "park");
  addNode(nodes, "parkC", 1480, 330, "park");
  addNode(nodes, "parkMid", 1240, 320, "park");
  addNode(nodes, "zig1", 2140, 220, "alley");
  addNode(nodes, "zig2", 2300, 300, "alley");
  addNode(nodes, "zig3", 2140, 380, "alley");
  addNode(nodes, "zig4", 2300, 460, "alley");

  let edgeSerial = 0;
  const link = (
    a: string,
    b: string,
    kind: WalkKind,
    geometry?: LocalMetersPoint[],
    flags?: { stairs?: boolean; overpass?: boolean; walkable?: boolean },
  ) => {
    const from = nodes[a];
    const to = nodes[b];
    const id = `e${edgeSerial}`;
    edgeSerial += 1;
    edges[id] = edgeOf(id, from, to, kind, geometry, flags);
  };

  for (const y of YS) {
    for (let i = 0; i < XS.length - 1; i += 1) {
      if (y > RIVER_TOP && y < RIVER_BOTTOM) continue;
      link(nid(XS[i], y), nid(XS[i + 1], y), "sidewalk");
    }
  }

  for (const x of XS) {
    for (let i = 0; i < YS.length - 1; i += 1) {
      const y1 = YS[i];
      const y2 = YS[i + 1];
      if (crossesRiver(y1, y2) && !BRIDGE_X.has(x)) continue;
      const kind: WalkKind = crossesRiver(y1, y2) ? "bridge" : "sidewalk";
      link(nid(x, y1), nid(x, y2), kind);
    }
  }

  link("n:880:160", "parkA", "park_path", curvePoints(nodes["n:880:160"].point, localPoint(760, 180), nodes.parkA.point, 7));
  link("parkA", "parkB", "park_path", curvePoints(nodes.parkA.point, localPoint(880, 220), nodes.parkB.point, 8));
  link("parkB", "parkC", "park_path", curvePoints(nodes.parkB.point, localPoint(1280, 220), nodes.parkC.point, 8));
  link("n:880:480", "parkA", "park_path");
  link(
    "n:880:480",
    "parkMid",
    "park_path",
    curvePoints(nodes["n:880:480"].point, localPoint(1040, 360), nodes.parkMid.point, 8),
  );
  link(
    "parkMid",
    "n:1600:480",
    "park_path",
    curvePoints(nodes.parkMid.point, localPoint(1440, 360), nodes["n:1600:480"].point, 8),
  );

  link("n:1960:160", "zig1", "alley");
  link("zig1", "zig2", "alley");
  link("zig2", "zig3", "alley");
  link("zig3", "zig4", "alley");
  link("zig4", "n:1960:480", "alley");
  link("n:2320:160", "zig2", "alley");

  link("n:1240:160", "n:1600:480", "stairs", undefined, { stairs: true });

  const features: MapFeature[] = [
    {
      kind: "river",
      id: "river",
      polygon: [
        localPoint(0, 860),
        localPoint(2480, 860),
        localPoint(2480, 1060),
        localPoint(0, 1060),
      ],
    },
    {
      kind: "park",
      id: "park",
      polygon: [
        localPoint(620, 180),
        localPoint(1540, 160),
        localPoint(1580, 400),
        localPoint(640, 420),
      ],
    },
  ];

  for (let i = 0; i < XS.length - 1; i += 1) {
    for (let j = 0; j < YS.length - 1; j += 1) {
      const x1 = XS[i];
      const y1 = YS[j];
      const x2 = XS[i + 1];
      const y2 = YS[j + 1];
      if (y1 >= RIVER_TOP && y2 <= RIVER_BOTTOM) continue;
      if (x1 >= 620 && x2 <= 1580 && y1 <= 480 && y2 >= 160) continue;
      features.push({
        kind: "block",
        id: `b${i}-${j}`,
        polygon: [
          localPoint(x1 + 28, y1 + 28),
          localPoint(x2 - 28, y1 + 28),
          localPoint(x2 - 28, y2 - 28),
          localPoint(x1 + 28, y2 - 28),
        ],
      });
    }
  }

  const names = PLACE_NAMES[regionId];
  const place = (placeId: string, label: string, nodeId: string): PlaceRef => ({
    placeId: `${regionId}:${placeId}`,
    label,
    point: nodes[nodeId].point,
    nodeId,
    source: "demo",
  });

  const places: PlaceRef[] = [
    place("cafe", names.cafe, "n:880:160"),
    place("hall", names.hall, "n:1600:480"),
    place("park", names.park, "parkB"),
    place("riverN", names.riverN, "n:520:800"),
    place("riverS", names.riverS, "n:520:1120"),
    place("ttuk", names.ttuk, "n:1960:1440"),
    place("namsan", names.namsan, "n:2320:1760"),
  ];

  return {
    regionId,
    bounds: { minX: 0, minY: 0, maxX: 2480, maxY: 1920 },
    nodes,
    edges,
    features,
    places,
    demoStartNodeId: "n:880:160",
    geometryVersion: GEOMETRY_VERSION,
    source: "demo",
  };
}

export const NETWORKS: Record<RegionId, WalkingNetwork> = {
  seoul: buildNetwork("seoul"),
  incheon: buildNetwork("incheon"),
  daegu: buildNetwork("daegu"),
  seongnam: buildNetwork("seongnam"),
};
