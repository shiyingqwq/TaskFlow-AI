import { resetAndSeedDemoData } from "@/lib/server/seed";

async function main() {
  await resetAndSeedDemoData();
}

main()
  .then(() => {
    process.stdout.write("Demo 数据已写入。\n");
  })
  .catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
  });
