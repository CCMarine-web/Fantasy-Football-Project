/** "Anthony Cibilich" -> "anthony-cibilich". Readable URLs for manager pages. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The profile URL for a manager, by display name. */
export function managerPath(name: string): string {
  return `/managers/${slugify(name)}`;
}
