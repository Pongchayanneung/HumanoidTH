"use server";

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

export async function reanalyzeClustersWithGemini(): Promise<{ status: "disabled" }> {
  return { status: "disabled" };
}
