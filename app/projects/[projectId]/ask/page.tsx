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
          ← Return to Work
        </Link>
        <header className={styles.header}>
          <div>
            <span>Governed reconstruction</span>
            <h1>Ask with Atlas</h1>
            <p>
              Inspect what Atlas understands, how candidates are treated, the exact packet supplied,
              and the receiving model’s separate answer.
            </p>
          </div>
          <b>Canonical V1.7</b>
        </header>
        <ReconstructionWorkspace key={projectId} projectId={projectId} />
      </div>
    </main>
  );
}
