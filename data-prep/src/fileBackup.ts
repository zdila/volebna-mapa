// Timestamped backup of a working file, written OUTSIDE the tracked tree.
//
// The working GeoJSONs live in data-prep/edit/ and are version-controlled. Their backups are not:
// every check and every apply writes one, each is tens of megabytes, and they are pure churn —
// git already holds the history the backups exist to approximate. They go to data/, which is
// ignored wholesale, so neither the working files nor the backups need a gitignore rule of their
// own.
import { copyFileSync, mkdirSync } from "node:fs";
import { basename } from "node:path";

export const BACKUP_DIR = "data/edit-backups";

/** Copy `file` into the backup directory and return the path written. */
export const backupFile = (file: string): string => {
  mkdirSync(BACKUP_DIR, { recursive: true });
  // Seconds included: two tools writing in the same minute would otherwise share a name and the
  // second would overwrite the first — which happened, and cost the only pre-repair snapshot.
  const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 17);
  const bak = `${BACKUP_DIR}/${basename(file)}.bak-${stamp}`;
  copyFileSync(file, bak);
  return bak;
};
