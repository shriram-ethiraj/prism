/** Add future Home sections here; saved orders append newly available sections. */
export const homeSections = [
  { id: "inputs", label: "Inputs" },
  { id: "apps", label: "Apps" },
] as const;
export type HomeSection = (typeof homeSections)[number]["id"];
export function normalizeHomeOrder(
  value: unknown,
  legacy?: unknown,
): HomeSection[] {
  const available: HomeSection[] = homeSections.map((s) => s.id);
  if (!Array.isArray(value))
    return legacy === "apps-first" ? ["apps", "inputs"] : available;
  const saved = value.filter((id): id is HomeSection =>
    available.includes(id as HomeSection),
  );
  return [...new Set(saved), ...available.filter((id) => !saved.includes(id))];
}

/** Two sections need one action each; larger lists retain both boundary controls. */
export function sectionDirections(
  index: number,
  count: number,
): { direction: "up" | "down"; disabled: boolean }[] {
  if (count < 2) return [];
  return (["up", "down"] as const).flatMap((direction) => {
    const disabled = direction === "up" ? index === 0 : index === count - 1;
    return count === 2 && disabled ? [] : [{ direction, disabled }];
  });
}
