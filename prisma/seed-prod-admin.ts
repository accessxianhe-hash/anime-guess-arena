import { closeSeedClient, seedAdminUser } from "@/prisma/seed-lib";

async function main() {
  await seedAdminUser();
}

main()
  .then(async () => {
    await closeSeedClient();
  })
  .catch(async (error) => {
    console.error(error);
    await closeSeedClient();
    process.exit(1);
  });

