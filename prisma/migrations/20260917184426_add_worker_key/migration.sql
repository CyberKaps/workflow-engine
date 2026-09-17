/*
  Warnings:

  - A unique constraint covering the columns `[workerKey]` on the table `Worker` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `workerKey` to the `Worker` table without a default value. This is not possible if the table is not empty.

*/
ALTER TABLE "Worker" ADD COLUMN "workerKey" TEXT;

UPDATE "Worker"
SET "workerKey" = 'legacy-' || "id"::text;

ALTER TABLE "Worker"
ALTER COLUMN "workerKey" SET NOT NULL;

CREATE UNIQUE INDEX "Worker_workerKey_key"
ON "Worker"("workerKey");