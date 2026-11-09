// The keys of the meta store of the enso-inputs database. Revision claims are
// keyed under a prefix of their own.

export const META_KEY = {
  /** This browser's name on the server, for its job records. */
  client: "client",
  /** The server the move of older records went to. */
  migrateTarget: "migrateTarget",
  /** Until when the move is not offered again. */
  migrateSilenced: "migrateSilencedUntil",
  /** The days the trash keeps what goes to it: the server's setting, as last read. */
  trashDays: "trashDays",
  /** Cids of what the user deleted from the trash, whose bytes have not gone yet. */
  reclaim: "reclaim",
  /** When each blob no document names was first seen unnamed. */
  orphans: "orphans",
  /** When each hashes row no document names was first seen unnamed. */
  hashOrphans: "hashOrphans",
} as const;

export type MetaKey = (typeof META_KEY)[keyof typeof META_KEY];

export const META_KEYS: readonly MetaKey[] = Object.values(META_KEY);

/** The prefix of the keys that claim a document's revisions. */
export const CLAIM_PREFIX = "rev:";
