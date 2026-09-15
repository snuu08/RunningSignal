import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { setWorkerUrl } from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  FALLBACK_BASEMAP,
  resolveBasemapStyle,
  supportsWebGl2,
} from "./basemap.ts";
import { api } from "./backend.ts";
import type { Coord } from "./core.ts";
import {
  asLandmark,
  landmarkKindsForZoom,
  type Landmark,
} from "./landmarks.ts";

setWorkerUrl(workerUrl);
const empty = { type: "FeatureCollection" as const, features: [] };
type MapPoint = {
  coord: Coord;
  name: string;
  kind?: "pin" | "origin" | "destination";
};
function lineData(coordinates: Coord[]) {
  return coordinates.length > 1
    ? {
        type: "Feature" as const,
        properties: {},
        geometry: { type: "LineString" as const, coordinates },
      }
    : empty;
}
function pointCollection(
  items: { coord: Coord; name: string; kind: string }[],
) {
  return {
    type: "FeatureCollection" as const,
    features: items.map((p) => ({
      type: "Feature" as const,
      properties: { name: p.name, kind: p.kind },
      geometry: { type: "Point" as const, coordinates: p.coord },
    })),
  };
}
function accuracyData(center?: Coord | null, radiusM?: number | null) {
  if (!center || !radiusM || radiusM <= 0) return empty;
  const points: Coord[] = [];
  const latScale = radiusM / 111_320;
  const lngScale = radiusM / (111_320 * Math.max(0.2, Math.cos((center[1] * Math.PI) / 180)));
  for (let i = 0; i <= 48; i += 1) {
    const angle = (i / 48) * Math.PI * 2;
    points.push([
      center[0] + Math.cos(angle) * lngScale,
      center[1] + Math.sin(angle) * latScale,
    ]);
  }
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: [points] },
  };
}
function overlayFont(m: maplibregl.Map): string[] {
  for (const layer of m.getStyle().layers ?? []) {
    if (layer.type !== "symbol") continue;
    const font = layer.layout?.["text-font"];
    if (Array.isArray(font) && font.every((item) => typeof item === "string"))
      return font as string[];
  }
  return ["Noto Sans Regular"];
}
function addLabeledPoints(
  m: maplibregl.Map,
  source: string,
  dots: string,
  labels: string,
  minzoom: number,
) {
  if (!m.getLayer(dots))
    m.addLayer({
      id: dots,
      type: "circle",
      source,
      minzoom,
      paint: {
        "circle-radius": [
          "match",
          ["get", "kind"],
          "station",
          6,
          "cafe",
          4.5,
          "restaurant",
          4.8,
          "convenience",
          4.4,
          "school",
          5.5,
          "origin",
          7,
          "destination",
          7,
          5,
        ],
        "circle-color": [
          "match",
          ["get", "kind"],
          "station",
          "#8fd0ff",
          "cafe",
          "#e7c27a",
          "restaurant",
          "#ff9f7a",
          "convenience",
          "#9ee6a8",
          "school",
          "#c8b6ff",
          "origin",
          "#b4f6ce",
          "destination",
          "#ff8a80",
          "#fee500",
        ],
        "circle-stroke-color": "#191919",
        "circle-stroke-width": 1,
      },
    });
  if (!m.getLayer(labels))
    m.addLayer({
      id: labels,
      type: "symbol",
      source,
      minzoom,
      layout: {
        "text-field": ["get", "name"],
        "text-font": overlayFont(m),
        "text-size": 11,
        "text-offset": [0, 1.05],
        "text-anchor": "top",
        "text-max-width": 8,
        "text-padding": 2,
        "text-optional": true,
      },
      paint: {
        "text-color": "#f3f4ef",
        "text-halo-color": "#0c0f10",
        "text-halo-width": 1.25,
      },
    });
}
function paintOverlays(m: maplibregl.Map) {
  if (!m.getSource("accuracy")) {
    m.addSource("accuracy", { type: "geojson", data: empty });
    m.addLayer({
      id: "accuracy-fill",
      type: "fill",
      source: "accuracy",
      paint: {
        "fill-color": "#8fd0ff",
        "fill-opacity": 0.14,
        "fill-outline-color": "#8fd0ff",
      },
    });
  }
  if (!m.getSource("straight")) {
    m.addSource("straight", { type: "geojson", data: empty });
    m.addLayer({
      id: "straight-line",
      type: "line",
      source: "straight",
      paint: {
        "line-color": "#8ea39a",
        "line-width": 2,
        "line-dasharray": [2, 2],
      },
    });
  }
  if (!m.getSource("route")) {
    m.addSource("route", { type: "geojson", data: empty });
    m.addLayer({
      id: "route-halo",
      type: "line",
      source: "route",
      paint: { "line-color": "#262a0e", "line-width": 9 },
    });
    m.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#e5f45c", "line-width": 4 },
    });
  }
  if (!m.getSource("pois")) m.addSource("pois", { type: "geojson", data: empty });
  addLabeledPoints(m, "pois", "poi-dots", "poi-labels", 11);
  if (!m.getSource("landmarks"))
    m.addSource("landmarks", { type: "geojson", data: empty });
  addLabeledPoints(m, "landmarks", "landmark-dots", "landmark-labels", 12);
}
function writeOverlays(
  m: maplibregl.Map,
  data: {
    coordinates: Coord[];
    segments?: Coord[][];
    straight?: [Coord, Coord] | null;
    pois: MapPoint[];
    position?: Coord | null;
    positionAccuracyM?: number | null;
  },
) {
  (m.getSource("route") as GeoJSONSource | undefined)?.setData(
    data.segments?.length
      ? {
          type: "Feature",
          properties: {},
          geometry: { type: "MultiLineString", coordinates: data.segments },
        }
      : lineData(data.coordinates),
  );
  (m.getSource("straight") as GeoJSONSource | undefined)?.setData(
    data.straight ? lineData(data.straight) : empty,
  );
  (m.getSource("pois") as GeoJSONSource | undefined)?.setData(
    pointCollection(data.pois.map((p) => ({ ...p, kind: p.kind ?? "pin" }))),
  );
  (m.getSource("accuracy") as GeoJSONSource | undefined)?.setData(
    accuracyData(data.position, data.positionAccuracyM),
  );
}
function writeLandmarks(m: maplibregl.Map, items: Landmark[]) {
  (m.getSource("landmarks") as GeoJSONSource | undefined)?.setData(
    pointCollection(items),
  );
}
async function loadLandmarks(
  center: Coord,
  radiusM: number,
  kinds: string,
  signal: AbortSignal,
) {
  try {
    const data = await api<{ landmarks: unknown[] }>(
      `landmarks?x=${center[0]}&y=${center[1]}&radius=${Math.round(radiusM)}&kinds=${kinds}`,
      undefined,
      signal,
    );
    return (data.landmarks ?? []).flatMap((row) => {
      const item = asLandmark(row);
      return item ? [item] : [];
    });
  } catch {
    return [];
  }
}

