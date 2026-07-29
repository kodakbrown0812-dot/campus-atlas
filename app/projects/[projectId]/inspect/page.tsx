import styles from "../work/work.module.css";

export default async function InspectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Inspect · {projectId}</span>
          <h1>Canonical records remain inspectable</h1>
          <p>The final Cases, Reasoning, Mechanisms, Principles, Blueprint, and Packets tabs arrive in Slice 6B.</p>
        </div>
      </header>
      <section className={styles.emptyState}>
        <span>Slice 6A boundary</span>
        <h2>No Inspect record is selected.</h2>
        <p>This destination is present in the final shell, but Slice 6A does not invent the Slice 6B inspection experience.</p>
      </section>
    </div>
  );
}
