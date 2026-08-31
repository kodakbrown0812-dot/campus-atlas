import Link from "next/link";
import FindingQueue from "./finding-queue";
import styles from "../conversations/conversation.module.css";

export default async function FindingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.back} href={`/projects/${encodeURIComponent(projectId)}/inspect`}>
          ← Return to Inspect
        </Link>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Needs your decision</span>
            <h1>What should carry forward?</h1>
            <p>Review only the items Atlas cannot settle safely on its own.</p>
          </div>
        </header>
        <FindingQueue projectId={projectId} />
      </div>
    </main>
  );
}
