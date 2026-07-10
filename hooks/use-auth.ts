"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type AppRole = "administrador" | "coordinador" | "inspector" | "consulta";

/** Roles con permiso de escritura sobre inspecciones (coincide con la RLS). */
const OPERATIVE_ROLES: AppRole[] = ["administrador", "coordinador", "inspector"];

export interface AuthState {
  /** Si Supabase no está configurado, la autenticación no está disponible. */
  available: boolean;
  loading: boolean;
  user: User | null;
  role: AppRole | null;
  /** true si el rol permite crear/editar inspecciones. */
  canInspect: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

async function fetchRole(userId: string): Promise<AppRole | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("perfiles")
    .select("rol")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.rol as AppRole) ?? null;
}

export function useAuth(): AuthState {
  const available = Boolean(supabase);
  const [loading, setLoading] = useState(available);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applySession = useCallback(async (session: Session | null) => {
    const nextUser = session?.user ?? null;
    setUser(nextUser);
    setRole(nextUser ? await fetchRole(nextUser.id) : null);
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

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setRole(null);
  }, []);

  return {
    available,
    loading,
    user,
    role,
    canInspect: role !== null && OPERATIVE_ROLES.includes(role),
    error,
    signIn,
    signOut,
  };
}
