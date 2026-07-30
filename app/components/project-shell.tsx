"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { WriteSessionProvider, useWriteSession } from "./write-session";
import ContextualAdd from "./contextual-add";
import styles from "./shell.module.css";

type Project = {
  id: string;
  name: string;
  description: string | null;
  pendingFindingCount: number;
  lastActivityAt: string;
};

type Health = {
  canonicalState: "available";
  persistence: "canonical_d1";
  fixtureMode: false;
  seededFallback: false;
  publicDemo: boolean;
};

const destinations = [
  { id: "work", label: "Work", mark: "W" },
  { id: "found", label: "Atlas Found", mark: "F" },
  { id: "ask", label: "Ask", mark: "A" },
  { id: "inspect", label: "Inspect", mark: "I" },
] as const;

function destinationForPath(pathname: string) {
  if (pathname.includes("/findings")) return "found";
  if (pathname.includes("/ask")) return "ask";
  if (pathname.includes("/inspect")) return "inspect";
  return "work";
}

function destinationHref(projectId: string, destination: typeof destinations[number]["id"]) {
  const encoded = encodeURIComponent(projectId);
  if (destination === "found") return `/projects/${encoded}/findings`;
  if (destination === "ask") return `/projects/${encoded}/ask`;
  if (destination === "inspect") return `/projects/${encoded}/inspect`;
  return `/projects/${encoded}/work`;
}

