-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ProductSource" AS ENUM ('CONTENT', 'DERIVED');

-- CreateEnum
CREATE TYPE "AdSource" AS ENUM ('PRECISE', 'ALLOCATED');

-- CreateEnum
CREATE TYPE "SupplyStatus" AS ENUM ('IN_TRANSIT', 'PARTIAL', 'DELAYED', 'ZERO_NOT_FOUND', 'WAIT_AFTER_ZERO', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'STALE_RESET');

-- CreateEnum
CREATE TYPE "SupplyHealth" AS ENUM ('NO_STOCK', 'CRITICAL', 'ORDER', 'NORMAL', 'OVERSTOCK');

-- CreateEnum
CREATE TYPE "DataQuality" AS ENUM ('VERIFIED', 'VERIFIED_BUFFER', 'PARTIAL', 'NONE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "companyName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wb_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "categories" TEXT,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wb_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nmId" INTEGER NOT NULL,
    "supplierArticle" TEXT NOT NULL,
    "barcode" TEXT,
    "category" TEXT,
    "subject" TEXT,
    "brand" TEXT,
    "title" TEXT,
    "photoUrl" TEXT,
    "source" "ProductSource" NOT NULL DEFAULT 'DERIVED',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_costs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nmId" INTEGER NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL,
    "purchaseCost" DECIMAL(14,2),
    "inboundLogisticsCost" DECIMAL(14,2),
    "packagingCost" DECIMAL(14,2),
    "labelingCost" DECIMAL(14,2),
    "customsCertificationCost" DECIMAL(14,2),
    "otherPreWbCost" DECIMAL(14,2),
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 14,
    "orderBufferDays" INTEGER NOT NULL DEFAULT 7,
    "orderQuantum" INTEGER NOT NULL DEFAULT 1,
    "targetStockDays" INTEGER NOT NULL DEFAULT 45,
    "taxPercent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nmId" INTEGER NOT NULL,
    "leadTimeDays" INTEGER,
    "orderBufferDays" INTEGER,
    "orderQuantum" INTEGER,
    "targetStockDays" INTEGER,
    "taxPercent" DECIMAL(6,3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_rows" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "srid" TEXT NOT NULL,
    "nmId" INTEGER NOT NULL,
    "supplierArticle" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "lastChangeDate" TIMESTAMP(3) NOT NULL,
    "isCancel" BOOLEAN NOT NULL DEFAULT false,
    "totalPrice" DECIMAL(14,2),
    "discountPercent" DECIMAL(6,3),
    "finishedPrice" DECIMAL(14,2),
    "priceWithDisc" DECIMAL(14,2),
    "warehouseName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_rows" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "saleID" TEXT NOT NULL,
    "nmId" INTEGER NOT NULL,
    "supplierArticle" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "lastChangeDate" TIMESTAMP(3) NOT NULL,
    "isReturn" BOOLEAN NOT NULL DEFAULT false,
    "forPay" DECIMAL(14,2),
    "finishedPrice" DECIMAL(14,2),
    "priceWithDisc" DECIMAL(14,2),
    "totalPrice" DECIMAL(14,2),
    "discountPercent" DECIMAL(6,3),
    "warehouseName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nmId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "inWayToClient" INTEGER NOT NULL DEFAULT 0,
    "quantityFull" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_rows" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rrdId" BIGINT NOT NULL,
    "realizationReportId" BIGINT,
    "nmId" INTEGER,
    "supplierArticle" TEXT,
    "docTypeName" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "retailPrice" DECIMAL(14,2),
    "retailAmount" DECIMAL(14,2),
    "ppvzForPay" DECIMAL(14,2),
    "deliveryRub" DECIMAL(14,2),
    "storageFee" DECIMAL(14,2),
    "penalty" DECIMAL(14,2),
    "deduction" DECIMAL(14,2),
    "acceptance" DECIMAL(14,2),
    "returnAmount" DECIMAL(14,2),
    "commissionPercent" DECIMAL(6,3),
    "dateFrom" TIMESTAMP(3),
    "dateTo" TIMESTAMP(3),
    "saleDt" TIMESTAMP(3),
    "rrDt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_stats" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nmId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "spend" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "source" "AdSource" NOT NULL DEFAULT 'PRECISE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplies" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nmId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "acceptedQty" INTEGER NOT NULL DEFAULT 0,
    "expectedDate" DATE NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "SupplyStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "watchAfterZero" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedStock" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hidden_tasks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nmId" INTEGER NOT NULL,
    "hiddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hidden_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "steps" JSONB,
    "stats" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_analytics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nmId" INTEGER NOT NULL,
    "currentStock" INTEGER NOT NULL DEFAULT 0,
    "inTransitQty" INTEGER NOT NULL DEFAULT 0,
    "v7" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "v14" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "v30" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "avgDailySales" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "daysOfStock" DECIMAL(14,2),
    "daysUntilOrder" INTEGER,
    "health" "SupplyHealth" NOT NULL DEFAULT 'NORMAL',
    "recommendedQty" INTEGER NOT NULL DEFAULT 0,
    "overstockQty" INTEGER NOT NULL DEFAULT 0,
    "deficitDate" DATE,
    "revenue30" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "profit30" DECIMAL(14,2),
    "units30" INTEGER NOT NULL DEFAULT 0,
    "missedProfit30" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "dataQuality" "DataQuality" NOT NULL DEFAULT 'NONE',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "wb_keys_userId_key" ON "wb_keys"("userId");

-- CreateIndex
CREATE INDEX "products_userId_archived_idx" ON "products"("userId", "archived");

-- CreateIndex
CREATE INDEX "products_userId_supplierArticle_idx" ON "products"("userId", "supplierArticle");

-- CreateIndex
CREATE UNIQUE INDEX "products_userId_nmId_key" ON "products"("userId", "nmId");

-- CreateIndex
CREATE INDEX "product_costs_userId_nmId_effectiveFrom_idx" ON "product_costs"("userId", "nmId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "supply_settings_userId_key" ON "supply_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "product_settings_userId_nmId_key" ON "product_settings"("userId", "nmId");

-- CreateIndex
CREATE INDEX "order_rows_userId_nmId_date_idx" ON "order_rows"("userId", "nmId", "date");

-- CreateIndex
CREATE INDEX "order_rows_userId_date_idx" ON "order_rows"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "order_rows_userId_srid_key" ON "order_rows"("userId", "srid");

-- CreateIndex
CREATE INDEX "sale_rows_userId_nmId_date_idx" ON "sale_rows"("userId", "nmId", "date");

-- CreateIndex
CREATE INDEX "sale_rows_userId_date_idx" ON "sale_rows"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "sale_rows_userId_saleID_key" ON "sale_rows"("userId", "saleID");

-- CreateIndex
CREATE INDEX "stock_snapshots_userId_date_idx" ON "stock_snapshots"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "stock_snapshots_userId_nmId_date_key" ON "stock_snapshots"("userId", "nmId", "date");

-- CreateIndex
CREATE INDEX "finance_rows_userId_nmId_dateFrom_idx" ON "finance_rows"("userId", "nmId", "dateFrom");

-- CreateIndex
CREATE INDEX "finance_rows_userId_rrDt_idx" ON "finance_rows"("userId", "rrDt");

-- CreateIndex
CREATE UNIQUE INDEX "finance_rows_userId_rrdId_key" ON "finance_rows"("userId", "rrdId");

-- CreateIndex
CREATE INDEX "ad_stats_userId_date_idx" ON "ad_stats"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ad_stats_userId_nmId_date_source_key" ON "ad_stats"("userId", "nmId", "date", "source");

-- CreateIndex
CREATE INDEX "supplies_userId_nmId_status_idx" ON "supplies"("userId", "nmId", "status");

-- CreateIndex
CREATE INDEX "supplies_userId_status_idx" ON "supplies"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "hidden_tasks_userId_nmId_key" ON "hidden_tasks"("userId", "nmId");

-- CreateIndex
CREATE INDEX "sync_runs_userId_startedAt_idx" ON "sync_runs"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "product_analytics_userId_health_idx" ON "product_analytics"("userId", "health");

-- CreateIndex
CREATE UNIQUE INDEX "product_analytics_userId_nmId_key" ON "product_analytics"("userId", "nmId");

-- AddForeignKey
ALTER TABLE "wb_keys" ADD CONSTRAINT "wb_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_costs" ADD CONSTRAINT "product_costs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_settings" ADD CONSTRAINT "supply_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_settings" ADD CONSTRAINT "product_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_rows" ADD CONSTRAINT "order_rows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_rows" ADD CONSTRAINT "sale_rows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_snapshots" ADD CONSTRAINT "stock_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_rows" ADD CONSTRAINT "finance_rows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_stats" ADD CONSTRAINT "ad_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplies" ADD CONSTRAINT "supplies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hidden_tasks" ADD CONSTRAINT "hidden_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_analytics" ADD CONSTRAINT "product_analytics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
