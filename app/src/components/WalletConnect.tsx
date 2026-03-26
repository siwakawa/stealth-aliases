"use client";

import { useState, useEffect } from "react";
import { initProvider, connectWallet, getBeexoClient } from "@/lib/wallet";
import { shortenAddress } from "@/lib/stealth";

interface WalletState {
  address: string | null;
  alias: string | null;
  connected: boolean;
}

export function WalletConnect({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<WalletState>({
    address: null,
    alias: null,
    connected: false,
  });
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Inicializar provider al montar
    try {
      initProvider(false);
    } catch (err) {
      console.log("Provider initialization (may be outside Beexo):", err);
    }
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);

    try {
      const address = await connectWallet();

      // Intentar obtener info de Beexo
      let alias = null;
      try {
        const client = await getBeexoClient();
        alias = client?.alias || null;
      } catch {
        // No estamos en Beexo
      }

      setWallet({
        address,
        alias,
        connected: true,
      });
    } catch (err: any) {
      setError(err.message || "Error al conectar");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    setWallet({
      address: null,
      alias: null,
      connected: false,
    });
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-gray-800">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-lg">@</span>
            </div>
            <span className="font-semibold text-lg">Stealth Aliases</span>
          </div>

          {wallet.connected ? (
            <div className="flex items-center gap-3">
              <div className="text-right">
                {wallet.alias && (
                  <p className="text-purple-400 text-sm font-medium">@{wallet.alias}</p>
                )}
                <p className="text-gray-400 text-xs font-mono">
                  {shortenAddress(wallet.address!, 4)}
                </p>
              </div>
              <button
                onClick={handleDisconnect}
                className="bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg text-sm transition-colors"
              >
                Desconectar
              </button>
            </div>
          ) : (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 px-4 py-2 rounded-lg font-medium transition-colors"
            >
              {connecting ? "Conectando..." : "Conectar Wallet"}
            </button>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-800 rounded-lg text-red-400">
            {error}
            <button
              onClick={() => setError(null)}
              className="float-right text-red-600 hover:text-red-400"
            >
              ✕
            </button>
          </div>
        )}

        {wallet.connected ? (
          children
        ) : (
          <div className="text-center py-20">
            <div className="w-20 h-20 bg-gray-900 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold mb-2">Conecta tu wallet</h2>
            <p className="text-gray-500 mb-6">
              Necesitas conectar tu wallet para usar Stealth Aliases
            </p>
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 px-6 py-3 rounded-lg font-medium transition-colors"
            >
              {connecting ? "Conectando..." : "Conectar Wallet"}
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-auto">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between text-gray-500 text-sm">
          <span>Polygon Mainnet</span>
          <a
            href="https://github.com/beexo-si/stealth-aliases"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-300 transition-colors"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
