// Result templates render a variable, reflowing list of candidate cards
// (fullscreen/ticker/lower-third across; sideSlab stacked). extract() hands the
// crop to the VLM, which returns one entry per card, so the spec is agnostic to
// how many candidates are shown.
export type CandidateField = 'called' | 'name' | 'party' | 'pct' | 'votes';

export type CandidateFieldSpec = {
	format: FieldFormat;
	name: CandidateField;
	required: boolean;
};

export type CandidateListSpec = {
	expectMax: number;
	fields: CandidateFieldSpec[];
	layout: 'column' | 'row';
};

export type DataPath = 'provider_direct' | 'vendor';

export type FieldFormat =
	| { decimals: 0 | 1; kind: 'percent'; max: 100; min: 0 }
	| { kind: 'candidateName' }
	| { kind: 'enum'; values: readonly string[] }
	| { kind: 'integer' }
	| { kind: 'partyLabel' }
	| { kind: 'text' };

// Normalized fractions of the frame: x/y are the top-left as fractions of width/
// height, w/h are size fractions — all in [0..1]. Resolution-independent; multiply
// by actual frame dimensions at crop time via scaleRectToFrame. No fixed reference
// size, so any 16:9 capture (1080p, 4K, …) works.
export type Rect = {
	h: number;
	w: number;
	x: number;
	y: number;
};

// A single-valued field the VLM reads from the crop. No rect — the model locates
// the value itself within captureRegion (e.g. the race heading, the "% in").
export type SingletonField = {
	format: FieldFormat;
	name: string;
	required: boolean;
};

export type TemplateSpec = {
	bind: {
		candidateKeyFrom: (candidate: Record<string, string>) => string;
		raceKeyFrom: (singletons: Record<string, string>) => string;
	};
	candidateList?: CandidateListSpec;
	// The one loose region that contains the whole graphic; the VLM localizes the
	// fields within it. Absent for locatable templates (magic wall), where detect()
	// returns a bbox instead.
	captureRegion?: Rect;
	dataPath: DataPath;
	displayName: string;
	id: string;
	singletons: SingletonField[];
	surface: TemplateSurface;
	vlmPromptHint: string;
};

export type TemplateSurface =
	| 'corner_bug'
	| 'fullscreen'
	| 'lower_third'
	| 'magic_wall'
	| 'side_slab'
	| 'ticker';
