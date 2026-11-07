import type { OperatorAuthStore } from "./store";
import { loadAuthEnvironment, readOperatorConfig } from "./config";
import { createOperatorAuthService } from "./service";

let storePromise: Promise<OperatorAuthStore> | undefined;
let storeUrl: string | undefined;
export function runtimeOperatorConfig() {
  loadAuthEnvironment();
  return readOperatorConfig();
}

// Never import the application's eager lib/prisma module. Client construction/import
// occurs only inside a handled operation after valid config and token checks.
async function runtimeStore(): Promise<OperatorAuthStore> {
  const config = runtimeOperatorConfig();
  if (!config) throw new Error("Authentication unavailable");
  if (!storePromise || storeUrl !== config.databaseUrl) {
    storeUrl = config.databaseUrl;
    storePromise = (async () => {
      const [{ PrismaClient }, { createPostgresAuthStore }] = await Promise.all([import("../../generated/prisma"), import("./postgres-store")]);
      return createPostgresAuthStore(new PrismaClient({ datasourceUrl: config.databaseUrl, log: [] }));
    })().catch(() => { storePromise = undefined; throw new Error("Authentication unavailable"); });
  }
  return storePromise;
}

export const runtimeOperatorAuth = createOperatorAuthService({ config: runtimeOperatorConfig, store: runtimeStore });
