// Default entity types for the Create entity picker and the dashboard ordering.

export const BUILTIN_ENTITY_TYPES = [
	"character",
	"location",
	"faction",
	"item",
	"event",
	"concept",
	"organization",
	"species",
	"chapter",
	"book",
	"quest",
	"story_thread",
] as const;

export type BuiltinEntityType = (typeof BUILTIN_ENTITY_TYPES)[number];

/** Human-facing label for a normalised type. `story_thread` -> `Story Thread`. */
export function typeLabel(type: string): string {
	return type
		.split("_")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

/** Conventional folder for a type, used when a schema declares none. Plural and
 * capitalised, matching §37's example vault. */
export function defaultFolder(type: string): string {
	const label = typeLabel(type);
	if (label.endsWith("s")) return label;
	if (label.endsWith("y")) return `${label.slice(0, -1)}ies`;
	return `${label}s`;
}
