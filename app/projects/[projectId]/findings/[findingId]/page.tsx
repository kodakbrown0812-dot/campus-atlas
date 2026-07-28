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
          ← Atlas Found
        </Link>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Review one consequence</span>
            <h1>Finding review</h1>
            <p>Atlas’s proposal and Cody’s governed wording remain distinct, versioned records.</p>
          </div>
        </header>
        <FindingReview findingId={findingId} projectId={projectId} />
      </div>
    </main>
  );
}
