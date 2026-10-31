/** A codec picker row: the codec's title with its encoder name muted. */
export function codecLabel(value: string, label: string) {
  if (label === value) return value;
  return (
    <>
      {label} <span className="text-muted-foreground">{value}</span>
    </>
  );
}
