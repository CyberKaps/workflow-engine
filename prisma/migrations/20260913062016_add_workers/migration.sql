-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "workerId" TEXT;

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "lastHeartbeat" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
