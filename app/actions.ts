"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { WorkflowUnavailable } from "@/lib/operator-auth/contracts";
import { signInOperator, signOutOperator } from "@/lib/operator-auth/web";

// These contracts remain callable by older clients while their workflows are
// unavailable. Deny before reading identity, form fields or business storage.
export async function createSubmission(_formData: FormData): Promise<WorkflowUnavailable> {
  return { ok: false, code: "WORKFLOW_UNAVAILABLE" };
}

export async function updateSubmissionStatus(_id: string, _status: "APPROVED" | "REJECTED" | "NEEDS_REVIEW"): Promise<WorkflowUnavailable> {
  return { ok: false, code: "WORKFLOW_UNAVAILABLE" };
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
