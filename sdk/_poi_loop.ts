import { config } from "dotenv";
import * as path from "path";
import { ethers } from "ethers";
import { NetworkName } from "@railgun-community/shared-models";
import { generatePOIsForWallet, refreshReceivePOIsForWallet } from "@railgun-community/wallet";
import { RailgunService } from "./src/railgun/RailgunService";

config({ path: path.join(__dirname, "../contracts/.env") });
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const OBJETIVO = 2_000_000n;

(async () => {
  const r = new RailgunService({ networkName: NetworkName.Polygon, rpcUrl: process.env.POLYGON_RPC!,
    dataDir: path.join(require("os").homedir(), ".stealth-aliases"), debug: false });
  await r.initialize();
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    const w = await r.getOrCreateWallet(process.env.MNEMONIC_A!, "alice");
    try {
      await refreshReceivePOIsForWallet(r.getTxidVersion(), NetworkName.Polygon, w.id);
      await generatePOIsForWallet(NetworkName.Polygon, w.id);
    } catch (e: any) {
      console.log(`  (empuje POI falló: ${e.message.slice(0, 60)})`);
    }
    await r.refreshWalletBalances();
    const g = await r.getBalance(USDC, true);
    const min = ((Date.now() - t0) / 60000).toFixed(0);
    if (g >= OBJETIVO) {
      console.log(`VALIDADO tras ${min} min: ${ethers.formatUnits(g, 6)} USDC gastables`);
      await r.shutdown();
      process.exit(0);
    }
    console.log(`  [${min} min] gastable ${ethers.formatUnits(g, 6)} — pendiente`);
    await new Promise((res) => setTimeout(res, 300_000));
  }
  await r.shutdown();
  process.exit(1);
})().catch((e) => { console.error(e.message); process.exit(1); });
