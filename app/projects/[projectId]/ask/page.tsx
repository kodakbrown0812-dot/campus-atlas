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
            <span>Steward</span>
            <h1>Continue with Atlas</h1>
            <p>Tell Atlas what you are continuing. It will prepare only the project context that matters.</p>
          </div>
        </header>
        <ReconstructionWorkspace key={projectId} projectId={projectId} />
      </div>
    </main>
  );
}
