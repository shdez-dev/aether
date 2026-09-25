import { readFile, writeFile } from "node:fs/promises";

const [composeEnvPath, outputPath] = process.argv.slice(2);
if (!composeEnvPath || !outputPath)
  throw new Error("Usage: render-garage-config.mjs compose-env output");

const composeEnv = await readFile(composeEnvPath, "utf8");
const secrets = Object.fromEntries(
  composeEnv
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      if (index < 1) throw new Error("Invalid line in Compose env file");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

if (!secrets.GARAGE_RPC_SECRET || !/^[a-f\d]{64}$/iu.test(secrets.GARAGE_RPC_SECRET))
  throw new Error("GARAGE_RPC_SECRET must be a 32-byte hex string in compose.env");

const config = `metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "0.0.0.0:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "${secrets.GARAGE_RPC_SECRET}"

[s3_api]
s3_region = "garage"
api_bind_addr = "0.0.0.0:3900"
root_domain = ".s3.aether.internal"
`;

await writeFile(outputPath, config, { mode: 0o600 });
