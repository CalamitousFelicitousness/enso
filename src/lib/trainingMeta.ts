// Kohya ss_* training metadata rendering helpers, shared by the civitai
// downloader detail view and the local network detail dialog.

export function topTrainingTags(meta: Record<string, string>, limit = 24): [string, number][] {
  try {
    // kohya shape: { dataset_name: { tag: count } }
    const freq = JSON.parse(meta["ss_tag_frequency"] ?? "") as Record<
      string,
      Record<string, number>
    >;
    const totals = new Map<string, number>();
    for (const dataset of Object.values(freq)) {
      for (const [tag, n] of Object.entries(dataset)) {
        totals.set(tag.trim(), (totals.get(tag.trim()) ?? 0) + n);
      }
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  } catch {
    return [];
  }
}

const TRAINING_ROWS: [string, string[]][] = [
  ["Base", ["ss_base_model_version", "ss_sd_model_name"]],
  ["Dim / Alpha", ["ss_network_dim"]],
  ["Resolution", ["ss_resolution", "modelspec.resolution"]],
  ["Train images", ["ss_num_train_images"]],
  ["Epochs", ["ss_num_epochs"]],
];

export function buildTrainingRows(meta: Record<string, string>): [string, string][] {
  return TRAINING_ROWS.map(([label, keys]) => {
    const value =
      label === "Dim / Alpha"
        ? [meta["ss_network_dim"], meta["ss_network_alpha"]].filter(Boolean).join(" / ")
        : keys.map((k) => meta[k]).find((v) => Boolean(v));
    return [label, value ?? ""] as [string, string];
  }).filter(([, v]) => v);
}

export function hasTrainingMeta(meta: Record<string, string> | null | undefined): boolean {
  return Boolean(meta && Object.keys(meta).some((k) => k.startsWith("ss_")));
}
