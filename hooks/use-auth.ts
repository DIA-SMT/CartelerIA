// La lógica vive en components/auth-provider.tsx (estado único por contexto).
// Este módulo se conserva para que los consumidores existentes de
// "@/hooks/use-auth" no cambien.
export { useAuth, type AppRole, type AuthState } from "@/components/auth-provider";
