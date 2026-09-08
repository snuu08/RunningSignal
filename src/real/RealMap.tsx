import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Coord } from "./core.ts";
const empty = { type: "FeatureCollection" as const, features: [] };
export function RealMap({
  coordinates = [],
  position,
  onPick,
  segments,
  fitToken = 0,
}: {
  coordinates?: Coord[];
  segments?: Coord[][];
  position?: Coord | null;
  onPick?: (coord: Coord) => void;
  fitToken?: number;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | null>(null),
    marker = useRef<maplibregl.Marker | null>(null),
    pick = useRef(onPick);
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  pick.current = onPick;
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
      m.addSource("route", { type: "geojson", data: empty });
      m.addLayer({
        id: "route-halo",
        type: "line",
        source: "route",
        paint: { "line-color": "#071d13", "line-width": 9 },
      });
      m.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#b4f6ce", "line-width": 4 },
      });
      setReady(true);
    });
    m.on("error", () =>
      setError(
        "지도를 불러오지 못한 부분이 있어요. 지도 키·허용 도메인·네트워크를 확인해 주세요.",
      ),
    );
    m.on("click", (e) => pick.current?.([e.lngLat.lng, e.lngLat.lat]));
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
        : coordinates.length > 1
          ? {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates },
            }
          : empty,
    );
    const boundsPoints = coordinates.length
      ? coordinates
      : (segments?.flat() ?? []);
    if (boundsPoints.length > 1) {
      const b = new maplibregl.LngLatBounds(boundsPoints[0], boundsPoints[0]);
      boundsPoints.forEach((c) => b.extend(c));
      m.fitBounds(b, { padding: 36, maxZoom: 17, duration: 400 });
    } else if (position) m.easeTo({ center: position, zoom: 15 });
    // GPS ticks should not constantly override a user's map pan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinates, segments, ready, fitToken]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !position) return;
    if (!marker.current)
      marker.current = new maplibregl.Marker({ color: "#fff" })
        .setLngLat(position)
        .addTo(m);
    else marker.current.setLngLat(position);
  }, [position, ready]);
  return (
    <div className="real-map-wrap">
      <div
        className="real-map"
        ref={container}
        aria-label="실제 보행 경로 지도"
      />
      {!key && (
        <div className="map-message">
          지도 연결 준비 중<p>위치 기록과 기록 저장은 사용할 수 있어요.</p>
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
