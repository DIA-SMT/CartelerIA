"use client";

import { Fragment, useEffect } from "react";
import { Circle, CircleMarker, GeoJSON, MapContainer, ScaleControl, TileLayer, Tooltip, useMap, ZoomControl } from "react-leaflet";
import type { AnalyzedCartel, FeatureCollection, GeoLine, GeoPoint } from "@/data/territorial";
import { ALLOWED_PLACE_REVIEW_BUFFER_M, administrativeColors, administrativeLabels, getAdministrativeVisualStatus } from "@/data/territorial";

function Recenter({ selected }: { selected: AnalyzedCartel | null }) {
  const map = useMap();
  useEffect(() => {
    if (!selected) return;
    const [longitude, latitude] = selected.geometry.coordinates;
    map.flyTo([latitude, longitude], 16, { duration: .8 });
  }, [selected, map]);
  return null;
}

export default function CarteleriaMap({ carteles, corridors, allowedPlaces, selected, onSelect }: {
  carteles: AnalyzedCartel[];
  corridors: FeatureCollection<GeoLine>;
  allowedPlaces: FeatureCollection<GeoPoint>;
  selected: AnalyzedCartel | null;
  onSelect: (point: AnalyzedCartel) => void;
}) {
  const isolatedPlaces = allowedPlaces.features.filter(place => distanceToCorridors(place.geometry.coordinates, corridors) > ALLOWED_PLACE_REVIEW_BUFFER_M);
  return <MapContainer center={[-26.8304, -65.2145]} zoom={13} className="h-full w-full" zoomControl={false} scrollWheelZoom>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
    {/* key fuerza el remount cuando los corredores pasan de vacío→cargados:
        <GeoJSON> solo lee `data` al montarse e ignora cambios del prop. */}
    <GeoJSON key={`corridors-${corridors.features.length}`} data={corridors as never} style={{ color: "#16a34a", weight: 5, opacity: .8 }}/>
    {isolatedPlaces.map((place, index) => {
      const [longitude, latitude] = place.geometry.coordinates;
      const label = String(place.properties.description || place.properties.name || "Lugar permitido aislado");
      return <Fragment key={`allowed-area-${String(place.properties.id ?? index)}`}>
        <Circle center={[latitude, longitude]} radius={ALLOWED_PLACE_REVIEW_BUFFER_M} pathOptions={{ color: "#22c55e", weight: 2, fillColor: "#4ade80", fillOpacity: .18, opacity: .72 }}><Tooltip direction="top"><strong>Área de lugar permitido</strong><br/>{label}<br/>Radio de referencia: {ALLOWED_PLACE_REVIEW_BUFFER_M} m</Tooltip></Circle>
        <Circle center={[latitude, longitude]} radius={ALLOWED_PLACE_REVIEW_BUFFER_M * .48} interactive={false} pathOptions={{ stroke: false, fillColor: "#ffffff", fillOpacity: .22 }}/>
      </Fragment>;
    })}
    {carteles.map(cartel => {
      const [longitude, latitude] = cartel.geometry.coordinates;
      const active = selected?.properties.id === cartel.properties.id;
      const visualStatus = getAdministrativeVisualStatus(cartel);
      return <CircleMarker key={String(cartel.properties.id)} center={[latitude, longitude]} radius={active ? 11 : 7} pathOptions={{ color: "white", weight: active ? 4 : 2, fillColor: administrativeColors[visualStatus], fillOpacity: 1 }} eventHandlers={{ click: () => onSelect(cartel) }}>
        <Tooltip direction="top" offset={[0, -7]}><strong>{cartel.properties.name || "Cartel relevado"}</strong><br/>{administrativeLabels[visualStatus]}<br/>{Math.round(Number(cartel.properties.distanceToCorridorM || 0))} m del corredor más cercano</Tooltip>
      </CircleMarker>;
    })}
    <Recenter selected={selected}/>
    <ZoomControl position="bottomright"/><ScaleControl position="bottomleft" imperial={false}/>
  </MapContainer>;
}

function distanceToCorridors(point: [number, number], corridors: FeatureCollection<GeoLine>) {
  let minimum = Number.POSITIVE_INFINITY;
  corridors.features.forEach(feature => {
    const lines = feature.geometry.type === "LineString"
      ? [feature.geometry.coordinates as [number, number][]]
      : feature.geometry.coordinates as [number, number][][];
    lines.forEach(line => {
      for (let index = 1; index < line.length; index += 1) minimum = Math.min(minimum, pointToSegmentMeters(point, line[index - 1], line[index]));
    });
  });
  return minimum;
}

function pointToSegmentMeters(point: [number, number], start: [number, number], end: [number, number]) {
  const latitude = point[1] * Math.PI / 180;
  const scaleX = 111320 * Math.cos(latitude);
  const scaleY = 110540;
  const px = point[0] * scaleX, py = point[1] * scaleY;
  const ax = start[0] * scaleX, ay = start[1] * scaleY;
  const bx = end[0] * scaleX, by = end[1] * scaleY;
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const position = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + position * dx), py - (ay + position * dy));
}
