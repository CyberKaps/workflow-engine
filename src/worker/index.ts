import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function processJob(workerId: string) {
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
        AND ("nextRunAt" IS NULL OR "nextRunAt" <= NOW())
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
        workerId: workerId,
      },
    });

    return job;
  });

  if (!job) {
    return;
  }

  const currentAttempt = job.attempts + 1;

  console.log(`Processing job ${job.id}`);

  try {

  // throw new Error("Testing retry");

  // Simulate actual work
  // await new Promise((resolve) => setTimeout(resolve, 30000));

  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const ownsJob = await stillOwnsJob(job.id, workerId);

    if (!ownsJob) {
      console.log(
        `🛑 Stopping stale execution for job ${job.id}`
      );
      return;
    }
  }

  const result = await prisma.job.updateMany({
    where: {
      id: job.id,
      status: "RUNNING",
      workerId: workerId,
    },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
       workerId: null,
    },
  });

  if (result.count === 0) {
    console.log(
      `⚠️ Job ${job.id} is no longer owned by worker ${workerId}`
    );
    return;
  }

    console.log(`Completed job ${job.id}`);
  } catch (error) {
    console.error(`Job ${job.id} failed`, error);

    const MAX_ATTEMPTS = 3;

    if (currentAttempt < MAX_ATTEMPTS) {

      const delaySeconds = Math.pow(2, job.attempts);
      const nextRunAt = new Date(Date.now() + delaySeconds * 1000);

      await prisma.job.update({
        where: {
          id: job.id,
        },
        data: {
          status: "PENDING",
          nextRunAt,
        },
      });

      console.log(
        `Retrying job ${job.id} (${currentAttempt}/${MAX_ATTEMPTS})`
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

  const workerKey = process.env.WORKER_ID!;

  const worker = await prisma.worker.upsert({
    where: {
      workerKey,
    },
    update: {
      status: "ACTIVE",
      lastHeartbeat: new Date(),
    },
    create: {
      workerKey,
      status: "ACTIVE",
      lastHeartbeat: new Date(),
    },
  });

  console.log(`Worker started: ${worker.id}`);

  setInterval(() => {
    sendHeartbeat(worker.id).catch((error) => {
      console.error("Heartbeat failed:", error);
    });
  }, 5000);

  while (true) {
    await processJob(worker.id);

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

startWorker();



async function sendHeartbeat(workerId: string) {
  await prisma.worker.update({
    where: {
      id: workerId,
    },
    data: {
      lastHeartbeat: new Date(),
    },
  });

  console.log(`❤️ Heartbeat: ${workerId}`);
}

async function stillOwnsJob(jobId: string, workerId: string) {
  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      status: "RUNNING",
      workerId: workerId,
    },
    select: {
      id: true,
    },
  });

  return job !== null;
}