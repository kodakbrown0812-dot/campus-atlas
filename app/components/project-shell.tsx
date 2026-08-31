"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { WriteSessionProvider, useWriteSession } from "./write-session";
import { StewardTaskProvider } from "./steward-task";
import styles from "./shell.module.css";

type Project = {
  id: string;
  name: string;
  description: string | null;
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [switching, setSwitching] = useState(false);
  const [mobileAuthorizationOpen, setMobileAuthorizationOpen] = useState(false);
  const activeDestination = destinationForPath(pathname);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/v1/projects", { cache: "no-store" }),
      fetch("/api/v1/health", { cache: "no-store" }),
    ])
      .then(async ([projectsResponse, healthResponse]) => {
        if (!projectsResponse.ok || !healthResponse.ok) {
          throw new Error("Project data is unavailable.");
        }
        const projectValue = await projectsResponse.json() as { projects: Project[] };
        await healthResponse.json();
        if (!active) return;
        setProjects(projectValue.projects);
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
    router.push(destinationHref(nextProjectId, activeDestination));
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
        <select
          aria-label="Current project"
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
          {!activeProject && <option value={projectId}>{projectId}</option>}
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
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
