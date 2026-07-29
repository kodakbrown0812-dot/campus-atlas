"use client";

import {
  ReactNode,
  createContext,
  useCallback,
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
    storage: "memory_only";
  };
  readOnly: boolean;
};

type SessionState = {
  session: SessionRecord | null;
  status: "loading" | "ready" | "verifying" | "unavailable";
  writeKey: string;
  error: string;
  setWriteKey(value: string): void;
  verifyWriteAccess(): Promise<boolean>;
  clearWriteAccess(): void;
  authorizationHeaders(): Record<string, string>;
};

const WriteSessionContext = createContext<SessionState | null>(null);

export function WriteSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [status, setStatus] = useState<SessionState["status"]>("loading");
  const [writeKey, setWriteKey] = useState("");
  const [error, setError] = useState("");

  const loadSession = useCallback(async (key = "") => {
    const response = await fetch("/api/v1/session", {
      headers: key ? { authorization: `Bearer ${key}` } : undefined,
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Canonical session state is unavailable.");
    const value = await response.json() as { session: SessionRecord };
    setSession(value.session);
    return value.session;
  }, []);

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
  }, [loadSession]);

  async function verifyWriteAccess() {
    setStatus("verifying");
    setError("");
    try {
      const next = await loadSession(writeKey);
      setStatus("ready");
      if (!next.writeAuthorization.authorized) {
        setError(next.writeAuthorization.configured
          ? "Write authorization was not accepted. Read-only access remains available."
          : "Canonical writes are not configured in this environment.");
      }
      return next.writeAuthorization.authorized;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Write authorization could not be verified.");
      setStatus("unavailable");
      return false;
    }
  }

  function clearWriteAccess() {
    setWriteKey("");
    setError("");
    setSession((current) => current ? {
      ...current,
      readOnly: true,
      writeAuthorization: { ...current.writeAuthorization, authorized: false },
    } : current);
  }

  const value: SessionState = {
    session,
    status,
    writeKey,
    error,
    setWriteKey,
    verifyWriteAccess,
    clearWriteAccess,
    authorizationHeaders: () => {
      const headers: Record<string, string> = {};
      if (writeKey) headers.authorization = `Bearer ${writeKey}`;
      return headers;
    },
  };

  return <WriteSessionContext.Provider value={value}>{children}</WriteSessionContext.Provider>;
}

export function useWriteSession() {
  const value = useContext(WriteSessionContext);
  if (!value) throw new Error("useWriteSession must be used inside WriteSessionProvider.");
  return value;
}
