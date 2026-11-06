import type { PrismaClient } from "@prisma/client";

export async function withTestDatabaseLock<T>(
  prisma: PrismaClient,
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${name}, 0)) IS NULL
    `;
    return operation();
  });
}
