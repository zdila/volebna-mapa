// URL-hash settings.
//
// The hash is a parameter list (#map=z/lat/lng&color=q1&layer=ours&seeds=0&theme=dark).
// MapLibre owns `map=`; we own the rest. Both read-modify-write only their own
// keys, preserving the others. Values are simple tokens (map's slashes survive).

export function readHashParams(): Record<string, string> {
  const out: Record<string, string> = {};

  for (const part of location.hash.replace(/^#/, "").split("&")) {
    const i = part.indexOf("=");
    if (i > 0) {
      out[part.slice(0, i)] = part.slice(i + 1);
    }
  }

  return out;
}

// Set key to val, or remove it when val is null (so defaults keep the hash clean).
export function writeHashParam(key: string, val: string | null) {
  const params = readHashParams();

  if (val === null) {
    delete params[key];
  } else {
    params[key] = val;
  }

  const str = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  history.replaceState(
    null,
    "",
    str ? `#${str}` : `${location.pathname}${location.search}`,
  );
}
