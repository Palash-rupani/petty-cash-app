export function getClusterName(
  cluster?: { name?: string } | null
) {
  if (!cluster?.name) {
    return "Unknown Cluster";
  }

  return cluster.name;
}
