require("dotenv").config({ path: "../contracts/.env" });
const { ethers } = require("ethers");
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const ALICE = "0xE7f9CC4f55bdAbe778853882bc9C3daf2117a315";
(async () => {
  const p = new ethers.JsonRpcProvider(process.env.POLYGON_RPC);
  const erc = new ethers.Contract(USDC, ["function balanceOf(address) view returns (uint256)"], p);
  const inicial = await erc.balanceOf(ALICE);
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 20000));
    let saldo;
    try { saldo = await erc.balanceOf(ALICE); } catch { continue; }
    if (saldo > inicial) {
      console.log(`LLEGÓ: ${ethers.formatUnits(inicial,6)} -> ${ethers.formatUnits(saldo,6)} USDC`);
      process.exit(0);
    }
  }
  console.log("No llegó nada en 40 minutos.");
  process.exit(1);
})().catch((e) => { console.log("ERR", e.message); process.exit(1); });
