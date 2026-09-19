export interface RegionOverlap {
  /** Id of a mask layer that existed before the bake. */
  id: string;
  /** Pixels the new region shares with it. */
  pixels: number;
}

export interface ProducedRegion {
  area: number;
  overlaps: RegionOverlap[];
}

/** For each produced region, the old mask id it continues, or null for a
 * new one. Larger regions choose first; each old id continues at most once,
 * into the region sharing the most pixels with it. */
export function assignIdentities(regions: ProducedRegion[]): (string | null)[] {
  const order = regions.map((_, i) => i).sort((a, b) => regions[b].area - regions[a].area);
  const claimed = new Set<string>();
  const out: (string | null)[] = regions.map(() => null);
  for (const i of order) {
    let best: RegionOverlap | null = null;
    for (const o of regions[i].overlaps) {
      if (o.pixels <= 0 || claimed.has(o.id)) continue;
      if (!best || o.pixels > best.pixels) best = o;
    }
    if (best) {
      claimed.add(best.id);
      out[i] = best.id;
    }
  }
  return out;
}
