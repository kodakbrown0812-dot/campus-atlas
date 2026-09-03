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
            <h1>Prepare a transfer directly</h1>
            <p>Steward is the transfer intelligence Atlas uses after reconstructing a room. For the complete experience, start with Transfer on Home.</p>
          </div>
        </header>
        <ReconstructionWorkspace key={projectId} projectId={projectId} />
      </div>
    </main>
  );
}
