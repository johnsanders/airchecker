export type Thresholds = {
	lagSlackMs: number;
	// Winners a single race may legitimately call. 1 for a general election; raise
	// to 2 for a top-two primary cycle.
	maxWinners: number;
	pctInTolerance: number;
	// The longest a DDHQ call takes to reach Ross, then Ross's to reach air; together, how
	// long air may go without a call DDHQ has made.
	providerToVendorLagMaxMs: number;
	// The longest a Ross state takes to reach air: how far back a graphic may have been
	// drawn from.
	vendorToAirLagMaxMs: number;
	voteDropAbsoluteThreshold: number;
	voteDropPercentThreshold: number;
};

const defaultThresholds: Thresholds = {
	lagSlackMs: 5_000,
	maxWinners: 1,
	pctInTolerance: 1,
	providerToVendorLagMaxMs: 180_000,
	vendorToAirLagMaxMs: 30_000,
	voteDropAbsoluteThreshold: 500,
	voteDropPercentThreshold: 0.05,
};

export default defaultThresholds;
