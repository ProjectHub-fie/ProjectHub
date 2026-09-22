import { Heart, Star } from "lucide-react";
import { useProjectInteractions } from "@/hooks/useProjectInteractions";

interface ProjectInteractionsProps {
  projectId: string;
  /** `sm` for cards in a grid, `lg` for the project detail page. */
  size?: "sm" | "lg";
}

/**
 * The like button and 5-star rating control.
 *
 * Shared by the project grid, the projects list and the detail page so the
 * three render identical state (and so an anonymous visitor gets the same
 * "log in to like" feedback everywhere).
 */
export function ProjectInteractions({ projectId, size = "sm" }: ProjectInteractionsProps) {
  const { likes, averageRating, isLiked, rating, toggleLike, rate, isPending } =
    useProjectInteractions(projectId);

  const large = size === "lg";
  const heartClass = large ? "w-5 h-5" : "w-4 h-4";
  const starClass = large ? "w-5 h-5" : "w-3 h-3";

  return (
    <div className="flex items-center gap-4 mt-4 py-2 border-t border-border/50">
      <button
        onClick={(e) => { e.stopPropagation(); toggleLike(); }}
        disabled={isPending}
        aria-label={isLiked ? "Unlike project" : "Like project"}
        aria-pressed={isLiked}
        className={`flex items-center gap-1 transition-colors disabled:opacity-60 ${
          isLiked ? "text-red-500" : "text-muted-foreground hover:text-red-400"
        }`}
      >
        <Heart className={`${heartClass} ${isLiked ? "fill-current" : ""}`} />
        <span className={large ? "font-medium" : "text-xs font-medium"}>
          {likes}
          {large ? " likes" : ""}
        </span>
      </button>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={(e) => { e.stopPropagation(); rate(star); }}
            disabled={isPending}
            aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
            className={`transition-colors disabled:opacity-60 ${
              rating >= star ? "text-yellow-500" : "text-muted-foreground hover:text-yellow-400"
            }`}
          >
            <Star className={`${starClass} ${rating >= star ? "fill-current" : ""}`} />
          </button>
        ))}
        {averageRating > 0 && (
          <span className={`text-muted-foreground ${large ? "text-sm ml-2" : "text-[10px] ml-1"}`}>
            ({averageRating.toFixed(1)}{large ? " avg" : ""})
          </span>
        )}
      </div>
    </div>
  );
}
