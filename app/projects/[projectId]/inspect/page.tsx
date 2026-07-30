import InspectWorkspace from "./inspect-workspace";

export default async function InspectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <InspectWorkspace key={projectId} projectId={projectId} />;
}
