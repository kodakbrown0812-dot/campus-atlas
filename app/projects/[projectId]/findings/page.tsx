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
        <Link className={styles.back} href={`/projects/${encodeURIComponent(projectId)}/conversations`}>
          ← Conversations
        </Link>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Canonical governance</span>
            <h1>Atlas Found</h1>
            <p>Review one proposed consequence at a time. Nothing here governs retrieval until the backend confirms it.</p>
          </div>
          <span className={styles.status}>Slice 3 review queue</span>
        </header>
        <FindingQueue projectId={projectId} />
      </div>
    </main>
  );
}
