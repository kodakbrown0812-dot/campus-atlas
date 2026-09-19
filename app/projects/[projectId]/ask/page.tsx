import Link from "next/link";
import TransferRoom from "../work/transfer-room";
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
            <span>Transfer</span>
            <h1>Continue in a fresh room</h1>
            <p>Atlas applies one final relevance filter, asks only for governing clarity it cannot safely infer, and prepares the finished transfer.</p>
          </div>
        </header>
        <TransferRoom key={projectId} projectId={projectId} surface="transfer" />
      </div>
    </main>
  );
}
