"use client";

import { createContext, ReactNode, useContext, useMemo, useState } from "react";
import type { ReconstructionRunResult } from "../projects/[projectId]/ask/ask-types";

type PendingStewardTask = {
  projectId: string;
  literalTask: string;
  caseId: string | null;
};

type StewardTaskContextValue = {
  pendingTask: PendingStewardTask | null;
  recentDelivery: ReconstructionRunResult | null;
  carryTask(projectId: string, literalTask: string, caseId?: string | null): void;
  clearTask(projectId: string): void;
  rememberDelivery(projectId: string, delivery: ReconstructionRunResult): void;
};

const StewardTaskContext = createContext<StewardTaskContextValue | null>(null);

export function StewardTaskProvider({ children }: { children: ReactNode }) {
  const [pendingTask, setPendingTask] = useState<PendingStewardTask | null>(null);
  const [recentDelivery, setRecentDelivery] = useState<ReconstructionRunResult | null>(null);
  const value = useMemo<StewardTaskContextValue>(() => ({
    pendingTask,
    recentDelivery,
    carryTask(projectId, literalTask, caseId = null) {
      setPendingTask({ projectId, literalTask, caseId });
    },
    clearTask(projectId) {
      setPendingTask((current) => current?.projectId === projectId ? null : current);
    },
    rememberDelivery(projectId, delivery) {
      if (delivery.projectId !== projectId) return;
      setRecentDelivery(delivery);
    },
  }), [pendingTask, recentDelivery]);

  return <StewardTaskContext.Provider value={value}>{children}</StewardTaskContext.Provider>;
}

export function useStewardTask() {
  const value = useContext(StewardTaskContext);
  if (!value) throw new Error("useStewardTask must be used inside StewardTaskProvider.");
  return value;
}
