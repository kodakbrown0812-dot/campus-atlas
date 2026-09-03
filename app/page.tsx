"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type RootState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "archived"; projects: Array<{ id: string; name: string }> }
  | { status: "unavailable"; message: string };

export default function CampusAtlasRoot() {
  const router = useRouter();
  const [state, setState] = useState<RootState>({ status: "loading" });
  const [newProjectName, setNewProjectName] = useState("");
  const [createStatus, setCreateStatus] = useState<"idle" | "saving">("idle");
  const [createError, setCreateError] = useState("");

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newProjectName.trim();
    if (!name || createStatus === "saving") return;
    setCreateStatus("saving");
    setCreateError("");
    try {
      const response = await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const value = await response.json().catch(() => ({ error: "Project creation failed." })) as {
        project?: { id: string };
        error?: string;
      };
      if (!response.ok || !value.project) {
        throw new Error(response.status === 401
          ? "Sign in as the owner to create a project."
          : value.error || "Project creation failed.");
      }
      router.replace(`/projects/${encodeURIComponent(value.project.id)}/work`);
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : "Project creation failed.");
      setCreateStatus("idle");
    }
  }

  const createProjectForm = (
    <form className="root-create-project" onSubmit={createProject}>
      <label htmlFor="new-project-name">Project name</label>
      <div>
        <input
          autoComplete="off"
          disabled={createStatus === "saving"}
          id="new-project-name"
          maxLength={120}
          onChange={(event) => setNewProjectName(event.target.value)}
          placeholder="My project"
          value={newProjectName}
        />
        <button disabled={!newProjectName.trim() || createStatus === "saving"} type="submit">
          {createStatus === "saving" ? "Creating…" : "Create project"}
        </button>
      </div>
      {createError ? <p className="root-create-error" role="alert">{createError}</p> : null}
    </form>
  );

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
            <h1>Start a clean project</h1>
            <p>No project exists in this workspace yet. Name one, then transfer the room you actually want to continue.</p>
            {createProjectForm}
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
            {createProjectForm}
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
