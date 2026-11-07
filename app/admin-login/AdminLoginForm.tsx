"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff } from "lucide-react";
import { adminLoginAction } from "@/app/actions";

type AdminLoginFormProps = {
  emailLabel: string;
  passwordLabel: string;
  buttonLabel: string;
  pendingLabel: string;
  showPasswordLabel: string;
  hidePasswordLabel: string;
  hasError: boolean;
  invalidCredentials: boolean;
};

function SubmitButton({ buttonLabel, pendingLabel }: Pick<AdminLoginFormProps, "buttonLabel" | "pendingLabel">) {
  const { pending } = useFormStatus();
  return (
    <>
      <button type="submit" className="login-btn" disabled={pending} aria-busy={pending}>
        {pending ? pendingLabel : buttonLabel}
      </button>
      <span role="status" aria-live="polite">{pending ? pendingLabel : ""}</span>
    </>
  );
}

export default function AdminLoginForm({ emailLabel, passwordLabel, buttonLabel, pendingLabel, showPasswordLabel, hidePasswordLabel, hasError, invalidCredentials }: AdminLoginFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <form className="login-form" action={adminLoginAction} aria-describedby={hasError ? "login-error" : undefined}>
      <label className="login-label" htmlFor="operator-email">
        {emailLabel}
        <input id="operator-email" name="email" type="email" className="login-input" required maxLength={254} autoComplete="username" autoCapitalize="none" spellCheck={false} aria-invalid={invalidCredentials || undefined} aria-describedby={hasError ? "login-error" : undefined} />
      </label>
      <label className="login-label" htmlFor="operator-password">{passwordLabel}</label>
      <div className="password-input-wrap">
        <input id="operator-password" name="password" type={showPassword ? "text" : "password"} className="login-input password-input" required autoComplete="current-password" aria-invalid={invalidCredentials || undefined} aria-describedby={hasError ? "login-error" : undefined} />
        <button type="button" className="password-toggle" aria-label={showPassword ? hidePasswordLabel : showPasswordLabel} aria-pressed={showPassword} aria-controls="operator-password" onClick={() => setShowPassword(current => !current)}>
          {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
      <SubmitButton buttonLabel={buttonLabel} pendingLabel={pendingLabel} />
    </form>
  );
}
