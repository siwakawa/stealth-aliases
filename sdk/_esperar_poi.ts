import { config } from "dotenv";
import * as path from "path";
import { ethers } from "ethers";
import { NetworkName } from "@railgun-community/shared-models";
import { RailgunService } from "./src/railgun/RailgunService";

config({ path: path.join(__dirname, "../contracts/.env") });
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const OBJETIVO = 2_000_000n; // basta con 2 USDC gastables

(async () => {
  const r = new RailgunService({
    networkName: NetworkName.Polygon, rpcUrl: process.env.POLYGON_RPC!,
    dataDir: path.join(require("os").homedir(), ".stealth-aliases"), debug: false,
  });
  await r.initialize();
  const t0 = Date.now();
  for (let i = 0; i < 24; i++) {
    await r.getOrCreateWallet(process.env.MNEMONIC_A!, "alice");
    const g = await r.getBalance(USDC, true);
    const min = ((Date.now() - t0) / 60000).toFixed(0);
    if (g >= OBJETIVO) {
      console.log(`VALIDADO tras ${min} min: ${ethers.formatUnits(g, 6)} USDC gastables`);
      await r.shutdown();
      process.exit(0);
    }
    console.log(`  [${min} min] gastable ${ethers.formatUnits(g, 6)} — sigue pendiente`);
    await new Promise((res) => setTimeout(res, 600_000));
  }
  console.log("No se validó en 4 horas.");
  await r.shutdown();
  process.exit(1);
})().catch((e) => { console.error(e.message); process.exit(1); });
