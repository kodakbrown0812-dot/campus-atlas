import Link from "next/link";
import FindingReview from "./finding-review";
import styles from "../../conversations/conversation.module.css";

export default async function FindingPage({
  params,
}: {
  params: Promise<{ projectId: string; findingId: string }>;
}) {
  const { projectId, findingId } = await params;
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.back} href={`/projects/${encodeURIComponent(projectId)}/findings`}>
          ← Items needing your decision
        </Link>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>One decision</span>
            <h1>What should carry forward?</h1>
            <p>Review Atlas’s wording and its supporting conversation before deciding.</p>
          </div>
        </header>
        <FindingReview findingId={findingId} projectId={projectId} />
      </div>
    </main>
  );
}
