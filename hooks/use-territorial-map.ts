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
import type { CartelRecord } from "@/data/carteles";
import { useAuth } from "@/hooks/use-auth";
import { loadCarteles, type AdministrativeCartelSource } from "@/lib/cartel-repository";
import { linkAdministrativeCarteles } from "@/lib/territorial-cartel-linker";

const emptyLines: FeatureCollection<GeoLine> = { type: "FeatureCollection", features: [] };
const emptyPoints: FeatureCollection<GeoPoint> = { type: "FeatureCollection", features: [] };

export function useTerritorialMap() {
  const auth = useAuth();
  const [territorialCarteles, setTerritorialCarteles] = useState<AnalyzedCartel[]>([]);
  const [administrativeCarteles, setAdministrativeCarteles] = useState<CartelRecord[]>([]);
  const [corridors, setCorridors] = useState<FeatureCollection<GeoLine>>(emptyLines);
  const [allowedPlaces, setAllowedPlaces] = useState<FeatureCollection<GeoPoint>>(emptyPoints);
  const [filters, setFilters] = useState<TerritorialFilterState>(initialTerritorialFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [administrativeSource, setAdministrativeSource] = useState<AdministrativeCartelSource | "none">("none");
  const [administrativeOwnerId, setAdministrativeOwnerId] = useState<string | null>(null);
  const [administrativeReloadKey, setAdministrativeReloadKey] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const refresh = () => setAdministrativeReloadKey((value) => value + 1);
    window.addEventListener("carteleria:administrative-refresh", refresh);
    return () => window.removeEventListener("carteleria:administrative-refresh", refresh);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    loadTerritorialLayers()
      .then((layers) => {
        if (!active) return;
        setCorridors(layers.corridors);
        setAllowedPlaces(layers.allowedPlaces);
        setTerritorialCarteles(layers.analyzed.features);
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

  // El registro administrativo contiene datos privados y solo se consulta con
  // una sesión activa. Al cerrar sesión se retira del estado inmediatamente.
  useEffect(() => {
    if (!auth.canRead || !auth.user) {
      setAdministrativeCarteles([]);
      setAdministrativeSource("none");
      setAdministrativeOwnerId(null);
      return;
    }

    let active = true;
    const userId = auth.user.id;
    setAdministrativeCarteles([]);
    setAdministrativeSource("none");
    setAdministrativeOwnerId(null);
    // El rol elige la fuente: con `consulta` se pide la vista sin empresa,
    // CUIT ni padrón. Si el rol cambia, se vuelve a cargar.
    loadCarteles(auth.role).then((result) => {
      if (!active) return;
      setAdministrativeCarteles(result.data);
      setAdministrativeSource(result.source);
      setAdministrativeOwnerId(userId);
    });
    return () => {
      active = false;
    };
  }, [auth.canRead, auth.user?.id, auth.role, administrativeReloadKey]);

  const linked = useMemo(
    () => auth.canRead && auth.user && administrativeOwnerId === auth.user.id
      ? linkAdministrativeCarteles(territorialCarteles, administrativeCarteles)
      : { carteles: territorialCarteles, linkedCount: 0 },
    [auth.canRead, auth.user, administrativeOwnerId, territorialCarteles, administrativeCarteles],
  );
  const carteles = linked.carteles;
  const filteredCarteles = useMemo(
    () => filterTerritorialCarteles(carteles, filters),
    [carteles, filters],
  );
  const retry = useCallback(() => {
    setReloadKey((value) => value + 1);
    setAdministrativeReloadKey((value) => value + 1);
  }, []);
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
    administrativeSource: auth.canRead && administrativeOwnerId === auth.user?.id
      ? administrativeSource
      : "none",
    linkedCount: linked.linkedCount,
  };
}
