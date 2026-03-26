"use client";

import { useState } from "react";
import { registerAlias, isAliasRegistered } from "@/lib/wallet";
import { generateStealthKeys, shortenAddress } from "@/lib/stealth";

interface GeneratedKeys {
  viewingPrivateKey: string;
  spendingPrivateKey: string;
  metaAddress: string;
}

export function AliasRegister({ onRegistered }: { onRegistered?: () => void }) {
  const [alias, setAlias] = useState("");
  const [step, setStep] = useState<"input" | "keys" | "confirm" | "success">("input");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keys, setKeys] = useState<GeneratedKeys | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [keysSaved, setKeysSaved] = useState(false);

  const handleCheckAlias = async () => {
    if (!alias.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const cleanAlias = alias.replace("@", "").toLowerCase().trim();

      // Validar formato
      if (cleanAlias.length < 3 || cleanAlias.length > 32) {
        setError("El alias debe tener entre 3 y 32 caracteres");
        return;
      }

      if (!/^[a-z0-9_]+$/.test(cleanAlias)) {
        setError("Solo se permiten letras minúsculas, números y guión bajo");
        return;
      }

      if (cleanAlias.startsWith("_") || cleanAlias.endsWith("_")) {
        setError("El alias no puede empezar ni terminar con guión bajo");
        return;
      }

      // Verificar disponibilidad
      const registered = await isAliasRegistered(cleanAlias);
      if (registered) {
        setError(`@${cleanAlias} ya está registrado`);
        return;
      }

      // Generar claves
      const newKeys = generateStealthKeys();
      setKeys({
        viewingPrivateKey: newKeys.viewingPrivateKey,
        spendingPrivateKey: newKeys.spendingPrivateKey,
        metaAddress: newKeys.metaAddress,
      });

      setStep("keys");
    } catch (err: any) {
      setError(err.message || "Error al verificar alias");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!keys || !keysSaved) return;

    setLoading(true);
    setError(null);

    try {
      const cleanAlias = alias.replace("@", "").toLowerCase().trim();
      const hash = await registerAlias(cleanAlias, keys.metaAddress);
      setTxHash(hash);
      setStep("success");
      onRegistered?.();
    } catch (err: any) {
      setError(err.message || "Error al registrar alias");
    } finally {
      setLoading(false);
    }
  };

  const downloadKeys = () => {
    if (!keys) return;

    const cleanAlias = alias.replace("@", "").toLowerCase().trim();
    const data = {
      alias: cleanAlias,
      viewingPrivateKey: keys.viewingPrivateKey,
      spendingPrivateKey: keys.spendingPrivateKey,
      metaAddress: keys.metaAddress,
      createdAt: new Date().toISOString(),
      warning: "NUNCA compartas estas claves. Son necesarias para recibir y gastar fondos.",
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stealth-keys-${cleanAlias}.json`;
    a.click();
    URL.revokeObjectURL(url);

    setKeysSaved(true);
  };

  const reset = () => {
    setAlias("");
    setStep("input");
    setKeys(null);
    setTxHash(null);
    setError(null);
    setKeysSaved(false);
  };

  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <h2 className="text-xl font-semibold mb-4 text-white">Registrar Alias</h2>

      {step === "input" && (
        <>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">@</span>
              <input
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCheckAlias()}
                placeholder="mi_alias"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
              />
            </div>
            <button
              onClick={handleCheckAlias}
              disabled={loading || !alias.trim()}
              className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed px-6 py-3 rounded-lg font-medium transition-colors"
            >
              {loading ? "..." : "Continuar"}
            </button>
          </div>
          <p className="mt-3 text-gray-500 text-sm">
            3-32 caracteres, solo letras minúsculas, números y guión bajo
          </p>
        </>
      )}

      {step === "keys" && keys && (
        <div className="space-y-4">
          <div className="p-4 bg-yellow-900/30 border border-yellow-700 rounded-lg">
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-yellow-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="text-yellow-500 font-medium">Guarda tus claves privadas</p>
                <p className="text-yellow-600 text-sm mt-1">
                  Estas claves son ÚNICAS y necesarias para recibir pagos. Si las pierdes,
                  no podrás acceder a los fondos enviados a @{alias.replace("@", "")}.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3 p-4 bg-gray-800 rounded-lg">
            <div>
              <label className="text-gray-500 text-xs">Viewing Private Key</label>
              <p className="font-mono text-xs text-gray-300 break-all">{keys.viewingPrivateKey}</p>
            </div>
            <div>
              <label className="text-gray-500 text-xs">Spending Private Key</label>
              <p className="font-mono text-xs text-gray-300 break-all">{keys.spendingPrivateKey}</p>
            </div>
            <div>
              <label className="text-gray-500 text-xs">Meta-address (pública)</label>
              <p className="font-mono text-xs text-gray-300 break-all">{keys.metaAddress}</p>
            </div>
          </div>

          <button
            onClick={downloadKeys}
            className="w-full bg-yellow-600 hover:bg-yellow-700 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Descargar Claves
          </button>

          {keysSaved && (
            <button
              onClick={() => setStep("confirm")}
              className="w-full bg-purple-600 hover:bg-purple-700 py-3 rounded-lg font-medium transition-colors"
            >
              Continuar con el registro
            </button>
          )}
        </div>
      )}

      {step === "confirm" && (
        <div className="space-y-4">
          <div className="p-4 bg-gray-800 rounded-lg">
            <p className="text-gray-400 text-sm mb-2">Vas a registrar:</p>
            <p className="text-2xl font-bold text-purple-400">@{alias.replace("@", "").toLowerCase()}</p>
          </div>

          <p className="text-gray-500 text-sm">
            Esta acción requiere una transacción en Polygon. El alias será permanente
            y no podrá modificarse.
          </p>

          <div className="flex gap-3">
            <button
              onClick={() => setStep("keys")}
              className="flex-1 bg-gray-700 hover:bg-gray-600 py-3 rounded-lg font-medium transition-colors"
            >
              Volver
            </button>
            <button
              onClick={handleRegister}
              disabled={loading}
              className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 py-3 rounded-lg font-medium transition-colors"
            >
              {loading ? "Registrando..." : "Registrar"}
            </button>
          </div>
        </div>
      )}

      {step === "success" && (
        <div className="space-y-4">
          <div className="p-4 bg-green-900/30 border border-green-800 rounded-lg text-center">
            <svg className="w-12 h-12 text-green-500 mx-auto mb-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <p className="text-green-400 font-medium text-lg">
              @{alias.replace("@", "").toLowerCase()} registrado!
            </p>
          </div>

          {txHash && (
            <a
              href={`https://polygonscan.com/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-purple-400 hover:text-purple-300 text-sm"
            >
              Ver transacción →
            </a>
          )}

          <button
            onClick={reset}
            className="w-full bg-gray-700 hover:bg-gray-600 py-3 rounded-lg font-medium transition-colors"
          >
            Registrar otro
          </button>
        </div>
      )}

      {error && (
        <div className="mt-4 p-4 bg-red-900/30 border border-red-800 rounded-lg text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
