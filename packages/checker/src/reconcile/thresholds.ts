export type Thresholds = {
	// Distinct air sightings before an air-involved anomaly is emitted. 1 for the
	// Nov 3, 2026 general: with hundreds of races cycling through the ticker, a single
	// bad graphic must alert the moment it is seen (user decision, 2026-09-25).
	airHysteresisN: number;
	inBreakSilenceMs: number;
	lagSlackMs: number;
	// Winners a single race may legitimately call. 1 for a general election; raise
	// to 2 for a top-two primary cycle.
	maxWinners: number;
	pctInTolerance: number;
	providerToVendorLagMaxMs: number;
	providerToVendorLagMs: number;
	recoveryHysteresisM: number;
	vendorHysteresisN: number;
	vendorToAirLagMaxMs: number;
	vendorToAirLagMs: number;
	voteDropAbsoluteThreshold: number;
	voteDropPercentThreshold: number;
};

const defaultThresholds: Thresholds = {
	airHysteresisN: 1,
	inBreakSilenceMs: 20_000,
	lagSlackMs: 5_000,
	maxWinners: 1,
	pctInTolerance: 1,
	providerToVendorLagMaxMs: 180_000,
	providerToVendorLagMs: 90_000,
	recoveryHysteresisM: 3,
	vendorHysteresisN: 2,
	vendorToAirLagMaxMs: 30_000,
	vendorToAirLagMs: 8_000,
	voteDropAbsoluteThreshold: 500,
	voteDropPercentThreshold: 0.05,
};

export default defaultThresholds;
