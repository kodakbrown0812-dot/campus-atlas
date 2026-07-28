import Link from "next/link";
import ReconstructionWorkspace from "./reconstruction-workspace";
import styles from "../conversations/conversation.module.css";

export default async function AskPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.back} href={`/projects/${encodeURIComponent(projectId)}/conversations`}>
          ← Conversations
        </Link>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Canonical reconstruction</span>
            <h1>Ask with Atlas</h1>
            <p>Interpret a task, inspect server-side treatment, compile a bounded packet, and read its immutable receipt.</p>
          </div>
          <span className={styles.status}>Slice 4 verification</span>
        </header>
        <ReconstructionWorkspace projectId={projectId} />
      </div>
    </main>
  );
}
