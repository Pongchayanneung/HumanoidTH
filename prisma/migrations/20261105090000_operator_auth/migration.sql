-- Additive authentication tables; no legacy records are read or modified.
CREATE TABLE "OperatorAuthState" (
    "id" TEXT NOT NULL,
    "activeFingerprint" TEXT NOT NULL,
    "activeEpoch" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OperatorAuthState_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OperatorAuthState_singleton" CHECK ("id" = 'operator'),
    CONSTRAINT "OperatorAuthState_attempts" CHECK ("attemptCount" >= 0 AND "attemptCount" <= 5)
);
CREATE TABLE "OperatorSession" (
    "tokenHash" TEXT NOT NULL,
    "configFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "OperatorSession_pkey" PRIMARY KEY ("tokenHash")
);
CREATE INDEX "OperatorSession_expiresAt_idx" ON "OperatorSession"("expiresAt");
