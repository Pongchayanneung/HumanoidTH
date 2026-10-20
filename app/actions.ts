"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { SourceType } from "../generated/prisma";
import { prisma } from "@/lib/prisma";
import { runAdapter } from "@/lib/ingest/adapters";
import { canonicalizeUrl } from "@/lib/url";
import { signAdminSession } from "@/lib/auth";
import { requireAdmin } from "@/lib/require-admin";

function clampSelfServiceRole(role: string): "USER" | "RESEARCHER" {
  return role === "RESEARCHER" ? "RESEARCHER" : "USER";
}

function readTextField(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function readOptionalTextField(formData: FormData, key: string) {
  const value = readTextField(formData, key);
  return value || null;
}

function readOptionalUrlField(formData: FormData, key: string) {
  const value = canonicalizeUrl(readTextField(formData, key));
  return value || null;
}

function readOptionalNumberField(formData: FormData, key: string) {
  const value = readTextField(formData, key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readOptionalDateField(formData: FormData, key: string) {
  const value = readTextField(formData, key);
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function revalidateAtlasCms() {
  const paths = [
    "/",
    "/dashboard",
    "/database",
    "/robots",
    "/inventory",
    "/contributions",
    "/perspectives",
    "/analytics",
    "/submit-data",
    "/admin",
    "/admin/submitted-data",
    "/admin/cms"
  ];

  for (const path of paths) {
    revalidatePath(path);
  }
}

export async function createSubmission(formData: FormData) {
  const cookieStore = await cookies();
  const currentEmail = cookieStore.get("user_email")?.value;
  if (!currentEmail) {
    redirect("/profile?from=/submit-data");
  }

  const user = await prisma.user.findUnique({ where: { email: currentEmail } });
  if (!user) {
    redirect("/profile?from=/submit-data");
  }

  await prisma.submittedData.create({
    data: {
      submissionType: String(formData.get("submissionType") ?? "source_url"),
      title: String(formData.get("title") ?? ""),
      url: canonicalizeUrl(String(formData.get("url") ?? "")) || null,
      notes: String(formData.get("notes") ?? "") || null,
      submitterName: user.name || null,
      submitterContact: user.email,
      submittedById: user.id,
      status: "QUEUED"
    }
  });

  revalidateAtlasCms();
  revalidatePath("/profile");
  redirect("/profile");
}

export async function updateSubmissionStatus(id: string, status: "APPROVED" | "REJECTED" | "NEEDS_REVIEW") {
  await requireAdmin();
  await prisma.submittedData.update({ where: { id }, data: { status } });
  revalidateAtlasCms();
}

export async function runDataPull(formData: FormData) {
  await requireAdmin();
  const adapter = String(formData.get("adapter") ?? "OPENALEX") as SourceType;
  const query = String(formData.get("query") ?? "").trim();
  const limit = Number(formData.get("limit") ?? 10);

  if (!query) {
    throw new Error("Query is required.");
  }

  const job = await prisma.sourcePullJob.create({
    data: { adapter, query, status: "RUNNING", startedAt: new Date() }
  });

  try {
    const result = await runAdapter(adapter, { query, limit });
    await prisma.sourcePullJob.update({
      where: { id: job.id },
      data: {
        status: result.missingKeys?.length ? "SKIPPED_MISSING_KEY" : "SUCCEEDED",
        recordsFound: result.recordsFound,
        recordsSaved: result.recordsSaved,
        errorMessage: result.missingKeys?.join(", ") || null,
        finishedAt: new Date()
      }
    });
  } catch (error) {
    await prisma.sourcePullJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Unknown ingestion error",
        finishedAt: new Date()
      }
    });
  }

  revalidatePath("/data-pulls");
  revalidatePath("/");
}

export async function loginAsUser(email: string, role: string) {
  const safeRole = clampSelfServiceRole(role);
  const user = await prisma.user.upsert({
    where: { email },
    update: { role: safeRole },
    create: {
      email,
      name: email.split("@")[0],
      role: safeRole
    }
  });

  const cookieStore = await cookies();
  cookieStore.set("user_email", user.email, { path: "/" });
  cookieStore.set("user_role", user.role, { path: "/" });
  cookieStore.delete("admin_session");
  revalidatePath("/profile");
  revalidateAtlasCms();
  redirect("/profile");
}

export async function registerAndLoginUser(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const role = clampSelfServiceRole(String(formData.get("role") ?? "USER"));
  const redirectTo = String(formData.get("redirectTo") ?? "/profile");

  if (!email) {
    throw new Error("Email is required");
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name: name || undefined,
      role
    },
    create: {
      email,
      name: name || email.split("@")[0],
      role
    }
  });

  const cookieStore = await cookies();
  cookieStore.set("user_email", user.email, { path: "/" });
  cookieStore.set("user_role", user.role, { path: "/" });
  cookieStore.delete("admin_session");
  revalidatePath("/profile");
  revalidateAtlasCms();
  redirect(redirectTo.startsWith("/") ? redirectTo : "/profile");
}

