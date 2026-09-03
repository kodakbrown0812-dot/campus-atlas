"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { WriteSessionProvider, useWriteSession } from "./write-session";
import { StewardTaskProvider, useStewardTask } from "./steward-task";
import styles from "./shell.module.css";

type Project = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  pendingFindingCount: number;
  lastActivityAt: string;
};

const destinations = [
  { id: "work", label: "Home", mark: "H" },
  { id: "ask", label: "Steward", mark: "S" },
  { id: "inspect", label: "Inspect", mark: "I" },
] as const;

function destinationForPath(pathname: string) {
  if (pathname.includes("/findings")) return "inspect";
  if (pathname.includes("/ask")) return "ask";
  if (pathname.includes("/inspect")) return "inspect";
  return "work";
}

function destinationHref(projectId: string, destination: typeof destinations[number]["id"]) {
  const encoded = encodeURIComponent(projectId);
  if (destination === "ask") return `/projects/${encoded}/ask`;
  if (destination === "inspect") return `/projects/${encoded}/inspect`;
  return `/projects/${encoded}/work`;
}

function AuthorizationPanel() {
  const { session, error } = useWriteSession();
  const pathname = usePathname();
  const authorized = Boolean(session?.writeAuthorization.authorized);
  const returnTo = encodeURIComponent(pathname || "/");
  const signInHref = `/signin-with-chatgpt?return_to=${returnTo}`;
  const signOutHref = `/signout-with-chatgpt?return_to=${returnTo}`;
  return (
    <section className={styles.authorization} aria-label="Account">
      <div className={styles.healthLine}>
        <i className={authorized ? styles.goodDot : styles.readOnlyDot} />
        <span>{authorized ? "Signed in" : "Sign in to continue"}</span>
      </div>
      <small>
        {authorized
          ? session?.actor.displayName || "Account ready"
          : "You can look around now. Sign in to transfer a room or prepare a packet."}
      </small>
      {authorized ? (
        <a className={styles.textButton} href={signOutHref}>Sign out</a>
      ) : session?.actor.authenticatedByPlatform ? (
        <>
          <p className={styles.inlineError}>This account cannot make changes to this Atlas workspace.</p>
          <a className={styles.textButton} href={signOutHref}>Use a different ChatGPT account</a>
        </>
      ) : session?.writeAuthorization.ownerIdentityConfigured ? (
        <a className={styles.smallButton} href={signInHref}>Sign in as owner</a>
      ) : (
        <p className={styles.inlineError}>Sign-in is not available in this environment.</p>
      )}
      {error && <p className={styles.inlineError}>{error}</p>}
    </section>
  );
}

