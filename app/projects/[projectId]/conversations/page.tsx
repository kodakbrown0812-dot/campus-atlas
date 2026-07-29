import { redirect } from "next/navigation";

export default async function ConversationsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/projects/${encodeURIComponent(projectId)}/work`);
}
