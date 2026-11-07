import "server-only";
import { runtimeOperatorAuth, runtimeOperatorConfig } from "./runtime";
import { createOperatorWebAdapter } from "./web-adapter";

const adapter = createOperatorWebAdapter({
  config: runtimeOperatorConfig,
  core: runtimeOperatorAuth,
  cookies: async () => (await import("next/headers")).cookies(),
  headers: async () => (await import("next/headers")).headers()
});

// Only these token-free results cross server action/page boundaries.
export const signInOperator = adapter.signInOperator;
export const signOutOperator = adapter.signOutOperator;
export const getOperatorPrincipal = adapter.getOperatorPrincipal;
