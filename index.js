/**
 * Host half of the workspace-archive bundle.
 *
 * Every surface of this plugin is Client-side (the archive set is reached
 * through the Client `uiWorkspace` service), so this row only has to exist and
 * activate cleanly for the Loader entry to be valid. It registers nothing and
 * owns no resources.
 */

/**
 * Activate the Host row.
 * @returns nothing; the bundle carries no Host-side capability.
 */
export function apply() {}
