-- CreateEnum
CREATE TYPE "WorkerStatus" AS ENUM ('ACTIVE', 'DEAD');

-- AlterTable
ALTER TABLE "Worker" ADD COLUMN     "status" "WorkerStatus" NOT NULL DEFAULT 'ACTIVE';
