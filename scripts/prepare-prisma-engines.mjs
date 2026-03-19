import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import zlib from "node:zlib";

import prismaGetPlatform from "@prisma/get-platform";

const { getPlatformInfo } = prismaGetPlatform;

const enginesVersionPkg = JSON.parse(
  fs.readFileSync(new URL("../node_modules/@prisma/engines-version/package.json", import.meta.url), "utf8"),
);

const enginesVersion = enginesVersionPkg.prisma.enginesVersion;

const { binaryTarget } = await getPlatformInfo();
const isWindows = binaryTarget === "windows";
const targetDir = path.resolve("node_modules/@prisma/engines");
const targetFile = path.join(targetDir, `schema-engine-${binaryTarget}${isWindows ? ".exe" : ""}`);
const gzFile = `${targetFile}.gz`;

if (fs.existsSync(targetFile)) {
  process.stdout.write(`Prisma schema-engine already present: ${targetFile}\n`);
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });

const env = { ...process.env };
if (!env.http_proxy && env.HTTP_PROXY) env.http_proxy = env.HTTP_PROXY;
if (!env.https_proxy && env.HTTPS_PROXY) env.https_proxy = env.HTTPS_PROXY;
if (!env.HTTP_PROXY && env.http_proxy) env.HTTP_PROXY = env.http_proxy;
if (!env.HTTPS_PROXY && env.https_proxy) env.HTTPS_PROXY = env.https_proxy;

const remoteFile = `schema-engine${isWindows ? ".exe" : ""}.gz`;
const url = `https://binaries.prisma.sh/all_commits/${enginesVersion}/${binaryTarget}/${remoteFile}`;

const curl = spawnSync(
  "curl",
  ["-L", "--fail", "--retry", "5", "--retry-all-errors", "-C", "-", "--max-time", "180", url, "-o", gzFile],
  {
    stdio: "inherit",
    env,
  },
);

if (curl.status !== 0) {
  process.stderr.write(`Prisma schema-engine download failed from ${url}\n`);
  process.exit(curl.status ?? 1);
}

const compressed = fs.readFileSync(gzFile);
const uncompressed = zlib.gunzipSync(compressed);
fs.writeFileSync(targetFile, uncompressed);
fs.unlinkSync(gzFile);

fs.chmodSync(targetFile, 0o755);
process.stdout.write(`Prepared Prisma schema-engine: ${targetFile}\n`);
