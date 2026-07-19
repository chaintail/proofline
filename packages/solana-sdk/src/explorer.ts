export function solanaExplorerTx(signature: string, cluster: "mainnet-beta" | "devnet" = "mainnet-beta"): string {
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

export function solanaExplorerAccount(address: string, cluster: "mainnet-beta" | "devnet" = "mainnet-beta"): string {
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/address/${address}${suffix}`;
}
