"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { WorkflowUnavailable } from "@/lib/operator-auth/contracts";
import { signInOperator, signOutOperator } from "@/lib/operator-auth/web";

// These contracts remain callable by older clients while their workflows are
// unavailable. Deny before reading identity, form fields or business storage.
// Submission and publication workflow for S5 (Issue #22).
// Community contributions can be submitted and reviewed by authorized operators.
// Unsupported submission types remain fail-closed with WORKFLOW_UNAVAILABLE.
export async function createSubmission(formData: FormData): Promise<{ ok: boolean; code?: string; message?: string; submissionId?: string }> {
  try {
    const submissionType = formData.get("submissionType");
    if (submissionType !== "contribution") {
      return { ok: false, code: "WORKFLOW_UNAVAILABLE" };
    }
    const { createSubmissionWorkflow } = await import("@/lib/submission-workflow");
    const title = String(formData.get("title") || "");
    const url = formData.get("url") ? String(formData.get("url")) : null;
    const notes = formData.get("notes") ? String(formData.get("notes")) : null;
    const submitterName = formData.get("submitterName") ? String(formData.get("submitterName")) : null;
    const submitterContact = formData.get("submitterContact") ? String(formData.get("submitterContact")) : null;
    const organization = formData.get("organization") ? String(formData.get("organization")) : null;
    const contributionType = formData.get("contributionType") ? String(formData.get("contributionType")) : "community_submission";
    const targetRecordId = formData.get("targetRecordId") ? String(formData.get("targetRecordId")) : null;

    return await createSubmissionWorkflow({
      submissionType: "contribution",
      title,
      url,
      notes,
      submitterName,
      submitterContact,
      payload: {
        organization,
        contributionType,
        targetRecordId,
        description: notes
      }
    });
  } catch {
    return { ok: false, code: "WORKFLOW_UNAVAILABLE" };
  }
}

export async function updateSubmissionStatus(
  id: string,
  status: "APPROVED" | "REJECTED" | "NEEDS_REVIEW",
  reviewNotes?: string
): Promise<{ ok: boolean; code?: string; message?: string; publishedRecordId?: string }> {
  try {
    if (status !== "APPROVED" && status !== "REJECTED") {
      return { ok: false, code: "WORKFLOW_UNAVAILABLE" };
    }
    if (typeof id !== "string" || !id.trim()) {
      return { ok: false, code: "WORKFLOW_UNAVAILABLE" };
    }
    const { reviewSubmissionWorkflow } = await import("@/lib/submission-workflow");
    return await reviewSubmissionWorkflow({
      submissionId: id,
      decision: status,
      reviewNotes
    });
  } catch {
    return { ok: false, code: "WORKFLOW_UNAVAILABLE" };
  }
}

export async function runDataPull(_formData: FormData): Promise<WorkflowUnavailable> {
  return { ok: false, code: "WORKFLOW_UNAVAILABLE" };
}

export async function loginAsUser(_email: string, _role: string): Promise<WorkflowUnavailable> {
  return { ok: false, code: "WORKFLOW_UNAVAILABLE" };
}

export async function registerAndLoginUser(_formData: FormData): Promise<WorkflowUnavailable> {
  return { ok: false, code: "WORKFLOW_UNAVAILABLE" };
}

export async function logoutUser(): Promise<never> {
  const result = await signOutOperator();
  if (result.ok) redirect("/admin-login");
  const error = result.code === "FORBIDDEN_ORIGIN" ? "forbidden_origin" : "unavailable";
  redirect(`/admin?error=${error}`);
}

export async function adminLoginAction(formData: FormData): Promise<never> {
  const email = formData.get("email");
  const password = formData.get("password");
  const result = await signInOperator({
    email: typeof email === "string" ? email : "",
    // Password whitespace is credential data; the auth adapter owns validation.
    password: typeof password === "string" ? password : ""
  });
  if (result.ok) redirect("/admin");
  const errors = {
    INVALID_CREDENTIALS: "invalid_credentials",
    THROTTLED: "throttled",
    UNAVAILABLE: "unavailable",
    FORBIDDEN_ORIGIN: "forbidden_origin"
  } as const;
  redirect(`/admin-login?error=${errors[result.code]}`);
}

export async function setLanguage(lang: "en" | "th"): Promise<void> {
  if (lang !== "en" && lang !== "th") return;
  const cookieStore = await cookies();
  cookieStore.set("lang", lang, { path: "/" });
  revalidatePath("/", "layout");
}

export async function upsertSourceRecordAction(_formData: FormData): Promise<WorkflowUnavailable> {
  return { ok: false, code: "WORKFLOW_UNAVAILABLE" };
}

export async function upsertRobotModelAction(_formData: FormData): Promise<WorkflowUnavailable> {
  return { ok: false, code: "WORKFLOW_UNAVAILABLE" };
}

export async function upsertContributionAction(_formData: FormData): Promise<WorkflowUnavailable> {
  return { ok: false, code: "WORKFLOW_UNAVAILABLE" };
}

export async function upsertSubmittedDataAction(_formData: FormData): Promise<WorkflowUnavailable> {
  return { ok: false, code: "WORKFLOW_UNAVAILABLE" };
}
