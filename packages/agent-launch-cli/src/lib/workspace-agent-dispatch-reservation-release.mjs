

const retainedReleaseSettlements = new WeakMap();

export async function releaseDispatchSubjectReservation(
  holder,
  releaseReservation,
  { retainFailure = false } = {}
) {
  if (retainFailure) {
    if (!holder) return null;
    if (retainedReleaseSettlements.has(holder)) {
      return retainedReleaseSettlements.get(holder);
    }
    if (holder.reservation === null || holder.retain === true) return null;
    const reservation = holder.reservation;
    const settlement = (async () => {
      if (typeof releaseReservation !== "function") {
        holder.reservation = null;
        return null;
      }
      try {
        await releaseReservation(reservation);
        holder.reservation = null;
        return null;
      } catch (error) {
        holder.retain = true;
        return error;
      }
    })();
    retainedReleaseSettlements.set(holder, settlement);
    return settlement;
  }

  if (!holder || holder.reservation === null || holder.retain === true) return null;
  const reservation = holder.reservation;

  holder.reservation = null;
  if (typeof releaseReservation !== "function") return null;
  try {
    await releaseReservation(reservation);
  } catch {

  }
  return null;
}
