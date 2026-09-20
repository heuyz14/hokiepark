export interface ArrivalPlanStep {
  label: string;
  minute: number;
  durationMinutes?: number;
  source: "route" | "forecast" | "heuristic" | "user";
}

export interface ArrivalPlan {
  destinationName: string;
  recommendedLotId: string;
  recommendedLotName: string;
  targetMinute: number;
  lotArrivalMinute: number;
  steps: ArrivalPlanStep[];
  assumptions: string[];
}

/**
 * Builds only the portions HokiePark can support today. Parking search is a disclosed heuristic;
 * the walk duration is the same deterministic route/estimate used for the recommendation.
 */
export function buildArrivalPlan(input: {
  destinationName: string;
  targetMinute: number;
  recommendedLot: { id: string; name: string; walkMin: number };
  parkingMinutes?: number;
  bufferMinutes?: number;
}): ArrivalPlan {
  const parkingMinutes = input.parkingMinutes ?? 4;
  const bufferMinutes = input.bufferMinutes ?? 5;
  const lotArrivalMinute = Math.max(0, input.targetMinute - input.recommendedLot.walkMin - parkingMinutes - bufferMinutes);
  return {
    destinationName: input.destinationName,
    recommendedLotId: input.recommendedLot.id,
    recommendedLotName: input.recommendedLot.name,
    targetMinute: input.targetMinute,
    lotArrivalMinute,
    steps: [
      { label: "Park and find a space (estimate)", minute: lotArrivalMinute, durationMinutes: parkingMinutes, source: "heuristic" },
      { label: `Walk to ${input.destinationName}`, minute: lotArrivalMinute + parkingMinutes, durationMinutes: input.recommendedLot.walkMin, source: "route" },
      { label: "Arrival buffer", minute: input.targetMinute - bufferMinutes, durationMinutes: bufferMinutes, source: "user" },
    ],
    assumptions: [
      `${parkingMinutes}-minute parking-search estimate.`,
      `${bufferMinutes}-minute arrival buffer.`,
      "HokiePark does not estimate driving time from your starting location, so no leave-home time is shown.",
    ],
  };
}
