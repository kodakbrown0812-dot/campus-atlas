import StructureWorkspace from "./structure-workspace";

export default async function StructurePage({
  params,
}: {
  params: Promise<{ projectId: string; conversationId: string }>;
}) {
  const { projectId, conversationId } = await params;
  return <StructureWorkspace key={`${projectId}:${conversationId}`} projectId={projectId} conversationId={conversationId} />;
}
