"use client";

import { useState } from "react";
import { resolveAlias } from "@/lib/wallet";
import { parseMetaAddress, generateStealthAddress, shortenAddress } from "@/lib/stealth";

interface ResolvedAlias {
  alias: string;
  metaAddress: string;
  viewingKey: string;
  spendingKey: string;
  stealthAddress: string;
  ephemeralKey: string;
  viewTag: string;
}

export function AliasSearch() {
  const [alias, setAlias] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedAlias | null>(null);

  const handleSearch = async () => {
    if (!alias.trim()) return;

    setLoading(true);
    setError(null);
    setResolved(null);

    try {
      const cleanAlias = alias.replace("@", "").toLowerCase().trim();
      const metaAddress = await resolveAlias(cleanAlias);

      if (!metaAddress) {
        setError(`@${cleanAlias} no está registrado`);
        return;
      }

      // Parsear la meta-address
      const { viewingPublicKey, spendingPublicKey } = parseMetaAddress(metaAddress);

      // Generar stealth address para este pago
      const stealth = generateStealthAddress(metaAddress);

      setResolved({
        alias: cleanAlias,
        metaAddress,
        viewingKey: viewingPublicKey,
        spendingKey: spendingPublicKey,
        stealthAddress: stealth.stealthAddress,
        ephemeralKey: stealth.ephemeralPublicKey,
        viewTag: stealth.viewTag,
      });
    } catch (err: any) {
      setError(err.message || "Error al resolver alias");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <h2 className="text-xl font-semibold mb-4 text-white">Buscar Alias</h2>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">@</span>
          <input
            type="text"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="satoshi_test"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={loading || !alias.trim()}
          className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed px-6 py-3 rounded-lg font-medium transition-colors"
        >
          {loading ? "..." : "Buscar"}
        </button>
      </div>

      {error && (
        <div className="mt-4 p-4 bg-red-900/30 border border-red-800 rounded-lg text-red-400">
          {error}
        </div>
      )}

      {resolved && (
        <div className="mt-6 space-y-4">
          <div className="p-4 bg-green-900/20 border border-green-800 rounded-lg">
            <div className="flex items-center gap-2 text-green-400 font-medium mb-2">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              @{resolved.alias} encontrado
            </div>
          </div>

          <div className="space-y-3">
            <DetailRow label="Meta-address" value={resolved.metaAddress} mono />
            <DetailRow label="Viewing Key" value={resolved.viewingKey} mono />
            <DetailRow label="Spending Key" value={resolved.spendingKey} mono />

            <div className="border-t border-gray-800 pt-4 mt-4">
              <p className="text-gray-400 text-sm mb-3">
                Dirección única generada para este pago:
              </p>
              <DetailRow
                label="Stealth Address"
                value={resolved.stealthAddress}
                mono
                highlight
              />
              <DetailRow label="Ephemeral Key" value={resolved.ephemeralKey} mono />
              <DetailRow label="View Tag" value={resolved.viewTag} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
  highlight = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  const shortened = value.length > 20 ? shortenAddress(value, 10) : value;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
      <span className="text-gray-500 text-sm min-w-[120px]">{label}:</span>
      <span
        className={`${mono ? "font-mono" : ""} ${highlight ? "text-purple-400" : "text-gray-300"} text-sm break-all`}
        title={value}
      >
        {shortened}
      </span>
      <button
        onClick={() => navigator.clipboard.writeText(value)}
        className="text-gray-600 hover:text-gray-400 transition-colors"
        title="Copiar"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      </button>
    </div>
  );
}
