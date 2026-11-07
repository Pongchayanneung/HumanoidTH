"use server";

import type { WorkflowUnavailable } from "@/lib/operator-auth/contracts";

export type ContributionMapPoint = {
  id: string;
  title: string;
  organization: string;
  locationLabel: string;
  latitude: number;
  longitude: number;
  summary: string;
  contributorType: string;
  contributionCount: number;
  detailsList: string[];
};

export async function analyzeClustersWithGemini(): Promise<WorkflowUnavailable> {
  return { ok: false, code: "WORKFLOW_UNAVAILABLE" };
}

// Public cache disclosure and honest map behavior belong to #5/#6. Until then,
// a read must neither reveal the old cache nor generate, seed or persist data.
export async function fetchContributionClusters(): Promise<ContributionMapPoint[]> {
  return [];
}

export async function reanalyzeClustersWithGemini(): Promise<WorkflowUnavailable> {
  return { ok: false, code: "WORKFLOW_UNAVAILABLE" };
}
