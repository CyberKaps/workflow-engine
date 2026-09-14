import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

const DEAD_AFTER_MS = 15_000;
const JOB_TIMEOUT_MS = 10_000;

async function checkWorkers() {
  const cutoff = new Date(Date.now() - DEAD_AFTER_MS);
  const timeoutCutoff = new Date(Date.now() - JOB_TIMEOUT_MS);

  const timedOutJobs = await prisma.job.findMany({
    where: {
      status: "RUNNING",
      startedAt: {
        lt: timeoutCutoff,
      },
    },
  });

  for (const job of timedOutJobs) {
    console.log(`⏰ Job ${job.id} timed out`);

    const MAX_ATTEMPTS = 3;

    if (job.attempts < MAX_ATTEMPTS) {
      const delaySeconds = Math.pow(2, job.attempts);
      const nextRunAt = new Date(
        Date.now() + delaySeconds * 1000
      );

      await prisma.job.update({
        where: {
          id: job.id,
        },
        data: {
          status: "PENDING",
          workerId: null,
          startedAt: null,
          nextRunAt,
        },
      });

      console.log(
        `🔄 Timed-out job ${job.id} scheduled for retry (${job.attempts}/${MAX_ATTEMPTS})`
      );
    } else {
      await prisma.job.update({
        where: {
          id: job.id,
        },
        data: {
          status: "FAILED",
          workerId: null,
          startedAt: null,
        },
      });

      console.log(
        `❌ Timed-out job ${job.id} permanently failed (${job.attempts}/${MAX_ATTEMPTS})`
      );
    }
  }

  const deadWorkers = await prisma.worker.findMany({
    where: {
      status: "ACTIVE",
      lastHeartbeat: {
        lt: cutoff,
      },
    },
  });

  for (const worker of deadWorkers) {
    console.log(`Worker ${worker.id} appears to be dead`);


    await prisma.worker.update({
      where: {
        id: worker.id,
      },
      data: {
        status: "DEAD",
      },
    });

    const result = await prisma.job.updateMany({
        where: {
        workerId: worker.id,
        status: "RUNNING",
        },
        data: {
        status: "PENDING",
        workerId: null,
        startedAt: null,
        },
    });

    console.log(
        `Recovered ${result.count} jobs from worker ${worker.id}`
    );
    }
}

async function startMonitor() {
  console.log("Monitor started");

  while (true) {
    await checkWorkers();

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

startMonitor();