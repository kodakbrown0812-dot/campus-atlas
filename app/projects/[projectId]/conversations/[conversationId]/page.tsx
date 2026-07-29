import ConversationWorkspace from "./workspace";
import styles from "../conversation.module.css";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ projectId: string; conversationId: string }>;
}) {
  const { projectId, conversationId } = await params;
  return (
    <main className={styles.page} data-canonical-conversation>
      <ConversationWorkspace key={`${projectId}:${conversationId}`} projectId={projectId} conversationId={conversationId} />
    </main>
  );
}
