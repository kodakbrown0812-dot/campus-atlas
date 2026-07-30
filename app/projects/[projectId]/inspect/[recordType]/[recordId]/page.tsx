import InspectDetail from "./inspect-detail";

export default async function InspectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; recordType: string; recordId: string }>;
}) {
  const { projectId, recordType, recordId } = await params;
  return <InspectDetail key={`${projectId}:${recordType}:${recordId}`} projectId={projectId} recordId={recordId} recordType={recordType} />;
}
