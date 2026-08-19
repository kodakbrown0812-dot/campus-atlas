"use client";

import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

type SessionRecord = {
  actor: {
    id: string;
    displayName: string;
    email: string | null;
    authenticatedByPlatform: boolean;
  };
  mode: "private_workspace" | "public_demo";
  fixtureMode: false;
  writeAuthorization: {
    required: true;
    configured: boolean;
    authorized: boolean;
    ownerIdentityConfigured: boolean;
    storage: "memory_only" | "platform_identity";
  };
  readOnly: boolean;
};

type SessionState = {
  session: SessionRecord | null;
  status: "loading" | "ready" | "unavailable";
  error: string;
  authorizationHeaders(): Record<string, string>;
};

const WriteSessionContext = createContext<SessionState | null>(null);

export function WriteSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [status, setStatus] = useState<SessionState["status"]>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/v1/session", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Canonical session state is unavailable.");
        return response.json() as Promise<{ session: SessionRecord }>;
      })
      .then((value) => {
        if (!active) return;
        setSession(value.session);
        if (active) setStatus("ready");
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Canonical session state is unavailable.");
        setStatus("unavailable");
      });
    return () => { active = false; };
  }, []);

  const value: SessionState = {
    session,
    status,
    error,
    authorizationHeaders: () => ({}),
  };

  return <WriteSessionContext.Provider value={value}>{children}</WriteSessionContext.Provider>;
}

export function useWriteSession() {
  const value = useContext(WriteSessionContext);
  if (!value) throw new Error("useWriteSession must be used inside WriteSessionProvider.");
  return value;
}
