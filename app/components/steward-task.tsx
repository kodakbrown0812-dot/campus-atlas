"use client";

import { createContext, ReactNode, useContext, useMemo, useState } from "react";

type PendingStewardTask = {
  projectId: string;
  literalTask: string;
  caseId: string | null;
};

type StewardTaskContextValue = {
  pendingTask: PendingStewardTask | null;
  carryTask(projectId: string, literalTask: string, caseId?: string | null): void;
  clearTask(projectId: string): void;
};

const StewardTaskContext = createContext<StewardTaskContextValue | null>(null);

export function StewardTaskProvider({ children }: { children: ReactNode }) {
  const [pendingTask, setPendingTask] = useState<PendingStewardTask | null>(null);
  const value = useMemo<StewardTaskContextValue>(() => ({
    pendingTask,
    carryTask(projectId, literalTask, caseId = null) {
      setPendingTask({ projectId, literalTask, caseId });
    },
    clearTask(projectId) {
      setPendingTask((current) => current?.projectId === projectId ? null : current);
    },
  }), [pendingTask]);

  return <StewardTaskContext.Provider value={value}>{children}</StewardTaskContext.Provider>;
}

export function useStewardTask() {
  const value = useContext(StewardTaskContext);
  if (!value) throw new Error("useStewardTask must be used inside StewardTaskProvider.");
  return value;
}