function AuthorizationPanel() {
  const {
    session,
    status,
    writeKey,
    error,
    setWriteKey,
    verifyWriteAccess,
    clearWriteAccess,
  } = useWriteSession();
  const authorized = Boolean(session?.writeAuthorization.authorized);
  return (
    <section className={styles.authorization} aria-label="Canonical write authorization">
      <div className={styles.healthLine}>
        <i className={authorized ? styles.goodDot : styles.readOnlyDot} />
        <span>{authorized ? "Canonical writes enabled" : "Read-only session"}</span>
      </div>
      <small>
        {authorized
          ? `${session?.actor.displayName || "Cody"} · key held in memory only`
          : "Reads remain available. Consequential writes fail closed."}
      </small>
      {authorized ? (
        <button className={styles.textButton} onClick={clearWriteAccess} type="button">
          Return to read-only
        </button>
      ) : (
        <>
          <label className={styles.srOnly} htmlFor="canonical-write-key">Canonical write key</label>
          <input
            autoComplete="off"
            id="canonical-write-key"
            onChange={(event) => setWriteKey(event.target.value)}
            placeholder="Enable writes"
            type="password"
            value={writeKey}
          />
          <button
            className={styles.smallButton}
            disabled={!writeKey || status === "verifying"}
            onClick={verifyWriteAccess}
            type="button"
          >
            {status === "verifying" ? "Verifying…" : "Verify access"}
          </button>
        </>
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [switching, setSwitching] = useState(false);
  const [mobileAuthorizationOpen, setMobileAuthorizationOpen] = useState(false);
  const [contextualAddOpen, setContextualAddOpen] = useState(false);
  const activeDestination = destinationForPath(pathname);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/v1/projects", { cache: "no-store" }),
      fetch("/api/v1/health", { cache: "no-store" }),
    ])
      .then(async ([projectsResponse, healthResponse]) => {
        if (!projectsResponse.ok || !healthResponse.ok) {
          throw new Error("Canonical D1 state is unavailable.");
        }
        const projectValue = await projectsResponse.json() as { projects: Project[] };
        const healthValue = await healthResponse.json() as Health;
        if (!active) return;
        setProjects(projectValue.projects);
        setHealth(healthValue);
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
  }, [projectId]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === projectId) || null,
    [projectId, projects],
  );

  function changeProject(nextProjectId: string) {
    if (!nextProjectId || nextProjectId === projectId) return;
    setSwitching(true);
    setMobileAuthorizationOpen(false);
    setContextualAddOpen(false);
    router.push(destinationHref(nextProjectId, activeDestination));
  }

  return (
    <div className={styles.appShell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/">
          <span>CA</span>
          <div>
            <strong>Campus Atlas</strong>
            <small>Governed continuity</small>
          </div>
        </Link>

        <label className={styles.selectorLabel} htmlFor="project-switcher">Project</label>
        <select
          aria-label="Canonical project"
          className={styles.projectSwitcher}
          disabled={status !== "ready" || switching}
          id="project-switcher"
          onChange={(event) => changeProject(event.target.value)}
          value={activeProject?.id || projectId}
        >
          {!activeProject && <option value={projectId}>{status === "loading" ? "Loading…" : projectId}</option>}
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>

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
              {destination.id === "found" && activeProject?.pendingFindingCount
                ? <b>{activeProject.pendingFindingCount}</b>
                : null}
            </Link>
          ))}
        </nav>
        <button className={styles.contextualAdd} onClick={() => setContextualAddOpen(true)} type="button">
          <span>＋</span> Add
        </button>

        <div className={styles.sidebarBottom}>
          <div className={styles.canonicalStatus}>
            <i className={status === "ready" ? styles.goodDot : status === "loading" ? styles.loadingDot : styles.badDot} />
            <div>
              <strong>
                {status === "ready"
                  ? health?.publicDemo ? "Canonical D1 · demo-isolated" : "Canonical D1 connected"
                  : status === "loading" ? "Checking canonical state" : "Canonical state unavailable"}
              </strong>
              <small>{health?.fixtureMode ? "Explicit fixture mode" : "No fixture fallback"}</small>
            </div>
          </div>
          <AuthorizationPanel />
        </div>
      </aside>

      <header className={styles.mobileHeader}>
        <Link className={styles.mobileBrand} href="/">CA</Link>
        <select
          aria-label="Canonical project"
          className={styles.mobileProjectSwitcher}
          disabled={status !== "ready" || switching}
          onChange={(event) => changeProject(event.target.value)}
          value={activeProject?.id || projectId}
        >
          {!activeProject && <option value={projectId}>{projectId}</option>}
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <button
          aria-label="Open canonical write authorization"
          className={status === "ready" ? styles.mobileHealthy : styles.mobileUnavailable}
          onClick={() => setMobileAuthorizationOpen(true)}
          type="button"
        >
          {status === "ready" ? "D1" : "!"}
        </button>
        <button
          aria-label="Open Contextual Add"
          className={styles.mobileAdd}
          onClick={() => setContextualAddOpen(true)}
          type="button"
        >
          ＋
        </button>
      </header>

      <main className={styles.main}>
        {switching && <div className={styles.switchNotice}>Switching project and clearing the prior project view…</div>}
        {status === "unavailable" && (
          <div className={styles.failureBanner} role="alert">
            <strong>Canonical state unavailable</strong>
            <span>No seeded content was substituted. Existing URLs remain valid; retry when D1 is available.</span>
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
          </Link>
        ))}
      </nav>
      {mobileAuthorizationOpen && (
        <div className={styles.mobileSheetBackdrop} onMouseDown={() => setMobileAuthorizationOpen(false)}>
          <section
            aria-label="Session and write authorization"
            className={styles.mobileSheet}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <strong>Session and write access</strong>
                <small>The key stays in memory and is cleared on refresh.</small>
              </div>
              <button aria-label="Close authorization" onClick={() => setMobileAuthorizationOpen(false)} type="button">×</button>
            </header>
            <AuthorizationPanel />
          </section>
        </div>
      )}
      <ContextualAdd
        key={projectId}
        onClose={() => setContextualAddOpen(false)}
        open={contextualAddOpen}
        projectId={projectId}
      />
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
      <ProjectShellInner key={projectId} projectId={projectId}>{children}</ProjectShellInner>
    </WriteSessionProvider>
  );
}