export async function logoutUser() {
  const cookieStore = await cookies();
  cookieStore.delete("user_email");
  cookieStore.delete("user_role");
  cookieStore.delete("admin_session");
  revalidatePath("/profile");
  revalidateAtlasCms();
  redirect("/profile");
}

export async function adminLoginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();

  const expectedUser = process.env.ADMIN_BASIC_USER;
  const expectedPassword = process.env.ADMIN_BASIC_PASSWORD;

  if (!expectedUser || !expectedPassword) {
    redirect("/admin-login?error=not_configured");
  }

  if (email === expectedUser && password === expectedPassword) {
    const user = await prisma.user.upsert({
      where: { email },
      update: { role: "ADMIN" },
      create: { email, name: "Admin", role: "ADMIN" }
    });

    const cookieStore = await cookies();
    const token = await signAdminSession(user.email);
    cookieStore.set("user_email", user.email, { path: "/" });
    cookieStore.set("user_role", "ADMIN", { path: "/" });
    cookieStore.set("admin_session", token, { path: "/", httpOnly: true, sameSite: "lax" });

    revalidateAtlasCms();
    redirect("/admin?collection=submitted-data");
  } else {
    redirect("/admin-login?error=invalid_credentials");
  }
}

export async function setLanguage(lang: "en" | "th") {
  const cookieStore = await cookies();
  cookieStore.set("lang", lang, { path: "/" });
  revalidatePath("/", "layout");
}

export async function upsertSourceRecordAction(formData: FormData) {
  await requireAdmin();
  const id = readTextField(formData, "id");
  const url = readOptionalUrlField(formData, "url");
  const sourceType = readTextField(formData, "sourceType") as any;
  const title = readTextField(formData, "title");

  if (!title) throw new Error("Source title is required.");
  if (!url) throw new Error("Source URL is required.");

  const existing = id
    ? await prisma.sourceRecord.findUnique({ where: { id }, select: { rawMeta: true } })
    : null;

  const payload = {
    sourceType,
    title,
    url,
    excerpt: readOptionalTextField(formData, "excerpt") || "",
    publishedAt: readOptionalDateField(formData, "publishedAt"),
    author: readOptionalTextField(formData, "author"),
    platform: readOptionalTextField(formData, "platform"),
    relevanceStatus: readTextField(formData, "relevanceStatus") as any,
    relevanceReason: readOptionalTextField(formData, "relevanceReason"),
    relevanceConfidence: readOptionalNumberField(formData, "relevanceConfidence") ?? 0
  };

  if (id) {
    await prisma.sourceRecord.update({ where: { id }, data: { ...payload, rawMeta: existing?.rawMeta ?? {} } });
  } else {
    await prisma.sourceRecord.upsert({
      where: { url },
      create: { ...payload, rawMeta: {} },
      update: { ...payload, rawMeta: existing?.rawMeta ?? {} }
    });
  }

  revalidateAtlasCms();
}

