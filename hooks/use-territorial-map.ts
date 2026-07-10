"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  filterTerritorialCarteles,
  initialTerritorialFilters,
  loadTerritorialLayers,
  type AnalyzedCartel,
  type FeatureCollection,
  type GeoLine,
  type GeoPoint,
  type TerritorialFilterState,
} from "@/data/territorial";
import { loadCarteles } from "@/lib/cartel-repository";
import { linkAdministrativeCarteles } from "@/lib/territorial-cartel-linker";

const emptyLines: FeatureCollection<GeoLine> = { type: "FeatureCollection", features: [] };
const emptyPoints: FeatureCollection<GeoPoint> = { type: "FeatureCollection", features: [] };

export function useTerritorialMap() {
  const [carteles, setCarteles] = useState<AnalyzedCartel[]>([]);
  const [corridors, setCorridors] = useState<FeatureCollection<GeoLine>>(emptyLines);
  const [allowedPlaces, setAllowedPlaces] = useState<FeatureCollection<GeoPoint>>(emptyPoints);
  const [filters, setFilters] = useState<TerritorialFilterState>(initialTerritorialFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [administrativeSource, setAdministrativeSource] = useState<"supabase" | "static">("static");
  const [linkedCount, setLinkedCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([loadTerritorialLayers(), loadCarteles()])
      .then(([layers, administrative]) => {
        if (!active) return;
        const linked = linkAdministrativeCarteles(layers.analyzed.features, administrative.data);
        setCorridors(layers.corridors);
        setAllowedPlaces(layers.allowedPlaces);
        setCarteles(linked.carteles);
        setLinkedCount(linked.linkedCount);
        setAdministrativeSource(administrative.source);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        console.error("Error al cargar GeoJSON", cause);
        setError("No se pudieron cargar las capas territoriales.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [reloadKey]);

  const filteredCarteles = useMemo(
    () => filterTerritorialCarteles(carteles, filters),
    [carteles, filters],
  );
  const retry = useCallback(() => setReloadKey((value) => value + 1), []);
  const resetFilters = useCallback(() => setFilters(initialTerritorialFilters), []);

  return {
    carteles,
    filteredCarteles,
    corridors,
    allowedPlaces,
    filters,
    setFilters,
    resetFilters,
    loading,
    error,
    retry,
    administrativeSource,
    linkedCount,
  };
}
