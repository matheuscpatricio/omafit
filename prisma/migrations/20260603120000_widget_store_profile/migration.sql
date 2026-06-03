-- CreateTable
CREATE TABLE "WidgetStoreProfile" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "audience" TEXT NOT NULL DEFAULT 'mixed',
    "priceBand" TEXT NOT NULL DEFAULT 'unknown',
    "primaryCategories" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'inferred',
    "updatedAt" DATETIME NOT NULL
);
