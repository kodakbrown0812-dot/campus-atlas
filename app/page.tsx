"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type RootState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "unavailable"; message: string };

export default function CampusAtlasRoot() {
  const router = useRouter();
  const [state, setState] = useState<RootState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/v1/health", { cache: "no-store" }),
      fetch("/api/v1/projects", { cache: "no-store" }),
    ])
      .then(async ([healthResponse, projectsResponse]) => {
        if (!healthResponse.ok || !projectsResponse.ok) {
          const failure = await healthResponse.json().catch(() => null) as { error?: string } | null;
          throw new Error(failure?.error || "Canonical D1 state is unavailable.");
        }
        const health = await healthResponse.json() as {
          canonicalState: string;
          fixtureMode: boolean;
          seededFallback: boolean;
        };
        const projects = await projectsResponse.json() as {
          activeProjectId: string | null;
          projects: Array<{ id: string }>;
        };
        if (!active) return;
        if (health.canonicalState !== "available" || health.fixtureMode || health.seededFallback) {
          throw new Error("Canonical state did not pass the production health contract.");
        }
        const projectId = projects.activeProjectId || projects.projects[0]?.id;
        if (!projectId) {
          setState({ status: "empty" });
          return;
        }
        router.replace(`/projects/${encodeURIComponent(projectId)}/work`);
      })
      .catch((caught) => {
        if (!active) return;
        setState({
          status: "unavailable",
          message: caught instanceof Error ? caught.message : "Canonical D1 state is unavailable.",
        });
      });
    return () => { active = false; };
  }, [router]);

  return (
    <main className="root-state">
      <section>
        <div className="root-mark">CA</div>
        <p className="root-eyebrow">Campus Atlas V1.7</p>
        {state.status === "loading" && (
          <>
            <h1>Restoring your canonical Work context</h1>
            <p>Checking project activity and persistent D1 state. No fixture is used while this loads.</p>
            <div className="root-progress" aria-label="Loading canonical state"><i /></div>
          </>
        )}
        {state.status === "empty" && (
          <>
            <h1>Start with canonical work</h1>
            <p>No canonical project exists in this workspace. No seeded project card was substituted.</p>
            <div className="root-notice">
              Create the first project through the governed setup workflow, then return here to start a conversation.
            </div>
          </>
        )}
        {state.status === "unavailable" && (
          <>
            <h1>Canonical state is unavailable</h1>
            <p>{state.message}</p>
            <div className="root-error" role="alert">
              Nothing was presented as saved, and no V4.6 seed was loaded. Existing canonical records remain valid.
            </div>
            <button onClick={() => window.location.reload()} type="button">Retry canonical connection</button>
          </>
        )}
      </section>
    </main>
  );
}
