import "server-only";
import type { PrismaClient } from "../../generated/prisma";
import { runtimeOperatorConfig } from "../operator-auth/runtime";
import { getOperatorPrincipal } from "../operator-auth/web";
import { createInspectionService } from "./service";

let client: { databaseUrl: string; prisma: PrismaClient } | undefined;

export const { inspectCmsRecord } = createInspectionService({
  authorize: getOperatorPrincipal,
  async repository() {
    const config = runtimeOperatorConfig();
    if (!config) throw new Error("Inspection unavailable");
    const { databaseUrl } = config;
    const [{ PrismaClient }, { createPostgresInspectionRepository }] = await Promise.all([
      import("../../generated/prisma"),
      import("./postgres-repository")
    ]);
    if (client?.databaseUrl !== databaseUrl) {
      client = { databaseUrl, prisma: new PrismaClient({ datasourceUrl: databaseUrl, log: [] }) };
    }
    return createPostgresInspectionRepository(client.prisma);
  }
});
