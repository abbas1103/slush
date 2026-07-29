/**
 * The identifier of the currently published terms wording.
 *
 * `consents.terms_version` must name the wording the student actually accepted,
 * so this has to be ONE constant shared by the page that renders the terms and
 * the action that records consent. They previously drifted: the page declared
 * `terms-2026-07-29-draft` while saveDetails wrote the literal "v1", so every
 * consent row pointed at a version that had never existed - worthless in a
 * cancellation-charge dispute, which is the only reason the column is there.
 *
 * Bump this whenever the wording of /terms changes in a way that affects what a
 * student is agreeing to, and update the date shown on the page with it.
 */
export const TERMS_VERSION = "terms-2026-07-29-draft";
