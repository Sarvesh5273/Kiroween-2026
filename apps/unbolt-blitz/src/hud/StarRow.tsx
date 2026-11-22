/** Three stars, filled for the earned ones. The text label carries the meaning for screen readers. */
export function StarRow({ stars, size = "md" }: { stars: number; size?: "sm" | "md" | "lg" }) {
  const earned = Math.max(0, Math.min(3, Math.trunc(stars)));
  return (
    <span className={`bz-stars bz-stars--${size}`} role="img" aria-label={`${earned} of 3 stars`}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={index < earned ? "bz-star bz-star--on" : "bz-star bz-star--off"}
          aria-hidden="true"
        >
          ★
        </span>
      ))}
    </span>
  );
}
