import WorkWorkspace from "./work-workspace";

export default async function WorkPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <WorkWorkspace key={projectId} projectId={projectId} />;
}
