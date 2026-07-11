export const isLocalApplicationServer = (locationLike = globalThis.location) => Boolean(locationLike)
  && String(locationLike.protocol || "").startsWith("http")
  && /^(127\.0\.0\.1|localhost)$/i.test(String(locationLike.hostname || ""));

export const parseRecordPayload = (raw) => {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
};

const recordTime = (payload) => {
  const time = payload?.savedAt ? Date.parse(payload.savedAt) : 0;
  return Number.isFinite(time) ? time : 0;
};

export const chooseRecordPayload = (portable, local, hasContent) => {
  if (hasContent(portable) && !hasContent(local)) return portable;
  if (hasContent(local) && !hasContent(portable)) return local;
  if (portable && local) return recordTime(local) > recordTime(portable) ? local : portable;
  return portable || local || null;
};

export const createRecordRepository = ({ storage, storageKey, oldKeys, endpoint, fetchImpl = globalThis.fetch, locationLike = globalThis.location }) => {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    throw new TypeError("record repository requires a storage adapter");
  }
  const localServer = isLocalApplicationServer(locationLike);
  const readBrowser = () => {
    let raw = storage.getItem(storageKey);
    for (const key of oldKeys) if (!raw) raw = storage.getItem(key);
    return parseRecordPayload(raw);
  };
  const readPortable = async () => {
    if (!localServer || typeof fetchImpl !== "function") return null;
    try {
      const response = await fetchImpl(`${endpoint}?t=${Date.now()}`, { cache: "no-store" });
      return response.ok ? parseRecordPayload(await response.text()) : null;
    } catch (error) {
      console.warn("portable record load failed", error);
      return null;
    }
  };
  const save = async (payload) => {
    storage.setItem(storageKey, JSON.stringify(payload));
    if (!localServer || typeof fetchImpl !== "function") return { localServer, portableSaved: true };
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      return { localServer, portableSaved: response.ok };
    } catch (error) {
      console.warn("portable record save failed", error);
      return { localServer, portableSaved: false };
    }
  };
  const load = async (hasContent) => chooseRecordPayload(await readPortable(), readBrowser(), hasContent);
  return Object.freeze({ isLocalServer: localServer, load, readBrowser, readPortable, save });
};
