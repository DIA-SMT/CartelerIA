"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type AppRole = "administrador" | "coordinador" | "inspector" | "consulta";

/** Roles con permiso de escritura sobre inspecciones (coincide con la RLS). */
const OPERATIVE_ROLES: AppRole[] = ["administrador", "coordinador", "inspector"];
const APP_ROLES: AppRole[] = [...OPERATIVE_ROLES, "consulta"];

export interface AuthState {
  /** Si Supabase no está configurado, la autenticación no está disponible. */
  available: boolean;
  loading: boolean;
  user: User | null;
  role: AppRole | null;
  roleError: string | null;
  /** true solo cuando la sesión tiene un perfil municipal con rol reconocido. */
  canRead: boolean;
  /** true si el rol permite crear/editar inspecciones. */
  canInspect: boolean;
  error: string | null;
  retryRole: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

async function fetchRole(userId: string): Promise<{ role: AppRole | null; error: string | null }> {
  if (!supabase) return { role: null, error: "Supabase no está configurado." };
  const { data, error } = await supabase
    .from("perfiles")
    .select("rol")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { role: null, error: "No se pudieron verificar los permisos de la cuenta." };
  if (!data) return { role: null, error: "La cuenta no tiene un perfil municipal habilitado." };
  if (!APP_ROLES.includes(data.rol as AppRole)) {
    return { role: null, error: "El perfil municipal contiene un rol no reconocido." };
  }
  return { role: data.rol as AppRole, error: null };
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Estado de sesión único para toda la app. Antes cada componente invocaba un
 * hook con estado propio: 6 suscripciones a onAuthStateChange y 6 SELECT a
 * perfiles por sesión. Con el provider, una sola de cada.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const available = Boolean(supabase);
  const [loading, setLoading] = useState(available);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionSequence = useRef(0);

  const applySession = useCallback(async (session: Session | null) => {
    const sequence = ++sessionSequence.current;
    const nextUser = session?.user ?? null;
    setUser(nextUser);
    setRole(null);
    setRoleError(null);
    if (!nextUser) return;

    const roleResult = await fetchRole(nextUser.id);
    if (sequence !== sessionSequence.current) return;
    setRole(roleResult.role);
    setRoleError(roleResult.error);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!active) return;
        await applySession(data.session);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) void applySession(session);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [applySession]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return false;
    setError(null);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      setError("Credenciales inválidas o usuario inexistente.");
      return false;
    }
    await applySession(data.session);
    return true;
  }, [applySession]);

  const retryRole = useCallback(async () => {
    if (!user) return;
    const sequence = ++sessionSequence.current;
    setRole(null);
    setRoleError(null);
    const roleResult = await fetchRole(user.id);
    if (sequence !== sessionSequence.current) return;
    setRole(roleResult.role);
    setRoleError(roleResult.error);
  }, [user]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    // Purga permisos de inmediato; no depende de que termine la llamada de red.
    sessionSequence.current += 1;
    setUser(null);
    setRole(null);
    setRoleError(null);
    setError(null);
    await supabase.auth.signOut();
  }, []);

  const value: AuthState = {
    available,
    loading,
    user,
    role,
    roleError,
    canRead: Boolean(user) && role !== null && roleError === null,
    canInspect: Boolean(user) && role !== null && OPERATIVE_ROLES.includes(role),
    error,
    retryRole,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth debe usarse dentro de <AuthProvider>.");
  return context;
}
