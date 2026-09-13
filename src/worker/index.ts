import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function processJob() {
  const job = await prisma.$transaction(async (tx) => {
    const jobs = await tx.$queryRaw<
      { id: string; 
        type: string; 
        attempts: number;
        payload: unknown 
      }[]
    >`
      SELECT id, type, payload, attempts
      FROM "Job"
      WHERE status = 'PENDING'
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    const job = jobs[0];

    if (!job) {
      return null;
    }

    await tx.job.update({
      where: {
        id: job.id,
      },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        attempts: {
          increment: 1,
        },
      },
    });

    return job;
  });

  if (!job) {
    return;
  }

  console.log(`Processing job ${job.id}`);

  try {

  // throw new Error("Testing retry");

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
  } catch (error) {
    console.error(`Job ${job.id} failed`, error);

    const MAX_ATTEMPTS = 3;

    if (job.attempts < MAX_ATTEMPTS) {
      await prisma.job.update({
        where: {
          id: job.id,
        },
        data: {
          status: "PENDING",
        },
      });

      console.log(
        `Retrying job ${job.id} (${job.attempts}/${MAX_ATTEMPTS})`
      );
    } else {
      await prisma.job.update({
        where: {
          id: job.id,
        },
        data: {
          status: "FAILED",
        },
      });

      console.log(`Job ${job.id} permanently failed`);
    }
  }
} 

async function startWorker() {
  console.log("Worker started");

  while (true) {
    await processJob();

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

startWorker();