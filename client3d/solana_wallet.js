// Solana Universal Multi-Wallet Connector for Swarajya 3D
// Supports Phantom, Solflare, Backpack, Coinbase Solana, and Direct Base58 Address fallback.
// RPC fallback pipeline + real-time on-chain balance fetching.

export const SWARAJYA_SOLANA_TREASURY = "4U1j9CsfSLRKCgM2jt4Fksxo1hX2UQ1gtpNF5UnSwXYv";

const RPC_ENDPOINTS = [
  "https://api.mainnet-beta.solana.com",
  "https://rpc.ankr.com/solana",
  "https://solana-mainnet.rpc.extrnode.com",
];

export class SolanaWalletManager {
  constructor() {
    this.provider = null;
    this.publicKey = localStorage.getItem("swarajya_sol_wallet") || null;
    this.connected = Boolean(this.publicKey);
    this.balance = 0;
    this.network = "mainnet-beta";
    this.treasury = SWARAJYA_SOLANA_TREASURY;
    this.creatorFee = 0.04; // 4% Creator Protocol Rake

    if (this.publicKey) {
      this.fetchBalance();
    }
  }

  /** Detect all installed Solana browser extension wallet providers */
  detectProvider() {
    if (typeof window === "undefined") return null;

    // 1. Phantom Official
    if (window.phantom && window.phantom.solana && window.phantom.solana.isPhantom) {
      return { name: "Phantom", provider: window.phantom.solana };
    }
    if (window.solana && window.solana.isPhantom) {
      return { name: "Phantom", provider: window.solana };
    }

    // 2. Solflare Official
    if (window.solflare && (window.solflare.isSolflare || window.solflare.isConnected !== undefined)) {
      return { name: "Solflare", provider: window.solflare };
    }

    // 3. Backpack
    if (window.backpack) {
      return { name: "Backpack", provider: window.backpack };
    }

    // 4. Coinbase Solana
    if (window.coinbaseSolana) {
      return { name: "Coinbase Wallet", provider: window.coinbaseSolana };
    }

    // 5. Generic window.solana injected provider
    if (window.solana) {
      return { name: "Solana Wallet", provider: window.solana };
    }

    return null;
  }

  /** Connect via detected browser extension or prompt for manual address */
  async connect() {
    const detected = this.detectProvider();

    if (detected && detected.provider) {
      try {
        this.provider = detected.provider;
        const resp = await this.provider.connect({ onlyIfTrusted: false }).catch(() => this.provider.connect());
        const rawKey = resp?.publicKey || this.provider.publicKey;
        if (!rawKey) throw new Error("No public key returned by wallet.");

        this.publicKey = rawKey.toString();
        this.connected = true;
        localStorage.setItem("swarajya_sol_wallet", this.publicKey);

        await this.fetchBalance();
        return {
          name: detected.name,
          address: this.publicKey,
          balance: this.balance,
        };
      } catch (err) {
        console.warn("[Solana Wallet Extension Error]", err);
        // If extension connection was cancelled or blocked, allow manual fallback
      }
    }

    // Fallback: Manual Address Prompt for Desktop / Mobile / Non-extension users
    const manualPrompt = prompt(
      "No active Solana wallet extension detected (or permission denied).\n\nPlease enter your Solana Public Address (e.g. 4U1j9CsfSLRKCgM2jt4Fksxo1hX2UQ1gtpNF5UnSwXYv):",
      this.publicKey || SWARAJYA_SOLANA_TREASURY
    );

    if (manualPrompt && manualPrompt.trim().length >= 32) {
      const cleanAddr = manualPrompt.trim();
      this.publicKey = cleanAddr;
      this.connected = true;
      localStorage.setItem("swarajya_sol_wallet", cleanAddr);
      await this.fetchBalance();
      return {
        name: "Solana Address",
        address: this.publicKey,
        balance: this.balance,
      };
    }

    throw new Error("Solana connection cancelled. Install Phantom (phantom.app) or Solflare (solflare.com) to connect automatically.");
  }

  /** Set manual address directly */
  setAddress(address) {
    if (!address || address.trim().length < 32) return false;
    this.publicKey = address.trim();
    this.connected = true;
    localStorage.setItem("swarajya_sol_wallet", this.publicKey);
    this.fetchBalance();
    return true;
  }

  /** Disconnect current wallet */
  async disconnect() {
    if (this.provider && this.provider.disconnect) {
      try { await this.provider.disconnect(); } catch (_) {}
    }
    this.connected = false;
    this.publicKey = null;
    this.balance = 0;
    localStorage.removeItem("swarajya_sol_wallet");
  }

  /** Fetch current SOL balance with multi-RPC fallback */
  async fetchBalance() {
    if (!this.publicKey) return 0;

    for (const rpc of RPC_ENDPOINTS) {
      try {
        const res = await fetch(rpc, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getBalance",
            params: [this.publicKey],
          }),
        });
        const data = await res.json();
        if (data.result && typeof data.result.value === "number") {
          this.balance = data.result.value / 1e9; // Lamports to SOL
          return this.balance;
        }
      } catch (err) {
        // Try next fallback endpoint
      }
    }
    return this.balance;
  }

  /** Format address with truncation (e.g. 4U1j...wXYv) */
  getShortAddress() {
    if (!this.publicKey) return "";
    return `${this.publicKey.slice(0, 4)}...${this.publicKey.slice(-4)}`;
  }
}