function restrictedBasemap(error: unknown) {
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: number }).status)
      : 0;
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: string }).message)
        : String(error ?? "");
  return status === 401 || status === 403 || /403|401|restricted|unauthorized|forbidden/i.test(message);
}
export function RealMap({
  coordinates = [],
  position,
  positionAccuracyM,
  onPick,
  segments,
  straight,
  pois = [],
  fitToken = 0,
  follow = false,
  heading = null,
  onUserPan,
}: {
  coordinates?: Coord[];
  segments?: Coord[][];
  position?: Coord | null;
  onPick?: (coord: Coord) => void;
  straight?: [Coord, Coord] | null;
  pois?: MapPoint[];
  positionAccuracyM?: number | null;
  fitToken?: number | string;
  follow?: boolean;
  heading?: number | null;
  onUserPan?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | null>(null),
    marker = useRef<maplibregl.Marker | null>(null),
    pick = useRef(onPick),
    pan = useRef(onUserPan),
    easing = useRef(false),
    overlay = useRef({ coordinates, segments, straight, pois, position, positionAccuracyM }),
    landmarks = useRef<Landmark[]>([]);
  overlay.current = { coordinates, segments, straight, pois, position, positionAccuracyM };
  const followRef = useRef(follow);
  followRef.current = follow;
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [unavailable, setUnavailable] = useState(false);
  pick.current = onPick;
  pan.current = onUserPan;
  const key = import.meta.env.VITE_MAPTILER_KEY;
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const ctrl = new AbortController();
    let m: maplibregl.Map | null = null;
    let observer: ResizeObserver | null = null;
    let switched = false;
    let landmarkTimer = 0;
    let landmarkAbort: AbortController | null = null;
    void (async () => {
      let style = FALLBACK_BASEMAP;
      try {
        style = await resolveBasemapStyle(key, fetch, ctrl.signal);
      } catch {
        if (ctrl.signal.aborted) return;
      }
      if (ctrl.signal.aborted || !container.current) return;
      if (!supportsWebGl2()) {
        setUnavailable(true);
        setError("이 기기에서는 지도를 표시할 수 없어요. 장소 검색으로 출발지와 목적지를 지정해 주세요.");
        return;
      }
      try {
        m = new maplibregl.Map({
          container: container.current,
          style,
          center: [127.03, 37.51],
          zoom: 13,
          attributionControl: { compact: true },
        });
      } catch {
        setUnavailable(true);
        setError("지도를 시작하지 못했어요. 장소 검색으로 출발지와 목적지를 지정해 주세요.");
        return;
      }
      map.current = m;
      m.addControl(
        new maplibregl.NavigationControl({ showCompass: true }),
        "top-right",
      );
      const refreshLandmarks = () => {
        if (!m) return;
        window.clearTimeout(landmarkTimer);
        landmarkTimer = window.setTimeout(() => {
          if (!m || ctrl.signal.aborted) return;
          const kinds = landmarkKindsForZoom(m.getZoom());
          if (!kinds.length) {
            landmarks.current = [];
            writeLandmarks(m, []);
            return;
          }
          const center = m.getCenter();
          const radius = Math.min(
            1800,
            Math.max(280, center.distanceTo(m.getBounds().getSouthWest())),
          );
          landmarkAbort?.abort();
          landmarkAbort = new AbortController();
          const request = landmarkAbort;
          void loadLandmarks(
            [center.lng, center.lat],
            radius,
            kinds.join(","),
            request.signal,
          ).then((items) => {
            if (request.signal.aborted || !m) return;
            landmarks.current = items;
            writeLandmarks(m, items);
          });
        }, followRef.current ? 8000 : 450);
      };
      const showOverlays = () => {
        if (!m) return;
        paintOverlays(m);
        writeOverlays(m, overlay.current);
        writeLandmarks(m, landmarks.current);
        m.resize();
        setReady(true);
        setError("");
        refreshLandmarks();
      };
      m.on("load", showOverlays);
      m.on("style.load", showOverlays);
      m.on("moveend", refreshLandmarks);
      m.on("error", (event) => {
        if (ctrl.signal.aborted || !m) return;
        if (!switched && style !== FALLBACK_BASEMAP && restrictedBasemap(event.error)) {
          switched = true;
          m.setStyle(FALLBACK_BASEMAP);
          return;
        }
        if (!m.isStyleLoaded())
          setError(
            "지도를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.",
          );
      });
      m.on("click", (e) => pick.current?.([e.lngLat.lng, e.lngLat.lat]));
      m.on("dragstart", () => {
        if (!easing.current) pan.current?.();
      });
      m.on("rotatestart", () => {
        if (!easing.current) pan.current?.();
      });
      observer = new ResizeObserver(() => m?.resize());
      observer.observe(node);
      m.resize();
    })();
    return () => {
      ctrl.abort();
      landmarkAbort?.abort();
      window.clearTimeout(landmarkTimer);
      observer?.disconnect();
      marker.current?.remove();
      marker.current = null;
      m?.remove();
      map.current = null;
      setReady(false);
    };
  }, [key]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    writeOverlays(m, overlay.current);
  }, [coordinates, segments, straight, pois, position, positionAccuracyM, ready]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || follow) return;
    const boundsPoints = [...coordinates, ...(segments?.flat() ?? [])];
    if (!boundsPoints.length) boundsPoints.push(...pois.map((p) => p.coord));
    if (boundsPoints.length > 1) {
      const b = new maplibregl.LngLatBounds(boundsPoints[0], boundsPoints[0]);
      boundsPoints.forEach((c) => b.extend(c));
      m.fitBounds(b, { padding: 36, maxZoom: 17, duration: 400 });
    } else if (position) m.easeTo({ center: position, zoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinates, segments, ready, fitToken, follow]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    if (!position) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current)
      marker.current = new maplibregl.Marker({ color: "#fff" })
        .setLngLat(position)
        .addTo(m);
    else marker.current.setLngLat(position);
    if (follow) {
      easing.current = true;
      m.easeTo({
        center: position,
        zoom: Math.max(m.getZoom(), 16),
        bearing: heading ?? m.getBearing(),
        pitch: 50,
        duration: 400,
      });
      window.setTimeout(() => {
        easing.current = false;
      }, 450);
    }
  }, [position, heading, follow, ready]);
  return (
    <div className="real-map-wrap">
      <div
        className="real-map"
        ref={container}
        aria-label="실제 보행 경로 지도"
      />
      {!unavailable && <div className="map-legend" aria-hidden="true">
        {pois.some((p) => p.kind === "origin") && <span className="lg-origin">출발</span>}
        {pois.some((p) => p.kind === "destination") && <span className="lg-destination">도착</span>}
        <span className="lg-station">지하철</span>
        <span className="lg-cafe">카페</span>
        <span className="lg-food">음식점</span>
        <span className="lg-store">편의점</span>
      </div>}
      {unavailable ? (
        <div className="map-message" role="status">
          <strong>지도 없이도 계속할 수 있어요.</strong>
          <p>{error}</p>
        </div>
      ) : error && (
        <p className="map-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
