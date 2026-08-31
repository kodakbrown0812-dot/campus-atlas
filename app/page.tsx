"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type RootState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "archived"; projects: Array<{ id: string; name: string }> }
  | { status: "unavailable"; message: string };

export default function CampusAtlasRoot() {
  const router = useRouter();
  const [state, setState] = useState<RootState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/v1/health", { cache: "no-store" }),
      fetch("/api/v1/projects", { cache: "no-store" }),
      fetch("/api/v1/projects?includeArchived=true", { cache: "no-store" }),
    ])
      .then(async ([healthResponse, projectsResponse, allProjectsResponse]) => {
        if (!healthResponse.ok || !projectsResponse.ok || !allProjectsResponse.ok) {
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
        const allProjects = await allProjectsResponse.json() as {
          projects: Array<{ id: string; name: string; status: string }>;
        };
        if (!active) return;
        if (health.canonicalState !== "available" || health.fixtureMode || health.seededFallback) {
          throw new Error("Canonical state did not pass the production health contract.");
        }
        const projectId = projects.activeProjectId || projects.projects[0]?.id;
        if (!projectId) {
          const archived = allProjects.projects.filter((project) => project.status === "archived");
          setState(archived.length
            ? { status: "archived", projects: archived }
            : { status: "empty" });
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
        <p className="root-eyebrow">Campus Atlas V1.8</p>
        {state.status === "loading" && (
          <>
            <h1>Restoring your project Home</h1>
            <p>Loading your current project and room transfers.</p>
            <div className="root-progress" aria-label="Loading project"><i /></div>
          </>
        )}
        {state.status === "empty" && (
          <>
            <h1>Choose a project to begin</h1>
            <p>No project exists in this workspace yet.</p>
            <div className="root-notice">
              Create the first project through workspace setup, then return here to transfer an existing room.
            </div>
          </>
        )}
        {state.status === "archived" && (
          <>
            <h1>No active projects</h1>
            <p>Your archived project history is still preserved.</p>
            <div className="root-notice">
              {state.projects.map((project) => (
                <a href={`/projects/${encodeURIComponent(project.id)}/inspect`} key={project.id}>
                  Open {project.name} history
                </a>
              ))}
            </div>
          </>
        )}
        {state.status === "unavailable" && (
          <>
            <h1>Your project is unavailable</h1>
            <p>Atlas could not load the workspace right now.</p>
            <div className="root-error" role="alert">
              Existing rooms and records remain unchanged. Atlas did not substitute another project.
            </div>
            <button onClick={() => window.location.reload()} type="button">Try again</button>
          </>
        )}
      </section>
    </main>
  );
}
