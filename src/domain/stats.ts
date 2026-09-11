// Statistics for experiments: two-proportion z-test.

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 approximation, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export interface ProportionTest {
  rateA: number;
  rateB: number;
  lift: number | null;
  z: number;
  pValue: number;
  significant: boolean;
}

/** Compares conversion rates of variant B against control A. */
export function compareProportions(successA: number, totalA: number, successB: number, totalB: number, alpha = 0.05): ProportionTest {
  const rateA = totalA ? successA / totalA : 0;
  const rateB = totalB ? successB / totalB : 0;
  const pooled = totalA + totalB ? (successA + successB) / (totalA + totalB) : 0;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / Math.max(totalA, 1) + 1 / Math.max(totalB, 1)));
  const z = se === 0 ? 0 : (rateB - rateA) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return { rateA, rateB, lift: rateA === 0 ? null : (rateB - rateA) / rateA, z, pValue, significant: totalA >= 30 && totalB >= 30 && pValue < alpha };
}

/** Deterministic weighted bucketing of a visitor into an experiment variant. */
export function assignVariant(hash: number, variants: Array<{ key: string; weight: number }>): string {
  const total = variants.reduce((s, v) => s + Math.max(0, v.weight), 0) || 1;
  let point = (hash % 10_000) / 10_000 * total;
  for (const v of variants) {
    point -= Math.max(0, v.weight);
    if (point < 0) return v.key;
  }
  return variants[variants.length - 1].key;
}
