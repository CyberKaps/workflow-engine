import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

const DEAD_AFTER_MS = 15_000;

async function checkWorkers() {
  const cutoff = new Date(Date.now() - DEAD_AFTER_MS);

  const deadWorkers = await prisma.worker.findMany({
    where: {
      lastHeartbeat: {
        lt: cutoff,
      },
    },
  });

  for (const worker of deadWorkers) {
    console.log(`Worker ${worker.id} appears to be dead`);

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