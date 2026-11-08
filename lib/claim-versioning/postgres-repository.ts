import { prisma } from "@/lib/prisma";
import type { Prisma } from "../../generated/prisma";
import type {
  ClaimVersioningRepository,
  SourceClaimRecord,
  PerspectiveAssertionItem,
  TripletAssertionItem,
  ClaimRelevanceStatus
} from "./contracts";

export class PostgresClaimVersioningRepository implements ClaimVersioningRepository {
  private client: typeof prisma;

  constructor(client: typeof prisma = prisma) {
    this.client = client;
  }

  async findSourceWithClaims(sourceId: string): Promise<{
    source: SourceClaimRecord | null;
    perspectives: PerspectiveAssertionItem[];
    triplets: TripletAssertionItem[];
  }> {
    const record = await this.client.sourceRecord.findUnique({
      where: { id: sourceId },
      include: {
        annotations: true,
        triplets: true
      }
    });

    if (!record) {
      return {
        perspectives: [],
        source: null,
        triplets: []
      };
    }

    const source: SourceClaimRecord = {
      author: record.author,
      createdAt: record.createdAt,
      excerpt: record.excerpt,
      id: record.id,
      platform: record.platform,
      publishedAt: record.publishedAt,
      rawMeta: (record.rawMeta ?? {}) as Record<string, unknown>,
      relevanceConfidence: record.relevanceConfidence,
      relevanceReason: record.relevanceReason,
      relevanceStatus: record.relevanceStatus as ClaimRelevanceStatus,
      sourceType: record.sourceType,
      title: record.title,
      updatedAt: record.updatedAt,
      url: record.url
    };

    const perspectives: PerspectiveAssertionItem[] = record.annotations.map((a) => ({
      confidence: a.confidence,
      evidenceExcerpt: a.evidenceExcerpt,
      id: a.id,
      method: a.method,
      perspectiveTheme: a.perspectiveTheme,
      sentiment: a.sentiment,
      stance: a.stance,
      targetEntity: a.targetEntity
    }));

    const triplets: TripletAssertionItem[] = record.triplets.map((t) => ({
      confidence: t.confidence,
      id: t.id,
      object: t.object,
      relation: t.relation,
      subject: t.subject
    }));

    return {
      perspectives,
      source,
      triplets
    };
  }

