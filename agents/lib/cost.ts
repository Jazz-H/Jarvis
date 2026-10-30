// Per-run token and cost ledger. MAX_RUN_COST_USD caps the run: Jarvis reserves its own
// estimate first, then starts only the sub-agents whose estimates still fit.

export interface UsageEntry {
  agent: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export class CostLedger {
  readonly entries: UsageEntry[] = [];
  private reserved = new Map<string, number>();

  constructor(readonly maxUsd: number) {
    if (!(maxUsd > 0)) throw new Error("MAX_RUN_COST_USD must be a positive number");
  }

  get spentUsd() {
    return this.entries.reduce((s, e) => s + e.costUsd, 0);
  }
  get reservedUsd() {
    return [...this.reserved.values()].reduce((s, v) => s + v, 0);
  }

  // Holds an estimate for an agent that hasn't run yet. False if it would break the cap.
  reserve(agent: string, estimateUsd: number): boolean {
    if (this.spentUsd + this.reservedUsd + estimateUsd > this.maxUsd) return false;
    this.reserved.set(agent, estimateUsd);
    return true;
  }

  // What an agent may still spend: the cap minus what's spent and what others have reserved.
  budgetFor(agent: string): number {
    const othersReserved = this.reservedUsd - (this.reserved.get(agent) ?? 0);
    return Math.max(0, this.maxUsd - this.spentUsd - othersReserved);
  }

  record(entry: UsageEntry) {
    this.entries.push(entry);
  }

  release(agent: string) {
    this.reserved.delete(agent);
  }

  summary() {
    const byAgent: Record<string, { tokens: number; costUsd: number }> = {};
    for (const e of this.entries) {
      const a = (byAgent[e.agent] ??= { tokens: 0, costUsd: 0 });
      a.tokens += e.inputTokens + e.outputTokens + e.cacheReadTokens + e.cacheWriteTokens;
      a.costUsd += e.costUsd;
    }
    return { maxUsd: this.maxUsd, spentUsd: Number(this.spentUsd.toFixed(4)), byAgent };
  }
}
