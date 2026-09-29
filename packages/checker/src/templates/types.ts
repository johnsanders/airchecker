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

// An on-air graphic: where it sits in the frame and what it looks like. What's read off
// it is the same for every template (the heading, the "% in", and each candidate's card),
// and the model finds those within the region itself, so nothing here says where they are
// or how many candidates there will be.
export type TemplateSpec = {
	// The one loose region that contains the whole graphic, cropped out and read on its
	// own on every frame.
	captureRegion: Rect;
	id: string;
	surface: TemplateSurface;
	// Prose telling the model what the graphic looks like, and what may sit in its region
	// that isn't it.
	vlmPromptHint: string;
};

export type TemplateSurface = 'fullscreen' | 'lower_third' | 'ticker';
