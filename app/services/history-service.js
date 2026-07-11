export const historyKey = (snapshot) => JSON.stringify(snapshot);

export const trimHistory = (items, { entries, bytes }) => {
  let totalBytes = items.reduce((total, item) => total + item.length, 0);
  while (items.length > entries || totalBytes > bytes) totalBytes -= items.shift().length;
  return items;
};
