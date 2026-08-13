import Link from "next/link";
import ReconstructionWorkspace from "./reconstruction-workspace";
import styles from "./ask.module.css";

export default async function AskPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.back} href={`/projects/${encodeURIComponent(projectId)}/work`}>
          ← Return to Home
        </Link>
        <header className={styles.header}>
          <div>
            <span>Project context steward</span>
            <h1>Atlas Steward</h1>
            <p>Restore the project context this work needs.</p>
            <small>Prepare it once, then use it here or carry it into a new room.</small>
          </div>
          <b>Active project · {projectId}</b>
        </header>
        <ReconstructionWorkspace key={projectId} projectId={projectId} />
      </div>
    </main>
  );
}