  async executeAtomicUpdate(
    sourceId: string,
    updateFn: (current: {
      source: SourceClaimRecord;
      perspectives: PerspectiveAssertionItem[];
      triplets: TripletAssertionItem[];
    }) => Promise<{
      updatedSource: Partial<SourceClaimRecord> & { rawMeta: Record<string, unknown> };
      perspectivesToKeep?: PerspectiveAssertionItem[];
      tripletsToKeep?: TripletAssertionItem[];
      retireAllDerivedClaims?: boolean;
    }>
  ): Promise<{
    source: SourceClaimRecord;
    perspectives: PerspectiveAssertionItem[];
    triplets: TripletAssertionItem[];
    suppressedCount: number;
  }> {
    return await this.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SourceRecord" WHERE id = ${sourceId} FOR UPDATE`;
      const record = await tx.sourceRecord.findUnique({
        where: { id: sourceId },
        include: {
          annotations: true,
          triplets: true
        }
      });

      if (!record) {
        throw new Error(`Source record ${sourceId} not found in atomic update`);
      }

      const currentSource: SourceClaimRecord = {
        author: record.author,
        createdAt: record.createdAt,
        excerpt: record.excerpt,
        id: record.id,
        platform: record.platform,
        publishedAt: record.publishedAt,
        rawMeta: (record.rawMeta ?? {}) as Record<string, unknown>,
        relevanceConfidence: record.relevanceConfidence,
        relevanceReason: record.relevanceReason,
        relevanceStatus: record.relevanceStatus as ClaimRelevanceStatus,
        sourceType: record.sourceType,
        title: record.title,
        updatedAt: record.updatedAt,
        url: record.url
      };

      const currentPerspectives: PerspectiveAssertionItem[] = record.annotations.map((a) => ({
        confidence: a.confidence,
        evidenceExcerpt: a.evidenceExcerpt,
        id: a.id,
        method: a.method,
        perspectiveTheme: a.perspectiveTheme,
        sentiment: a.sentiment,
        stance: a.stance,
        targetEntity: a.targetEntity
      }));

      const currentTriplets: TripletAssertionItem[] = record.triplets.map((t) => ({
        confidence: t.confidence,
        id: t.id,
        object: t.object,
        relation: t.relation,
        subject: t.subject
      }));

      const instruction = await updateFn({
        perspectives: currentPerspectives,
        source: currentSource,
        triplets: currentTriplets
      });

      let suppressedCount = 0;

      if (instruction.retireAllDerivedClaims) {
        const deletedPerspectives = await tx.perspectiveAnnotation.deleteMany({
          where: { sourceId }
        });
        const deletedTriplets = await tx.triplet.deleteMany({
          where: { sourceId }
        });
        suppressedCount = deletedPerspectives.count + deletedTriplets.count;
      } else {
        // Calculate old counts to measure suppressed claims
        const oldPerspectivesCount = currentPerspectives.length;
        const oldTripletsCount = currentTriplets.length;

        const keptPerspectiveIds = (instruction.perspectivesToKeep ?? [])
          .flatMap((p) => p.id && currentPerspectives.some((old) => old.id === p.id) ? [p.id] : []);
        const keptTripletIds = (instruction.tripletsToKeep ?? [])
          .flatMap((t) => t.id && currentTriplets.some((old) => old.id === t.id) ? [t.id] : []);

        await tx.perspectiveAnnotation.deleteMany({ where: { sourceId, id: { notIn: keptPerspectiveIds } } });
        for (const p of instruction.perspectivesToKeep ?? []) {
          const data = {
            confidence: p.confidence, evidenceExcerpt: p.evidenceExcerpt, method: p.method,
            perspectiveTheme: p.perspectiveTheme, sentiment: p.sentiment, stance: p.stance,
            targetEntity: p.targetEntity
          };
          if (p.id && keptPerspectiveIds.includes(p.id)) {
            await tx.perspectiveAnnotation.update({ where: { id: p.id }, data });
          } else {
            await tx.perspectiveAnnotation.create({ data: { ...data, id: p.id, sourceId } });
          }
        }

        await tx.triplet.deleteMany({ where: { sourceId, id: { notIn: keptTripletIds } } });
        for (const t of instruction.tripletsToKeep ?? []) {
          const data = { confidence: t.confidence, object: t.object, relation: t.relation, subject: t.subject };
          if (t.id && keptTripletIds.includes(t.id)) {
            await tx.triplet.update({ where: { id: t.id }, data });
          } else {
            await tx.triplet.create({ data: { ...data, id: t.id, sourceId } });
          }
        }

        const keptPerspectives = instruction.perspectivesToKeep?.length ?? 0;
        const keptTriplets = instruction.tripletsToKeep?.length ?? 0;
        const diffP = Math.max(0, oldPerspectivesCount - keptPerspectives);
        const diffT = Math.max(0, oldTripletsCount - keptTriplets);
        suppressedCount = diffP + diffT;
      }

      // Update the source record
      const updateData: Record<string, unknown> = {
        ...instruction.updatedSource,
        rawMeta: JSON.parse(JSON.stringify(instruction.updatedSource.rawMeta)) as Prisma.InputJsonValue
      };
      if (instruction.updatedSource.relevanceStatus) {
        updateData.relevanceStatus = instruction.updatedSource.relevanceStatus as any;
      }
      const updated = (await tx.sourceRecord.update({
        data: updateData as any,
        include: {
          annotations: true,
          triplets: true
        },
        where: { id: sourceId }
      })) as {
        id: string;
        sourceType: string;
        title: string;
        url: string;
        excerpt: string;
        publishedAt: Date | null;
        author: string | null;
        platform: string | null;
        rawMeta: unknown;
        relevanceConfidence: number;
        relevanceReason: string | null;
        relevanceStatus: string;
        createdAt: Date;
        updatedAt: Date;
        annotations: Array<{
          id: string;
          confidence: number;
          evidenceExcerpt: string;
          method: string;
          perspectiveTheme: string;
          sentiment: string;
          stance: string;
          targetEntity: string;
        }>;
        triplets: Array<{
          id: string;
          confidence: number;
          object: string;
          relation: string;
          subject: string;
        }>;
      };

      const resultSource: SourceClaimRecord = {
        author: updated.author,
        createdAt: updated.createdAt,
        excerpt: updated.excerpt,
        id: updated.id,
        platform: updated.platform,
        publishedAt: updated.publishedAt,
        rawMeta: (updated.rawMeta ?? {}) as Record<string, unknown>,
        relevanceConfidence: updated.relevanceConfidence,
        relevanceReason: updated.relevanceReason,
        relevanceStatus: updated.relevanceStatus as ClaimRelevanceStatus,
        sourceType: updated.sourceType,
        title: updated.title,
        updatedAt: updated.updatedAt,
        url: updated.url
      };

      const resultPerspectives: PerspectiveAssertionItem[] = updated.annotations.map((a) => ({
        confidence: a.confidence,
        evidenceExcerpt: a.evidenceExcerpt,
        id: a.id,
        method: a.method,
        perspectiveTheme: a.perspectiveTheme,
        sentiment: a.sentiment,
        stance: a.stance,
        targetEntity: a.targetEntity
      }));

      const resultTriplets: TripletAssertionItem[] = updated.triplets.map((t) => ({
        confidence: t.confidence,
        id: t.id,
        object: t.object,
        relation: t.relation,
        subject: t.subject
      }));

      return {
        perspectives: resultPerspectives,
        source: resultSource,
        suppressedCount,
        triplets: resultTriplets
      };
    });
  }
}
