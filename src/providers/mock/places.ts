import { NETWORKS } from "../../data/demo/networks.ts";
import { snapToNearestNode } from "../../domain/pathfinding.ts";
import type { LocalMetersPoint, PlaceRef, RegionId } from "../../domain/models.ts";
import type { PlaceProvider } from "../contracts/index.ts";

export function createMockPlaces(): PlaceProvider {
  return {
    search(regionId, query) {
      const q = query.trim().toLowerCase();
      if (!q) return NETWORKS[regionId].places;
      return NETWORKS[regionId].places.filter(
        (p) => p.label.toLowerCase().includes(q) || p.placeId.toLowerCase().includes(q),
      );
    },
    getNetwork(regionId) {
      return NETWORKS[regionId];
    },
    fromNode(regionId, nodeId, label) {
      const network = NETWORKS[regionId];
      const place = network.places.find((p) => p.nodeId === nodeId);
      if (place) return place;
      const node = network.nodes[nodeId];
      return {
        placeId: `${regionId}:node:${nodeId}`,
        label: label ?? "지도에서 고른 지점",
        point: node.point,
        nodeId,
        source: "demo",
      };
    },
    fromPoint(regionId: RegionId, point: LocalMetersPoint, label: string): PlaceRef {
      const network = NETWORKS[regionId];
      const nodeId = snapToNearestNode(network, point.x, point.y);
      return this.fromNode(regionId, nodeId, label);
    },
    demoStart(regionId) {
      const network = NETWORKS[regionId];
      return this.fromNode(regionId, network.demoStartNodeId, "데모 시작 위치");
    },
  };
}
