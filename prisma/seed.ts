import { closeSeedClient, seedAdminUser, seedDemoQuestions } from "@/prisma/seed-lib";

async function main() {
  await seedAdminUser();
  await seedDemoQuestions();
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
