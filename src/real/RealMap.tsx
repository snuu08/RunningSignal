import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Coord } from "./core.ts";
const empty = { type: "FeatureCollection" as const, features: [] };
function lineData(coordinates: Coord[]) {
  return coordinates.length > 1
    ? {
        type: "Feature" as const,
        properties: {},
        geometry: { type: "LineString" as const, coordinates },
      }
    : empty;
}
export function RealMap({
  coordinates = [],
  position,
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
  pois?: { coord: Coord; name: string }[];
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
    easing = useRef(false);
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  pick.current = onPick;
  pan.current = onUserPan;
  const key = import.meta.env.VITE_MAPTILER_KEY;
  useEffect(() => {
    if (!container.current || !key) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: `https://api.maptiler.com/maps/${encodeURIComponent(import.meta.env.VITE_MAPTILER_STYLE || "dataviz-dark")}/style.json?key=${encodeURIComponent(key)}`,
      center: [127.03, 37.51],
      zoom: 12,
      attributionControl: { compact: true },
    });
    map.current = m;
    m.addControl(
      new maplibregl.NavigationControl({ showCompass: true }),
      "top-right",
    );
    m.on("load", () => {
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
      m.addSource("pois", { type: "geojson", data: empty });
      m.addLayer({
        id: "poi-dots",
        type: "circle",
        source: "pois",
        paint: {
          "circle-radius": 5,
          "circle-color": "#fee500",
          "circle-stroke-color": "#191919",
          "circle-stroke-width": 1,
        },
      });
      setReady(true);
    });
    m.on("error", () =>
      setError(
        "지도를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.",
      ),
    );
    m.on("click", (e) => pick.current?.([e.lngLat.lng, e.lngLat.lat]));
    m.on("dragstart", () => {
      if (!easing.current) pan.current?.();
    });
    m.on("rotatestart", () => {
      if (!easing.current) pan.current?.();
    });
    return () => {
      marker.current?.remove();
      marker.current = null;
      m.remove();
      map.current = null;
      setReady(false);
    };
  }, [key]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource("route") as GeoJSONSource).setData(
      segments?.length
        ? {
            type: "Feature",
            properties: {},
            geometry: { type: "MultiLineString", coordinates: segments },
          }
        : lineData(coordinates),
    );
    (m.getSource("straight") as GeoJSONSource | undefined)?.setData(
      straight ? lineData(straight) : empty,
    );
    (m.getSource("pois") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: pois.map((p) => ({
        type: "Feature" as const,
        properties: { name: p.name },
        geometry: { type: "Point" as const, coordinates: p.coord },
      })),
    });
  }, [coordinates, segments, straight, pois, ready]);
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
    if (!m || !ready || !position) return;
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
      {!key && (
        <div className="map-message">
          <strong>지도를 표시할 수 없어요</strong><p>장소를 검색하거나 자유 러닝을 시작할 수 있어요.</p>
        </div>
      )}
      {error && (
        <p className="map-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
