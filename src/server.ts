import "dotenv/config";

import express from "express";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

const app = express();


app.use(express.json());

app.post("/jobs", async (req, res) => {
  const { type, payload } = req.body;

  const job = await prisma.job.create({
    data: {
      type,
      payload,
    },
  });

  res.status(201).json({
    id: job.id,
    status: job.status,
  });
});

app.listen(3000, () => {
  console.log("API running on http://localhost:3000");
});