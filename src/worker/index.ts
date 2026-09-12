import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function processJob() {
  const job = await prisma.job.findFirst({
    where: {
      status: "PENDING",
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (!job) {
    return;
  }

  console.log(`Processing job ${job.id}`);

  await prisma.job.update({
    where: {
      id: job.id,
    },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  // Simulate actual work
  await new Promise((resolve) => setTimeout(resolve, 3000));

  await prisma.job.update({
    where: {
      id: job.id,
    },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });

  console.log(`Completed job ${job.id}`);
}

async function startWorker() {
  console.log("Worker started");

  while (true) {
    await processJob();

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

startWorker();