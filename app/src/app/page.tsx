"use client";

import { useState } from "react";
import { WalletConnect } from "@/components/WalletConnect";
import { AliasSearch } from "@/components/AliasSearch";
import { AliasRegister } from "@/components/AliasRegister";

export default function Home() {
  const [tab, setTab] = useState<"search" | "register">("search");

  return (
    <WalletConnect>
      <div className="space-y-6">
        {/* Hero */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-3">
            Aliases para Transacciones Privadas
          </h1>
          <p className="text-gray-400 max-w-xl mx-auto">
            Registra un alias legible (@bob) y recibe tokens de forma privada.
            Cada pago genera una dirección única que solo vos podés detectar.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 p-1 bg-gray-900 rounded-lg w-fit mx-auto">
          <button
            onClick={() => setTab("search")}
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              tab === "search"
                ? "bg-purple-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Buscar Alias
          </button>
          <button
            onClick={() => setTab("register")}
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              tab === "register"
                ? "bg-purple-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Registrar
          </button>
        </div>

        {/* Content */}
        {tab === "search" ? <AliasSearch /> : <AliasRegister />}

        {/* Info */}
        <div className="grid md:grid-cols-3 gap-4 mt-8">
          <InfoCard
            icon="🔒"
            title="Privacidad Total"
            description="Nadie puede vincular tus pagos. Cada transacción usa una dirección única."
          />
          <InfoCard
            icon="@"
            title="Alias Legibles"
            description="Olvídate de direcciones largas. Usa nombres simples como @bob."
          />
          <InfoCard
            icon="⚡"
            title="Sin Intermediarios"
            description="Todo en cadena, sin servidores centralizados que puedan rastrearte."
          />
        </div>

        {/* Technical Info */}
        <div className="mt-8 p-6 bg-gray-900/50 rounded-xl border border-gray-800">
          <h3 className="font-semibold mb-3 text-gray-300">¿Cómo funciona?</h3>
          <ol className="space-y-2 text-gray-500 text-sm">
            <li className="flex gap-3">
              <span className="text-purple-500 font-mono">1.</span>
              <span>Bob registra @bob con su stealth meta-address (claves públicas)</span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-500 font-mono">2.</span>
              <span>Alice busca @bob y obtiene su meta-address del contrato</span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-500 font-mono">3.</span>
              <span>Alice genera una stealth address única para este pago</span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-500 font-mono">4.</span>
              <span>Alice envía tokens a esa dirección (vía Railgun para ocultar monto)</span>
            </li>
            <li className="flex gap-3">
              <span className="text-purple-500 font-mono">5.</span>
              <span>Bob escanea con su viewing key y detecta el pago</span>
            </li>
          </ol>
        </div>
      </div>
    </WalletConnect>
  );
}

function InfoCard({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="p-4 bg-gray-900/50 rounded-xl border border-gray-800">
      <div className="text-2xl mb-2">{icon}</div>
      <h3 className="font-semibold mb-1">{title}</h3>
      <p className="text-gray-500 text-sm">{description}</p>
    </div>
  );
}
