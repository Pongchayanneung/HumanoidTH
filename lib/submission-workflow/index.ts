import "server-only";
import type { PrismaClient } from "../../generated/prisma";
import { runtimeOperatorConfig } from "../operator-auth/runtime";
import { getOperatorPrincipal } from "../operator-auth/web";
import { createSubmissionWorkflowService } from "./service";
import type { SubmissionWorkflowRepository } from "./contracts";

let client: { databaseUrl: string; prisma: PrismaClient } | undefined;

export const { createSubmission: createSubmissionWorkflow, reviewSubmission: reviewSubmissionWorkflow } =
  createSubmissionWorkflowService({
    authorize: getOperatorPrincipal,
    async repository(): Promise<SubmissionWorkflowRepository> {
      const config = runtimeOperatorConfig();
      if (!config) throw new Error("Database unavailable");
      const { databaseUrl } = config;
      const [{ PrismaClient }, { createPostgresSubmissionWorkflowRepository }] = await Promise.all([
        import("../../generated/prisma"),
        import("./postgres-repository")
      ]);
      if (client?.databaseUrl !== databaseUrl) {
        client = { databaseUrl, prisma: new PrismaClient({ datasourceUrl: databaseUrl, log: [] }) };
      }
      return createPostgresSubmissionWorkflowRepository(client.prisma);
    }
  });

export { createSubmissionWorkflowService };
export * from "./contracts";
