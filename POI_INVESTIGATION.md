# Problema: POI (Proof of Innocence) bloquea transfers privados en Railgun

## Contexto

Estamos usando `@railgun-community/wallet` v10.4.0 y `@railgun-community/engine` v9.4.0 en Node.js para hacer transferencias privadas de USDC en Polygon mainnet.

El flujo es: shield USDC al pool de Railgun → transferencia privada dentro del pool → receptor recibe.

## Problema

Después de hacer un shield exitoso (confirmado on-chain), los fondos aparecen en la wallet con `balanceForERC20Token(... false)` (total) pero NO con `balanceForERC20Token(... true)` (spendable). El UTXO queda permanentemente en estado `ShieldPending`.

Incluso después de 10+ horas, el balance spendable sigue en 0. El timer `POI_SHIELD_PENDING_SEC = 3600` (1 hora) NO es un timer real — el UTXO necesita un POI proof registrado en el POI node para pasar a `Spendable`.

Si patcheamos `getSpendableBalanceBuckets()` en el cliente para retornar todos los buckets, la proof ZK se genera y la TX se envía, pero **el contrato on-chain también valida POI y revierte la transacción** (status: 0).

## Lo que ya intentamos

1. Esperar 10+ horas → sigue ShieldPending
2. Llamar `refreshBalances()` múltiples veces → no cambia
3. Llamar `wallet.refreshPOIsForAllTXIDVersions(chain)` → error de DB "cannot call iterator() before open()"
4. Llamar `wallet.refreshReceivePOIsAllTXOs()` → no exportado
5. Usar `poiNodeURLs: []` (sin POI) → el sync tarda mucho más y el contrato on-chain sigue validando POI
6. Patchear `getSpendableBalanceBuckets` → TX se envía pero el contrato la revierte

## Configuración actual

```typescript
await startRailgunEngine(
  "stealthaliases",
  db,
  false,           // shouldDebug
  artifactStore,
  false,           // useNativeArtifacts
  false,           // skipMerkletreeScans
  ["https://poi-node.railgun.org"]  // poiNodeURLs
);
```

El shield se hace con:
```typescript
const shieldPrivateKey = ethers.keccak256(
  await fromWallet.signMessage(getShieldPrivateKeySignatureMessage())
).slice(2);

await populateShield(txidVersion, networkName, shieldPrivateKey, erc20AmountRecipients, [], gasDetails);
```

## Pregunta

**¿Cómo se registra correctamente un shield con el POI node para que el UTXO pase de `ShieldPending` a `Spendable`?**

Específicamente:
1. ¿Hay algún paso adicional después del shield que hay que hacer para registrar el POI?
2. ¿Railway Wallet (la app oficial) hace algo especial después del shield que nosotros no estamos haciendo?
3. ¿El `shieldPrivateKey` derivado de la firma tiene que ver con el POI registration?
4. ¿Hay que llamar alguna función del SDK que registre el shield con el POI node explícitamente?
5. ¿Puede ser un problema de versión del SDK (wallet 10.4.0 / engine 9.4.0)?

## Datos relevantes

- Red: Polygon mainnet (chainId 137)
- Contrato Railgun proxy: `0x19B620929f97b7b990801496c3b361CA5dEf8C71`
- POI node: `https://poi-node.railgun.org`
- Shield TX ejemplo: `0xee921944b0b7f2d3f7ff3c85aa1bf6bf90807d66f49b9fd27c7f92fa24484682` (bloque 86701372)
- Transfer TX revertida: `0xbb840044e079309a1366a58cf26d90a4e34a5722e37f37c365ed6a6a8678fec8` (bloque 86722050, status: 0)
- La wallet detecta el UTXO correctamente (total balance > 0)
- La ZK proof se genera correctamente con snarkjs groth16
- El contrato on-chain revierte la TX (probablemente validación POI on-chain)

## Actualización: POI resuelto, pero contrato revierte

### POI arreglado
- URL correcta: `https://ppoi-agg.horsewithsixlegs.xyz` (la anterior `poi-node.railgun.org` no existe)
- Con la URL correcta, `refreshBalances` tarda ~139s y los fondos pasan a **Spendable: 0.1995 USDC**
- Parámetros correctos de `startRailgunEngine`: 9 argumentos, incluyendo `customPOILists: []` y `verboseScanLogging: true`

### Nuevo problema: contrato revierte la TX
- La proof ZK se genera (1.5s con snarkjs groth16)
- La TX se envía correctamente
- El contrato la revierte (status: 0, reason: null, data: null)
- Gas usado: 331,601 (siempre el mismo)
- TX: `0x25c0b2d276051d6c0add6c622d077497586acbe176002997c9351872224c5742`

### Posibles causas del revert
1. Artefactos ZK descargados manualmente de IPFS pueden no ser los correctos para la versión del contrato
2. El circuito (1x1, 1x2, etc.) puede no coincidir con lo que el contrato espera
3. El SDK puede estar armando inputs inconsistentes
4. El `sendWithPublicWallet: true` puede requerir configuración adicional

---

## Demostración de extremo a extremo (confirmada)

Ejecución completa del flujo `@alice` → `@bob` sobre Polygon (red principal), con los
identificadores en cadena para su verificación independiente:

| Operación | Hash | Bloque | Gas |
|-----------|------|--------|-----|
| Registro `@alice` | `0xc864fc5f1f6c…` | 86.593.146 | 236.567 |
| Registro `@bob` | `0xe61d9f81d874…` | 86.593.150 | 235.775 |
| Transferencia privada (0,01 USDC) | `0x3cc8c3ebe675e47724d1d6de27f42ee9a061d862fcd3f035ceac3fea7f19db59` | 86.744.133 | 1.001.580 |

Contrato: `AliasRegistry` en `0x690BEA9b3420C961A2f490197fd92CeCA586F36d`.
La transferencia se dirige al proxy de Railgun `0x19b620929f97b7b990801496c3b361ca5def8c71`.

**Nota sobre la privacidad de esta demostración:** las tres transacciones se emiten desde la
misma dirección (`0xe7f9cc4f…a315`), que además figura como `registrant` en ambos eventos
`AliasRegistered`. Es un artefacto del script, que usa una única billetera por simplicidad:
un observador puede por lo tanto vincular la transferencia con ambos aliases. Un uso real
requiere billeteras separadas por participante.

---

## Actualización (12 de septiembre de 2026): el agregador POI desapareció

El agregador al que apunta este documento como solución, `ppoi-agg.horsewithsixlegs.xyz`,
**dejó de existir**: ni el subdominio ni el dominio base resuelven en DNS. Con el nodo
inalcanzable, las notas blindadas quedan en `ShieldPending` de forma indefinida y sin
error visible, que es el mismo síntoma descrito más arriba.

O sea que el diagnóstico original ---"la URL no resolvía"--- era correcto en su forma pero
la solución no era estable: el reemplazo también murió. La conclusión útil es otra, y es
la que conviene recordar: **los fondos blindados dependen de un servicio comunitario
externo que puede desaparecer, y cuando desaparece quedan inmovilizados en silencio.**

Nodo operativo verificado al día de hoy: `https://ppoi.fdi.network` (cubre Polygon,
sincronizado). La lista se configura ahora por `POI_NODE_URLS` en el `.env`, sin URLs
escritas en el código.

Ver `DEMO_ENLAZABILIDAD.md`, sección 6, para el diagnóstico completo.
