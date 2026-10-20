import { cookies } from "next/headers";
import { verifyAdminSession } from "@/lib/auth";

export async function requireAdmin(): Promise<string> {
  const cookieStore = await cookies();
  const email = await verifyAdminSession(cookieStore.get("admin_session")?.value);
  const role = cookieStore.get("user_role")?.value;

  if (!email || role !== "ADMIN") {
    throw new Error("Admin privileges are required for this action.");
  }

  return email;
}
