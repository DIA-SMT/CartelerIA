"use client";

import { useEffect } from "react";
import { CircleMarker, MapContainer, ScaleControl, TileLayer, Tooltip, useMap, useMapEvents, ZoomControl } from "react-leaflet";
import type { CartelRecord } from "@/data/carteles";
import { cartelAddress, situationColors, situationLabels } from "@/data/carteles";

function Recenter({ selected }: { selected: CartelRecord | null }) {
  const map = useMap();
  useEffect(() => { if (selected?.latitud != null && selected.longitud != null) map.flyTo([selected.latitud, selected.longitud], 16, { duration: .8 }); }, [selected, map]);
  return null;
}

function LocationPicker({ enabled, onPick }: { enabled: boolean; onPick: (latitude: number, longitude: number) => void }) {
  useMapEvents({ click: event => { if (enabled) onPick(event.latlng.lat, event.latlng.lng); } });
  return null;
}

export default function CarteleriaMap({ carteles, selected, onSelect, editing, draftLocation, onLocationPick }: { carteles: CartelRecord[]; selected: CartelRecord | null; onSelect: (point: CartelRecord) => void; editing: boolean; draftLocation: { latitude: number; longitude: number } | null; onLocationPick: (latitude: number, longitude: number) => void }) {
  return <MapContainer center={[-26.8304, -65.2145]} zoom={13} className="h-full w-full" zoomControl={false} scrollWheelZoom>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
    <Recenter selected={selected}/>
    <ZoomControl position="bottomright"/>
    <ScaleControl position="bottomleft" imperial={false}/>
    <LocationPicker enabled={editing} onPick={onLocationPick}/>
    {draftLocation && <CircleMarker center={[draftLocation.latitude, draftLocation.longitude]} radius={12} pathOptions={{ color: "#123d77", weight: 3, fillColor: "#ffda00", fillOpacity: 1 }}><Tooltip permanent direction="top">Nueva ubicación</Tooltip></CircleMarker>}
    {carteles.filter(cartel => cartel.latitud != null && cartel.longitud != null).map(cartel => <CircleMarker key={cartel.id} center={[cartel.latitud!, cartel.longitud!]} radius={selected?.id === cartel.id ? 12 : 9} pathOptions={{ color: "white", weight: 3, fillColor: situationColors[cartel.status], fillOpacity: 1 }} eventHandlers={{ click: () => onSelect(cartel) }}><Tooltip direction="top" offset={[0, -8]}><strong>{cartel.tipoCartel} · {cartel.empresa || "Sin empresa"}</strong><br/>{situationLabels[cartel.status]} · Contaminación {cartel.contaminationLevel}<br/>{cartelAddress(cartel)}</Tooltip></CircleMarker>)}
  </MapContainer>;
}
