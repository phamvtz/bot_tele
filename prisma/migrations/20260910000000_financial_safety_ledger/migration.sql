-- Financial-safety markers used to make coupon, wallet and manual admin flows
-- idempotent across retries and multiple workers.
ALTER TABLE "bot"."Order"
    ADD COLUMN IF NOT EXISTS "couponReservedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "couponReleasedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "walletSettledAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "manualPaidAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "manualDeliveredAt" TIMESTAMP(3);

ALTER TABLE "bot"."GiftCodeRedemption"
    ADD COLUMN IF NOT EXISTS "issuedKeySyncError" TEXT,
    ADD COLUMN IF NOT EXISTS "issuedKeyPayload" TEXT;

ALTER TABLE "bot"."Referral"
    ADD COLUMN IF NOT EXISTS "rewardRefereeSyncError" TEXT,
    ADD COLUMN IF NOT EXISTS "rewardRefereeSyncPayload" TEXT,
    ADD COLUMN IF NOT EXISTS "rewardReferrerSyncError" TEXT,
    ADD COLUMN IF NOT EXISTS "rewardReferrerSyncPayload" TEXT;

-- Durable shared ledger: one external bank/crypto transaction may fund exactly
-- one order or wallet deposit.
CREATE TABLE IF NOT EXISTS "bot"."PaymentEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLAIMED',
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentEvent_eventKey_key"
    ON "bot"."PaymentEvent"("eventKey");

CREATE INDEX IF NOT EXISTS "PaymentEvent_status_createdAt_idx"
    ON "bot"."PaymentEvent"("status", "createdAt");