export async function upsertRobotModelAction(formData: FormData) {
  await requireAdmin();
  const id = readTextField(formData, "id");
  const canonicalName = readTextField(formData, "canonicalName");

  if (!canonicalName) throw new Error("Canonical name is required.");

  const existing = id
    ? await prisma.robotModel.findUnique({ where: { id }, select: { sourceMeta: true } })
    : null;

  const payload = {
    canonicalName,
    manufacturer: readOptionalTextField(formData, "manufacturer"),
    developerOrg: readOptionalTextField(formData, "developerOrg"),
    countryOfOrigin: readOptionalTextField(formData, "countryOfOrigin"),
    robotType: readOptionalTextField(formData, "robotType") || "unknown",
    embodimentLevel: readOptionalTextField(formData, "embodimentLevel"),
    primaryUseCase: readOptionalTextField(formData, "primaryUseCase"),
    thailandStatus: readOptionalTextField(formData, "thailandStatus") || "observed_in_thailand",
    statusConfidence: readOptionalNumberField(formData, "statusConfidence") ?? 0.5,
    officialUrl: readOptionalUrlField(formData, "officialUrl"),
    description: readOptionalTextField(formData, "description"),
    firstSeenYear: readOptionalNumberField(formData, "firstSeenYear"),
    lastVerifiedAt: readOptionalDateField(formData, "lastVerifiedAt")
  };

  if (id) {
    await prisma.robotModel.update({ where: { id }, data: { ...payload, sourceMeta: existing?.sourceMeta ?? {} } });
  } else {
    await prisma.robotModel.upsert({
      where: { canonicalName },
      create: { ...payload, sourceMeta: {} },
      update: { ...payload, sourceMeta: existing?.sourceMeta ?? {} }
    });
  }

  revalidateAtlasCms();
}

export async function upsertContributionAction(formData: FormData) {
  await requireAdmin();
  const id = readTextField(formData, "id");
  const title = readTextField(formData, "title");
  const contributionType = readTextField(formData, "contributionType");
  const sourceUrl = readOptionalUrlField(formData, "sourceUrl");

  if (!title) throw new Error("Contribution title is required.");
  if (!contributionType) throw new Error("Contribution type is required.");

  const payload = {
    contributorName: readOptionalTextField(formData, "contributorName"),
    contributorType: readOptionalTextField(formData, "contributorType"),
    organization: readOptionalTextField(formData, "organization"),
    contributionType,
    title,
    description: readOptionalTextField(formData, "description"),
    relatedRobotModelId: readOptionalTextField(formData, "relatedRobotModelId"),
    sourceUrl,
    license: readOptionalTextField(formData, "license"),
    visibility: readOptionalTextField(formData, "visibility") || "public",
    verificationStatus: readOptionalTextField(formData, "verificationStatus") as any || "NEEDS_REVIEW"
  };

  if (id) {
    await prisma.contribution.update({ where: { id }, data: payload });
  } else if (sourceUrl) {
    await prisma.contribution.upsert({
      where: { sourceUrl },
      create: payload,
      update: payload
    });
  } else {
    await prisma.contribution.create({ data: payload });
  }

  revalidateAtlasCms();
}

export async function upsertSubmittedDataAction(formData: FormData) {
  await requireAdmin();
  const id = readTextField(formData, "id");
  const title = readTextField(formData, "title");
  const submissionType = readTextField(formData, "submissionType");

  if (!title) throw new Error("Submission title is required.");
  if (!submissionType) throw new Error("Submission type is required.");

  const payload = {
    submissionType,
    title,
    url: readOptionalUrlField(formData, "url"),
    notes: readOptionalTextField(formData, "notes"),
    submitterName: readOptionalTextField(formData, "submitterName"),
    submitterContact: readOptionalTextField(formData, "submitterContact"),
    status: readOptionalTextField(formData, "status") as any || "QUEUED",
    reviewNotes: readOptionalTextField(formData, "reviewNotes")
  };

  if (id) {
    await prisma.submittedData.update({ where: { id }, data: payload });
  } else {
    await prisma.submittedData.create({ data: { ...payload, payloadJson: {} } });
  }

  revalidateAtlasCms();
}
