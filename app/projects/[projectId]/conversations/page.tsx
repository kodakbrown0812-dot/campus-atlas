import Link from "next/link";
import ConversationList from "./conversation-list";
import styles from "./conversation.module.css";

export default async function ConversationsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.back} href="/">← Campus Atlas V4.6</Link>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Canonical continuity</span>
            <h1>Conversations</h1>
            <p>Native and imported transcripts share one project-scoped source model.</p>
          </div>
          <span className={styles.status}>Slice 2 canonical state</span>
        </header>
        <ConversationList projectId={projectId} />
      </div>
    </main>
  );
}