function ProjectShellInner({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, authorizationHeaders } = useWriteSession();
  const { clearTask } = useStewardTask();
  const [projects, setProjects] = useState<Project[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [switching, setSwitching] = useState(false);
  const [mobileAuthorizationOpen, setMobileAuthorizationOpen] = useState(false);
  const [projectActionsOpen, setProjectActionsOpen] = useState(false);
  const [projectActionStatus, setProjectActionStatus] = useState<"idle" | "saving">("idle");
  const [projectActionMessage, setProjectActionMessage] = useState("");
  const [projectActionError, setProjectActionError] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const activeDestination = destinationForPath(pathname);

  const loadProjects = useCallback(async () => {
    const [projectsResponse, allProjectsResponse, healthResponse] = await Promise.all([
      fetch("/api/v1/projects", { cache: "no-store" }),
      fetch("/api/v1/projects?includeArchived=true", { cache: "no-store" }),
      fetch("/api/v1/health", { cache: "no-store" }),
    ]);
    if (!projectsResponse.ok || !allProjectsResponse.ok || !healthResponse.ok) {
      throw new Error("Project data is unavailable.");
    }
    const projectValue = await projectsResponse.json() as { projects: Project[] };
    const allProjectValue = await allProjectsResponse.json() as { projects: Project[] };
    await healthResponse.json();
    return { active: projectValue.projects, all: allProjectValue.projects };
  }, []);

  useEffect(() => {
    let active = true;
    loadProjects()
      .then((value) => {
        if (!active) return;
        setProjects(value.active);
        setAllProjects(value.all);
        setStatus("ready");
        setSwitching(false);
      })
      .catch(() => {
        if (active) {
          setStatus("unavailable");
          setSwitching(false);
        }
      });
    return () => { active = false; };
  }, [loadProjects, projectId]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === projectId) || null,
    [projectId, projects],
  );
  const currentProject = useMemo(
    () => allProjects.find((project) => project.id === projectId) || activeProject,
    [activeProject, allProjects, projectId],
  );
  const archivedProjects = useMemo(
    () => allProjects.filter((project) => project.status === "archived"),
    [allProjects],
  );
  const canWrite = Boolean(session?.writeAuthorization.authorized);

  function changeProject(nextProjectId: string) {
    if (!nextProjectId || nextProjectId === projectId) return;
    setSwitching(true);
    setMobileAuthorizationOpen(false);
    router.push(destinationHref(nextProjectId, activeDestination));
  }

  function openProjectActions() {
    setRenameValue(currentProject?.name || "");
    setProjectActionError("");
    setProjectActionMessage("");
    setDeleteConfirmation(false);
    setProjectActionsOpen(true);
    setMobileAuthorizationOpen(false);
  }

  async function patchProject(targetProjectId: string, body: { name?: string; status?: "active" | "archived" }) {
    setProjectActionStatus("saving");
    setProjectActionError("");
    setProjectActionMessage("");
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(targetProjectId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...authorizationHeaders() },
        body: JSON.stringify(body),
      });
      const value = await response.json().catch(() => ({ error: "Project update failed." })) as {
        project?: Project;
        error?: string;
      };
      if (!response.ok || !value.project) {
        throw new Error(response.status === 401
          ? "Sign in as the owner to change this project."
          : value.error || "Project update failed.");
      }
      const refreshed = await loadProjects();
      setProjects(refreshed.active);
      setAllProjects(refreshed.all);
      window.dispatchEvent(new Event("atlas:project-lifecycle"));
      if (body.status === "archived") {
        clearTask(targetProjectId);
        setProjectActionsOpen(false);
        const next = refreshed.active.find((project) => project.id !== targetProjectId);
        router.push(next ? destinationHref(next.id, activeDestination) : "/");
        return;
      }
      if (body.status === "active") {
        setProjectActionMessage("Project restored to your active projects.");
      } else {
        setProjectActionMessage("Project name updated. Its history and identity are unchanged.");
      }
      setDeleteConfirmation(false);
    } catch (caught) {
      setProjectActionError(caught instanceof Error ? caught.message : "Project update failed.");
    } finally {
      setProjectActionStatus("idle");
    }
  }

  function renameProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renameValue.trim() || !currentProject) return;
    void patchProject(currentProject.id, { name: renameValue.trim() });
  }

  async function deleteProject() {
    if (!currentProject || !deleteConfirmation) return;
    setProjectActionStatus("saving");
    setProjectActionError("");
    setProjectActionMessage("");
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(currentProject.id)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json", ...authorizationHeaders() },
        body: JSON.stringify({
          confirmation: {
            projectId: currentProject.id,
            projectName: currentProject.name,
            permanentlyDelete: true,
          },
        }),
      });
      const value = await response.json().catch(() => ({ error: "Project deletion failed." })) as {
        deleted?: boolean;
        error?: string;
      };
      if (!response.ok || !value.deleted) {
        throw new Error(response.status === 401
          ? "Sign in as the owner to delete this project."
          : value.error || "Project deletion failed.");
      }
      clearTask(currentProject.id);
      const refreshed = await loadProjects();
      setProjects(refreshed.active);
      setAllProjects(refreshed.all);
      setProjectActionsOpen(false);
      window.dispatchEvent(new Event("atlas:project-lifecycle"));
      const next = refreshed.active[0];
      router.push(next ? destinationHref(next.id, activeDestination) : "/");
    } catch (caught) {
      setProjectActionError(caught instanceof Error ? caught.message : "Project deletion failed.");
    } finally {
      setProjectActionStatus("idle");
    }
  }

  return (
    <div className={styles.appShell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/">
          <span>CA</span>
          <div>
            <strong>Campus Atlas</strong>
            <small>Room continuity</small>
          </div>
        </Link>

        <label className={styles.selectorLabel} htmlFor="project-switcher">Project</label>
        <div className={styles.projectControl}>
          <select
            aria-label="Current project"
            className={styles.projectSwitcher}
            disabled={status !== "ready" || switching}
            id="project-switcher"
            onChange={(event) => changeProject(event.target.value)}
            value={activeProject?.id || projectId}
          >
            {!activeProject && (
              <option value={projectId}>
                {status === "loading" ? "Loading…" : currentProject ? `${currentProject.name} (Archived)` : projectId}
              </option>
            )}
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <button
            aria-label="Project options"
            className={styles.projectMenuButton}
            disabled={status !== "ready"}
            onClick={openProjectActions}
            type="button"
          >
            …
          </button>
        </div>

        <nav aria-label="Campus Atlas primary">
          {destinations.map((destination) => (
            <Link
              aria-current={activeDestination === destination.id ? "page" : undefined}
              className={activeDestination === destination.id ? styles.activeNav : styles.navLink}
              href={destinationHref(projectId, destination.id)}
              key={destination.id}
            >
              <span>{destination.mark}</span>
              {destination.label}
              {destination.id === "inspect" && activeProject?.pendingFindingCount
                ? <b>{activeProject.pendingFindingCount}</b>
                : null}
            </Link>
          ))}
        </nav>
        {activeProject?.pendingFindingCount ? (
          <Link className={styles.reviewLink} href={`/projects/${encodeURIComponent(projectId)}/findings`}>
            Needs review <b>{activeProject.pendingFindingCount}</b>
          </Link>
        ) : null}
        <div className={styles.sidebarBottom}>
          <AuthorizationPanel />
        </div>
      </aside>

      <header className={styles.mobileHeader}>
        <Link className={styles.mobileBrand} href="/">CA</Link>
        <select
          aria-label="Current project"
          className={styles.mobileProjectSwitcher}
          disabled={status !== "ready" || switching}
          onChange={(event) => changeProject(event.target.value)}
          value={activeProject?.id || projectId}
        >
          {!activeProject && <option value={projectId}>{currentProject ? `${currentProject.name} (Archived)` : projectId}</option>}
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <button
          aria-label="Project options"
          className={styles.mobileProjectMenu}
          disabled={status !== "ready"}
          onClick={openProjectActions}
          type="button"
        >
          …
        </button>
        <button
          aria-label="Open account"
          className={status === "ready" ? styles.mobileHealthy : styles.mobileUnavailable}
          onClick={() => setMobileAuthorizationOpen(true)}
          type="button"
        >
          {status === "ready" ? "ME" : "!"}
        </button>
      </header>

      <main className={styles.main}>
        {switching && <div className={styles.switchNotice}>Switching project and clearing the prior project view…</div>}
        {status === "unavailable" && (
          <div className={styles.failureBanner} role="alert">
            <strong>Project data unavailable</strong>
            <span>Atlas did not substitute another project. Try again when the workspace is available.</span>
          </div>
        )}
        {children}
      </main>

      <nav className={styles.mobileNav} aria-label="Campus Atlas mobile primary">
        {destinations.map((destination) => (
          <Link
            aria-current={activeDestination === destination.id ? "page" : undefined}
            className={activeDestination === destination.id ? styles.activeMobileNav : styles.mobileNavLink}
            href={destinationHref(projectId, destination.id)}
            key={destination.id}
          >
            <span>{destination.mark}</span>
            {destination.label}
            {destination.id === "inspect" && activeProject?.pendingFindingCount
              ? <em>{activeProject.pendingFindingCount}</em>
              : null}
          </Link>
        ))}
      </nav>
      {projectActionsOpen && (
        <div className={styles.projectSheetBackdrop} onMouseDown={() => setProjectActionsOpen(false)}>
          <section
            aria-label="Project options"
            className={styles.projectSheet}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <strong>Project options</strong>
                <small>{currentProject?.name || projectId}</small>
              </div>
              <button aria-label="Close project options" onClick={() => setProjectActionsOpen(false)} type="button">×</button>
            </header>

            {currentProject?.status === "archived" ? (
              <div className={styles.projectActionBlock}>
                <strong>This project is archived.</strong>
                <p>Its rooms and history are still preserved.</p>
                <button
                  disabled={!canWrite || projectActionStatus === "saving"}
                  onClick={() => void patchProject(currentProject.id, { status: "active" })}
                  type="button"
                >
                  Restore project
                </button>
              </div>
            ) : (
              <>
                <form className={styles.renameProject} onSubmit={renameProject}>
                  <label htmlFor="project-display-name">Project name</label>
                  <div>
                    <input
                      disabled={!canWrite || projectActionStatus === "saving"}
                      id="project-display-name"
                      maxLength={120}
                      onChange={(event) => setRenameValue(event.target.value)}
                      value={renameValue}
                    />
                    <button
                      disabled={!canWrite || projectActionStatus === "saving" || !renameValue.trim() || renameValue.trim() === currentProject?.name}
                      type="submit"
                    >
                      Rename
                    </button>
                  </div>
                </form>
              </>
            )}

            {currentProject ? (
              <div className={`${styles.projectActionBlock} ${styles.deleteProjectBlock}`}>
                <strong>Delete project</strong>
                <p>Permanently remove this project, its rooms, transfer packets, and Atlas history.</p>
                {deleteConfirmation ? (
                  <div className={styles.deleteConfirmation}>
                    <p><strong>Delete {currentProject.name}?</strong> This cannot be undone.</p>
                    <div className={styles.confirmActions}>
                      <button
                        className={styles.dangerButton}
                        disabled={!canWrite || projectActionStatus === "saving"}
                        onClick={() => void deleteProject()}
                        type="button"
                      >
                        {projectActionStatus === "saving" ? "Deleting…" : "Yes, delete project"}
                      </button>
                      <button
                        disabled={projectActionStatus === "saving"}
                        onClick={() => setDeleteConfirmation(false)}
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className={styles.dangerTextButton}
                    disabled={!canWrite}
                    onClick={() => setDeleteConfirmation(true)}
                    type="button"
                  >
                    Delete project
                  </button>
                )}
              </div>
            ) : null}

            <details className={styles.archivedProjects}>
              <summary>Archived projects · {archivedProjects.length}</summary>
              {archivedProjects.length ? archivedProjects.map((project) => (
                <article key={project.id}>
                  <div><strong>{project.name}</strong><small>History preserved</small></div>
                  <Link href={destinationHref(project.id, "inspect")} onClick={() => setProjectActionsOpen(false)}>Open history</Link>
                  <button
                    disabled={!canWrite || projectActionStatus === "saving"}
                    onClick={() => void patchProject(project.id, { status: "active" })}
                    type="button"
                  >
                    Restore
                  </button>
                </article>
              )) : <p>No archived projects.</p>}
            </details>

            {!canWrite ? <p className={styles.projectActionError}>Sign in as the owner to change projects.</p> : null}
            {projectActionMessage ? <p className={styles.projectActionMessage} role="status">{projectActionMessage}</p> : null}
            {projectActionError ? <p className={styles.projectActionError} role="alert">{projectActionError}</p> : null}
          </section>
        </div>
      )}
      {mobileAuthorizationOpen && (
        <div className={styles.mobileSheetBackdrop} onMouseDown={() => setMobileAuthorizationOpen(false)}>
          <section
            aria-label="Account"
            className={styles.mobileSheet}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <strong>Account</strong>
                <small>Sign in to transfer rooms and prepare packets.</small>
              </div>
              <button aria-label="Close authorization" onClick={() => setMobileAuthorizationOpen(false)} type="button">×</button>
            </header>
            <AuthorizationPanel />
          </section>
        </div>
      )}
    </div>
  );
}

export default function ProjectShell({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  return (
    <WriteSessionProvider>
      <StewardTaskProvider key={projectId}>
        <ProjectShellInner key={projectId} projectId={projectId}>{children}</ProjectShellInner>
      </StewardTaskProvider>
    </WriteSessionProvider>
  );
}
