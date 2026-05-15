-- CreateTable
CREATE TABLE "WidgetSuggestionPairStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "anchorHandle" TEXT NOT NULL,
    "suggestedHandle" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "stylistClicks" INTEGER NOT NULL DEFAULT 0,
    "atc" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "WidgetSuggestionPairStat_shop_anchorHandle_idx" ON "WidgetSuggestionPairStat"("shop", "anchorHandle");

-- CreateIndex
CREATE UNIQUE INDEX "WidgetSuggestionPairStat_shop_anchorHandle_suggestedHandle_key" ON "WidgetSuggestionPairStat"("shop", "anchorHandle", "suggestedHandle");
