/** Customer-build feature switches owned by GMD. */
const updaterFlag = String(import.meta.env.VITE_GMD_UPDATER_ENABLED ?? '')
  .trim()
  .toLowerCase();

export const GMD_UPDATER_ENABLED = updaterFlag === '1' || updaterFlag === 'true';
