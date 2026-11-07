import { MetadataRoute } from "next";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://humanoid.or.th";

  const routes = [
    "",
    "/search",
    "/sources",
    "/robots",
    "/perspectives",
    "/contributions",
    "/map",
    "/network",
    "/analytics",
    "/inventory",
    "/submit-data"
  ];

  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: "daily",
    priority: route === "" ? 1.0 : 0.8
  }));
}
